'use strict';
const { buildGraph, hexNeighbors } = require("./geometry.js");
const { tilesFor, getMap } = require("./maps.js");

const RESOURCES = ['timber', 'clay', 'wool', 'grain', 'ore'];
const TERRAIN_RES = { forest: 'timber', hills: 'clay', pasture: 'wool', fields: 'grain', mountains: 'ore' };
const TERRAIN_WEIGHTS = { forest: 22, pasture: 22, fields: 22, hills: 17, mountains: 17 };
const NUMBER_WEIGHTS = { 2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 1 };

// Largest-remainder apportionment of `total` items over weights.
function apportion(total, weights) {
  const keys = Object.keys(weights);
  const sum = keys.reduce((a, k) => a + weights[k], 0);
  const out = {};
  let used = 0;
  const rema = [];
  for (const k of keys) {
    const exact = (total * weights[k]) / sum;
    out[k] = Math.floor(exact);
    used += out[k];
    rema.push([k, exact - out[k]]);
  }
  rema.sort((a, b) => b[1] - a[1]);
  for (let i = 0; used < total; i = (i + 1) % rema.length, used++) out[rema[i][0]]++;
  return out;
}

const pips = (n) => (n ? 6 - Math.abs(7 - n) : 0);

function defaultDeserts(n) {
  return Math.max(1, Math.round(n / 20));
}

// Greedy upper bound on how many settlements fit under the distance rule.
function settlementCapacity(graph) {
  const taken = new Set();
  let count = 0;
  for (const v of graph.vertices) {
    if (taken.has(v.id)) continue;
    count++;
    taken.add(v.id);
    for (const n of v.nbrs) taken.add(n);
  }
  return count;
}

function maxPlayersFor(graph) {
  return Math.max(2, Math.min(6, Math.floor(settlementCapacity(graph) / 6)));
}

function assignTerrain(graph, rng, balanced) {
  const n = graph.hexes.length;
  const deserts = defaultDeserts(n);
  const counts = apportion(n - deserts, TERRAIN_WEIGHTS);
  const pool = [];
  for (const [t, c] of Object.entries(counts)) for (let i = 0; i < c; i++) pool.push(t);
  for (let i = 0; i < deserts; i++) pool.push('desert');

  const nbrs = graph.hexes.map((h) => hexNeighbors(graph, h.id));
  const score = (layout) => {
    let bad = 0;
    for (let i = 0; i < n; i++) {
      let same = 0;
      for (const j of nbrs[i]) {
        if (layout[j] === layout[i]) same++;
        if (layout[i] === 'desert' && layout[j] === 'desert') bad += 3;
      }
      if (same >= 3) bad += same - 2;
    }
    return bad;
  };
  let best = null;
  let bestScore = Infinity;
  const tries = balanced ? 300 : 1;
  for (let t = 0; t < tries; t++) {
    const layout = rng.shuffle(pool.slice());
    const s = balanced ? score(layout) : 0;
    if (s < bestScore) {
      best = layout;
      bestScore = s;
      if (s === 0) break;
    }
  }
  best.forEach((t, i) => (graph.hexes[i].terrain = t));
}

function assignNumbers(graph, rng, balanced) {
  const land = graph.hexes.filter((h) => h.terrain !== 'desert');
  const counts = apportion(land.length, NUMBER_WEIGHTS);
  const pool = [];
  for (const [num, c] of Object.entries(counts)) for (let i = 0; i < c; i++) pool.push(Number(num));
  const nbrs = graph.hexes.map((h) => hexNeighbors(graph, h.id));

  const score = (assign) => {
    let bad = 0;
    for (let i = 0; i < land.length; i++) {
      const hid = land[i].id;
      for (const j of nbrs[hid]) {
        const other = assign.get(j);
        if (other === undefined) continue;
        const mine = assign.get(hid);
        if (j > hid) {
          if ((mine === 6 || mine === 8) && (other === 6 || other === 8)) bad += 4;
          else if (mine === other) bad += 1;
        }
      }
    }
    return bad;
  };
  let best = null;
  let bestScore = Infinity;
  const tries = balanced ? 800 : 1;
  for (let t = 0; t < tries; t++) {
    const shuffled = rng.shuffle(pool.slice());
    const assign = new Map();
    land.forEach((h, i) => assign.set(h.id, shuffled[i]));
    const s = balanced ? score(assign) : 0;
    if (s < bestScore) {
      best = assign;
      bestScore = s;
      if (s === 0) break;
    }
  }
  for (const h of land) h.number = best.get(h.id);
}

function placePorts(graph, rng) {
  const coastal = graph.edges.filter((e) => e.coastal);
  const mid = (e) => {
    const a = graph.vertices[e.a];
    const b = graph.vertices[e.b];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  const target = Math.max(4, Math.min(14, Math.round((coastal.length * 9) / 30)));
  const chosen = [];
  const blockedVerts = new Set();
  const first = coastal[rng.int(coastal.length)];
  const take = (e) => {
    chosen.push(e);
    blockedVerts.add(e.a);
    blockedVerts.add(e.b);
  };
  take(first);
  while (chosen.length < target) {
    let best = null;
    let bestScore = -1;
    for (const e of coastal) {
      if (chosen.includes(e) || blockedVerts.has(e.a) || blockedVerts.has(e.b)) continue;
      const m = mid(e);
      let min = Infinity;
      for (const c of chosen) {
        const cm = mid(c);
        min = Math.min(min, Math.hypot(m.x - cm.x, m.y - cm.y));
      }
      const s = min + rng.next() * 0.5;
      if (s > bestScore) {
        bestScore = s;
        best = e;
      }
    }
    if (!best) break;
    take(best);
  }
  const n = chosen.length;
  const generic = Math.max(2, Math.round((n * 4) / 9));
  const types = [];
  for (let i = 0; i < generic; i++) types.push('any');
  const specials = [];
  while (specials.length < n - generic) specials.push(...rng.shuffle(RESOURCES.slice()));
  types.push(...specials.slice(0, n - generic));
  rng.shuffle(types);

  return chosen.map((e, i) => {
    const hex = graph.hexes[e.hexes[0]];
    const m = mid(e);
    let nx = m.x - hex.x;
    let ny = m.y - hex.y;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    graph.vertices[e.a].port = i;
    graph.vertices[e.b].port = i;
    return {
      id: i,
      edge: e.id,
      a: e.a,
      b: e.b,
      type: types[i],
      x: Math.round(m.x * 1000) / 1000,
      y: Math.round(m.y * 1000) / 1000,
      nx: Math.round(nx * 1000) / 1000,
      ny: Math.round(ny * 1000) / 1000,
    };
  });
}

function boundsOf(graph) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of graph.vertices) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
  }
  return { minX, minY, maxX, maxY };
}

// Build a complete, playable board for a map id.
function generateBoard(mapId, opts, rng) {
  const map = getMap(mapId);
  if (!map) throw new Error('unknown map ' + mapId);
  const balanced = !opts || opts.balanced !== false;
  const tiles = tilesFor(mapId, rng);
  const graph = buildGraph(tiles);
  assignTerrain(graph, rng, balanced);
  assignNumbers(graph, rng, balanced);
  for (const v of graph.vertices) v.port = null;
  const ports = placePorts(graph, rng);
  const desert = graph.hexes.find((h) => h.terrain === 'desert');
  return {
    mapId,
    name: map.name,
    hexes: graph.hexes,
    vertices: graph.vertices,
    edges: graph.edges,
    ports,
    desert: desert ? desert.id : 0,
    bounds: boundsOf(graph),
    maxPlayers: maxPlayersFor(graph),
  };
}

// Light-weight description of every map for the lobby picker.
function describeMaps() {
  const { MAPS } = require("./maps.js");
  const { seedHolder, makeRng } = require("./rng.js");
  return MAPS.map((m) => {
    const rng = makeRng(seedHolder(12345));
    const tiles = tilesFor(m.id, rng);
    const graph = buildGraph(tiles);
    return {
      id: m.id,
      name: m.name,
      blurb: m.blurb,
      random: !!m.random,
      tileCount: tiles.length,
      maxPlayers: maxPlayersFor(graph),
      tiles: graph.hexes.map((h) => [h.x, h.y]),
    };
  });
}

module.exports = {
  RESOURCES,
  TERRAIN_RES,
  generateBoard,
  describeMaps,
  settlementCapacity,
  maxPlayersFor,
  pips,
  apportion,
};

