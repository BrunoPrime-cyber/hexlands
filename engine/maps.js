'use strict';
const { hexDist, hk, neighbor, isConnected } = require("./geometry.js");

// ---- shape helpers ---------------------------------------------------------

// ASCII art -> tiles. 'o' marks a hex; each hex is 2 columns wide and odd rows
// are shifted by one column, so (col - row) must be even.
function fromAscii(rows) {
  const tiles = [];
  rows.forEach((line, r) => {
    for (let c = 0; c < line.length; c++) {
      if (line[c] !== 'o') continue;
      if ((c - r) % 2 !== 0) throw new Error(`bad ascii parity at row ${r} col ${c}`);
      tiles.push({ q: (c - r) / 2, r });
    }
  });
  return tiles;
}

// All (q, r) within radius R of the origin that satisfy fn.
function where(R, fn) {
  const out = [];
  for (let r = -R; r <= R; r++) for (let q = -R; q <= R; q++) if (fn(q, r)) out.push({ q, r });
  return out;
}

// Rows given as [r, qFrom, qTo].
function fromRows(spec) {
  const out = [];
  for (const [r, a, b] of spec) for (let q = a; q <= b; q++) out.push({ q, r });
  return out;
}

function dedupe(tiles) {
  const seen = new Set();
  return tiles.filter((t) => {
    const k = hk(t.q, t.r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Seeded organic island: grows by picking frontier cells weighted by how many
// land neighbours they already touch, which keeps the coastline compact.
function randomBlob(n, rng) {
  const land = new Map([[hk(0, 0), { q: 0, r: 0 }]]);
  while (land.size < n) {
    const frontier = new Map();
    for (const t of land.values()) {
      for (let i = 0; i < 6; i++) {
        const [q, r] = neighbor(t.q, t.r, i);
        const k = hk(q, r);
        if (land.has(k)) continue;
        const f = frontier.get(k) || { q, r, w: 0 };
        f.w += 1;
        frontier.set(k, f);
      }
    }
    const cells = [...frontier.values()];
    const weights = cells.map((c) => c.w * c.w);
    const sum = weights.reduce((a, b) => a + b, 0);
    let pick = rng.next() * sum;
    let chosen = cells[cells.length - 1];
    for (let i = 0; i < cells.length; i++) {
      pick -= weights[i];
      if (pick <= 0) {
        chosen = cells[i];
        break;
      }
    }
    land.set(hk(chosen.q, chosen.r), { q: chosen.q, r: chosen.r });
  }
  return [...land.values()];
}

// ---- catalogue -------------------------------------------------------------

const MAPS = [
  {
    id: 'classic',
    name: 'Classic',
    blurb: 'The familiar 19-tile island.',
    tiles: () => where(2, (q, r) => hexDist(q, r) <= 2),
  },
  {
    id: 'duel',
    name: 'Duel',
    blurb: 'Compact 14-tile board for two or three.',
    tiles: () => fromAscii(['  o o o', ' o o o o', 'o o o o', ' o o o']),
  },
  {
    id: 'grand',
    name: 'Grand',
    blurb: 'Big 30-tile island for five or six.',
    tiles: () =>
      fromAscii([
        '    o o o',
        '   o o o o',
        '  o o o o o',
        ' o o o o o o',
        '  o o o o o',
        '   o o o o',
        '    o o o',
      ]),
  },
  {
    id: 'mega',
    name: 'Mega Island',
    blurb: 'A full 37-tile hexagon.',
    tiles: () => where(3, (q, r) => hexDist(q, r) <= 3),
  },
  {
    id: 'ring',
    name: 'The Ring',
    blurb: 'A circle of land around a central lagoon.',
    tiles: () => where(3, (q, r) => hexDist(q, r) >= 2 && hexDist(q, r) <= 3),
  },
  {
    id: 'atoll',
    name: 'Atoll',
    blurb: 'A huge two-tile-thick ring with a wide lagoon.',
    tiles: () => where(4, (q, r) => hexDist(q, r) >= 3 && hexDist(q, r) <= 4),
  },
  {
    id: 'arrowhead',
    name: 'Arrowhead',
    blurb: 'A triangular landmass that narrows to a point.',
    tiles: () => where(6, (q, r) => q >= 0 && r >= 0 && q + r <= 6),
  },
  {
    id: 'rhombus',
    name: 'Rhombus',
    blurb: 'A slanted diamond of land.',
    tiles: () => where(4, (q, r) => q >= 0 && r >= 0),
  },
  {
    id: 'hourglass',
    name: 'Hourglass',
    blurb: 'Two wide shores joined by a narrow waist.',
    tiles: () =>
      fromAscii(['o o o o o', ' o o o o', '  o o o', '   o o', '  o o o', ' o o o o', 'o o o o o']),
  },
  {
    id: 'asterisk',
    name: 'Asterisk',
    blurb: 'Six long arms radiating from a central hub.',
    tiles: () =>
      where(4, (q, r) => hexDist(q, r) <= 2 || Math.min(Math.abs(q), Math.abs(r), Math.abs(q + r)) === 0),
  },
  {
    id: 'crescent',
    name: 'Crescent',
    blurb: 'A curved island hugging a bay.',
    tiles: () => where(4, (q, r) => hexDist(q, r) <= 4 && hexDist(q - 3, r) > 2),
  },
  {
    id: 'twinpeaks',
    name: 'Twin Peaks',
    blurb: 'Two highlands joined by a single-tile pass.',
    tiles: () =>
      dedupe([
        ...where(5, (q, r) => hexDist(q + 3, r) <= 2),
        ...where(5, (q, r) => hexDist(q - 3, r) <= 2),
        { q: 0, r: 0 },
      ]),
  },
  {
    id: 'serpent',
    name: 'Serpent',
    blurb: 'A winding S-shaped strip. Roads matter here.',
    tiles: () =>
      fromRows([
        [0, 0, 5],
        [1, 4, 5],
        [2, 0, 4],
        [3, -1, 0],
        [4, -2, 3],
      ]),
  },
  {
    id: 'islets',
    name: 'Three Islets',
    blurb: 'Three small islands linked by one-tile land bridges.',
    tiles: () =>
      dedupe([
        ...where(6, (q, r) => hexDist(q, r) <= 1),
        ...where(6, (q, r) => hexDist(q - 4, r) <= 1),
        ...where(6, (q, r) => hexDist(q, r - 4) <= 1),
        { q: 2, r: 0 },
        { q: 0, r: 2 },
        { q: 2, r: 2 },
      ]),
  },
  {
    id: 'wild-s',
    name: 'Wild Coast (small)',
    blurb: 'A fresh random 19-tile island every game.',
    random: 19,
  },
  {
    id: 'wild-m',
    name: 'Wild Coast (medium)',
    blurb: 'A fresh random 30-tile island every game.',
    random: 30,
  },
  {
    id: 'wild-l',
    name: 'Wild Coast (large)',
    blurb: 'A fresh random 41-tile island every game.',
    random: 41,
  },
];

const BY_ID = new Map(MAPS.map((m) => [m.id, m]));

function getMap(id) {
  return BY_ID.get(id) || null;
}

// Land tiles for a map. Random maps consume the supplied rng.
function tilesFor(id, rng) {
  const m = getMap(id);
  if (!m) throw new Error('unknown map ' + id);
  const tiles = m.random ? randomBlob(m.random, rng) : m.tiles();
  if (!isConnected(tiles)) throw new Error('map ' + id + ' is not connected');
  return tiles;
}

module.exports = { MAPS, getMap, tilesFor, fromAscii, randomBlob };

