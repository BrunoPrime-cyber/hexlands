'use strict';
// Pointy-top hex grid in axial coordinates (q, r). Hex size 1.
// Neighbour order is clockwise on screen starting from east:
//   0 E, 1 SE, 2 SW, 3 W, 4 NW, 5 NE
// Corner i of a hex sits between neighbour i and neighbour i+1.

const SQ3 = Math.sqrt(3);
const DIRS = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];

const hk = (q, r) => q + ',' + r;
const hexCenter = (q, r) => ({ x: SQ3 * (q + r / 2), y: 1.5 * r });
const hexDist = (q, r) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
const neighbor = (q, r, i) => [q + DIRS[i][0], r + DIRS[i][1]];

const round3 = (n) => Math.round(n * 1000) / 1000;

// Build the vertex / edge graph for a set of land tiles.
// Returns { hexes, vertices, edges } with dense numeric ids.
function buildGraph(tiles) {
  const sorted = tiles.slice().sort((a, b) => a.r - b.r || a.q - b.q);
  const hexIndex = new Map();
  sorted.forEach((t, i) => hexIndex.set(hk(t.q, t.r), i));

  const vTmp = new Map();
  const eTmp = new Map();

  const vertexFor = (a, b, c) => {
    const keys = [hk(a[0], a[1]), hk(b[0], b[1]), hk(c[0], c[1])].sort();
    const id = keys.join('|');
    let v = vTmp.get(id);
    if (!v) {
      const ca = hexCenter(a[0], a[1]);
      const cb = hexCenter(b[0], b[1]);
      const cc = hexCenter(c[0], c[1]);
      v = { key: id, x: (ca.x + cb.x + cc.x) / 3, y: (ca.y + cb.y + cc.y) / 3, land: new Set() };
      vTmp.set(id, v);
    }
    return v;
  };

  const hexVerts = sorted.map(() => []);

  sorted.forEach((t, hi) => {
    const me = [t.q, t.r];
    const nb = [0, 1, 2, 3, 4, 5].map((i) => neighbor(t.q, t.r, i));
    for (let i = 0; i < 6; i++) {
      const v = vertexFor(me, nb[i], nb[(i + 1) % 6]);
      v.land.add(hi);
      hexVerts[hi].push(v);
    }
    for (let i = 0; i < 6; i++) {
      const other = nb[i];
      const ek = [hk(t.q, t.r), hk(other[0], other[1])].sort().join('|');
      let e = eTmp.get(ek);
      if (!e) {
        const va = vertexFor(me, nb[(i + 5) % 6], other);
        const vb = vertexFor(me, other, nb[(i + 1) % 6]);
        e = { key: ek, va, vb, land: new Set() };
        eTmp.set(ek, e);
      }
      e.land.add(hi);
    }
  });

  const vList = [...vTmp.values()].sort((a, b) => round3(a.y) - round3(b.y) || round3(a.x) - round3(b.x));
  vList.forEach((v, i) => (v.id = i));
  const eList = [...eTmp.values()].sort((a, b) => {
    const ay = (a.va.y + a.vb.y) / 2;
    const by = (b.va.y + b.vb.y) / 2;
    const ax = (a.va.x + a.vb.x) / 2;
    const bx = (b.va.x + b.vb.x) / 2;
    return round3(ay) - round3(by) || round3(ax) - round3(bx);
  });
  eList.forEach((e, i) => (e.id = i));

  const vertices = vList.map((v) => ({
    id: v.id,
    x: round3(v.x),
    y: round3(v.y),
    hexes: [...v.land].sort((a, b) => a - b),
    edges: [],
    nbrs: [],
  }));
  const edges = eList.map((e) => ({
    id: e.id,
    a: e.va.id,
    b: e.vb.id,
    hexes: [...e.land].sort((a, b) => a - b),
    coastal: e.land.size === 1,
  }));
  for (const e of edges) {
    vertices[e.a].edges.push(e.id);
    vertices[e.b].edges.push(e.id);
    vertices[e.a].nbrs.push(e.b);
    vertices[e.b].nbrs.push(e.a);
  }
  const hexes = sorted.map((t, i) => {
    const c = hexCenter(t.q, t.r);
    return {
      id: i,
      q: t.q,
      r: t.r,
      x: round3(c.x),
      y: round3(c.y),
      vertices: hexVerts[i].map((v) => v.id),
      terrain: 'desert',
      number: null,
    };
  });
  return { hexes, vertices, edges, hexIndex };
}

// Hex neighbours (as hex ids) that are land.
function hexNeighbors(graph, hexId) {
  const h = graph.hexes[hexId];
  const out = [];
  for (let i = 0; i < 6; i++) {
    const [q, r] = neighbor(h.q, h.r, i);
    const idx = graph.hexIndex.get(hk(q, r));
    if (idx !== undefined) out.push(idx);
  }
  return out;
}

function isConnected(tiles) {
  if (!tiles.length) return false;
  const set = new Set(tiles.map((t) => hk(t.q, t.r)));
  const seen = new Set([hk(tiles[0].q, tiles[0].r)]);
  const stack = [tiles[0]];
  while (stack.length) {
    const t = stack.pop();
    for (let i = 0; i < 6; i++) {
      const [q, r] = neighbor(t.q, t.r, i);
      const k = hk(q, r);
      if (set.has(k) && !seen.has(k)) {
        seen.add(k);
        stack.push({ q, r });
      }
    }
  }
  return seen.size === set.size;
}

module.exports = { SQ3, DIRS, hk, hexCenter, hexDist, neighbor, buildGraph, hexNeighbors, isConnected };

