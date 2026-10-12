'use strict';
// A simple heuristic player. It fills empty seats and drives automated tests.

const { pips } = require("./board.js");
const {
  COST,
  RESOURCES,
  TERRAIN_RES,
  LIMIT,
  total,
  vpOf,
  tradeRatio,
  legalSetupVertices,
  legalSettlementVertices,
  legalRoadEdges,
  legalSetupRoads,
  legalRobberHexes,
} = require("./game.js");

const hasRes = (hand, cost) => RESOURCES.every((r) => hand[r] >= (cost[r] || 0));

function producedTerrains(state, pi) {
  const set = new Set();
  const p = state.players[pi];
  for (const v of [...p.settlements, ...p.cities]) {
    for (const h of state.board.vertices[v].hexes) set.add(state.board.hexes[h].terrain);
  }
  return set;
}

function vertexValue(state, v, pi) {
  const vert = state.board.vertices[v];
  const have = producedTerrains(state, pi);
  let s = 0;
  const kinds = new Set();
  for (const h of vert.hexes) {
    const hex = state.board.hexes[h];
    if (hex.terrain === 'desert') continue;
    s += pips(hex.number);
    kinds.add(hex.terrain);
  }
  for (const k of kinds) s += have.has(k) ? 0.6 : 1.6;
  if (vert.port !== null) s += 1.2;
  return s;
}

function bestVertex(state, pi, candidates) {
  let best = candidates[0];
  let bestV = -1;
  for (const v of candidates) {
    const val = vertexValue(state, v, pi);
    if (val > bestV) {
      bestV = val;
      best = v;
    }
  }
  return best;
}

// Score an edge by how promising the vertices it leads to are.
function roadScore(state, pi, e) {
  const edge = state.board.edges[e];
  let best = 0;
  for (const u of [edge.a, edge.b]) {
    const vert = state.board.vertices[u];
    if (!state.buildings[u] && vert.nbrs.every((n) => !state.buildings[n])) best = Math.max(best, vertexValue(state, u, pi));
    for (const w of vert.nbrs) {
      const wv = state.board.vertices[w];
      if (!state.buildings[w] && wv.nbrs.every((n) => !state.buildings[n])) best = Math.max(best, vertexValue(state, w, pi) * 0.7);
    }
  }
  return best + Math.random() * 0.01;
}

function bestRoad(state, pi, edges) {
  let best = edges[0];
  let bestS = -1;
  for (const e of edges) {
    const s = roadScore(state, pi, e);
    if (s > bestS) {
      bestS = s;
      best = e;
    }
  }
  return best;
}

function missing(hand, cost) {
  const m = {};
  for (const r of RESOURCES) if (hand[r] < (cost[r] || 0)) m[r] = (cost[r] || 0) - hand[r];
  return m;
}

// Which build is the bot working toward?
function goal(state, pi) {
  const p = state.players[pi];
  if (p.cities.length < LIMIT.city && p.settlements.length > 0) return COST.city;
  if (p.settlements.length < LIMIT.settlement) return COST.settlement;
  return COST.dev;
}

function discardAction(state, pi) {
  const need = state.turn.discards[pi];
  const hand = Object.assign({}, state.players[pi].hand);
  const cards = {};
  for (let i = 0; i < need; i++) {
    let r = RESOURCES[0];
    for (const x of RESOURCES) if (hand[x] > hand[r]) r = x;
    hand[r]--;
    cards[r] = (cards[r] || 0) + 1;
  }
  return { type: 'discard', cards };
}

function robberAction(state, pi) {
  let best = null;
  let bestS = -Infinity;
  for (const h of legalRobberHexes(state)) {
    const hex = state.board.hexes[h];
    let s = 0;
    for (const v of hex.vertices) {
      const b = state.buildings[v];
      if (!b) continue;
      const weight = (b.t === 'city' ? 2 : 1) * pips(hex.number);
      if (b.p === pi) s -= weight * 2.5;
      else s += weight * (1 + vpOf(state, b.p, false) / 10) + (total(state.players[b.p].hand) > 0 ? 1 : 0);
    }
    s += Math.random() * 0.1;
    if (s > bestS) {
      bestS = s;
      best = h;
    }
  }
  return { type: 'moveRobber', hex: best };
}

function evaluateOffer(state, pi, offer) {
  const p = state.players[pi];
  for (const [r, c] of Object.entries(offer.want)) if (p.hand[r] < c) return false;
  const lead = vpOf(state, offer.from, false);
  if (lead >= state.settings.vp - 2) return false;
  const target = missing(p.hand, goal(state, pi));
  let gain = 0;
  for (const [r, c] of Object.entries(offer.give)) gain += c * (target[r] ? 2 : p.hand[r] >= 3 ? 0.4 : 1);
  let loss = 0;
  for (const [r, c] of Object.entries(offer.want)) loss += c * (p.hand[r] > (target[r] ? 0 : 2) ? 0.6 : 1.4);
  return gain > loss + 0.5;
}

function bankTradeAction(state, pi) {
  const p = state.players[pi];
  const target = missing(p.hand, goal(state, pi));
  const wants = Object.keys(target);
  if (!wants.length) return null;
  const needed = (r) => (goal(state, pi)[r] || 0);
  for (const give of RESOURCES.slice().sort((a, b) => p.hand[b] - p.hand[a])) {
    const ratio = tradeRatio(state, pi, give);
    if (p.hand[give] - needed(give) >= ratio && !target[give]) {
      const get = wants.find((r) => state.bank[r] > 0);
      if (get) return { type: 'bankTrade', give, get };
    }
  }
  return null;
}

function mainAction(state, pi) {
  const p = state.players[pi];
  const hand = p.hand;

  if (p.cities.length < LIMIT.city && p.settlements.length && hasRes(hand, COST.city)) {
    let best = p.settlements[0];
    let bestP = -1;
    for (const v of p.settlements) {
      let s = 0;
      for (const h of state.board.vertices[v].hexes) s += pips(state.board.hexes[h].number);
      if (s > bestP) {
        bestP = s;
        best = v;
      }
    }
    return { type: 'buildCity', vertex: best };
  }
  if (p.settlements.length < LIMIT.settlement && hasRes(hand, COST.settlement)) {
    const spots = legalSettlementVertices(state, pi);
    if (spots.length) return { type: 'buildSettlement', vertex: bestVertex(state, pi, spots) };
  }
  const trade = bankTradeAction(state, pi);
  if (trade) return trade;

  if (!state.turn.devPlayed) {
    if (p.dev.knight > 0) return { type: 'playKnight' };
    if (p.dev.yearOfPlenty > 0) {
      const m = Object.keys(missing(hand, goal(state, pi)));
      const a = m[0] || 'ore';
      const b = m[1] || m[0] || 'grain';
      if (state.bank[a] > 0 && state.bank[b] > (a === b ? 1 : 0)) return { type: 'playYearOfPlenty', a, b };
    }
    if (p.dev.monopoly > 0) {
      const m = Object.keys(missing(hand, goal(state, pi)));
      return { type: 'playMonopoly', res: m[0] || 'ore' };
    }
    if (p.dev.roadBuilding > 0 && p.roads.length <= LIMIT.road - 2 && legalRoadEdges(state, pi).length) return { type: 'playRoadBuilding' };
  }

  if (hasRes(hand, COST.dev) && state.devDeck.length && p.cities.length + p.settlements.length >= 2) {
    const reserve = hasRes(hand, { grain: 2, ore: 3 }) ? 0 : 1;
    if (reserve === 0 || total(hand) >= 7 || p.settlements.length >= LIMIT.settlement) return { type: 'buyDev' };
  }
  if (p.roads.length < LIMIT.road && hasRes(hand, COST.road)) {
    const spots = legalSettlementVertices(state, pi);
    const needRoad = p.settlements.length < LIMIT.settlement && spots.length === 0;
    if (needRoad || total(hand) > 7) {
      const edges = legalRoadEdges(state, pi);
      if (edges.length) return { type: 'buildRoad', edge: bestRoad(state, pi, edges) };
    }
  }
  return { type: 'endTurn' };
}

// Decide what bot `pi` should do right now, or null if it has nothing to do.
function botAct(state, pi) {
  const p = state.players[pi];
  if (state.phase === 'over') return null;

  if (state.phase === 'setup') {
    if (state.cur !== pi) return null;
    if (state.setup.sub === 'settlement') return { type: 'buildSettlement', vertex: bestVertex(state, pi, legalSetupVertices(state)) };
    return { type: 'buildRoad', edge: bestRoad(state, pi, legalSetupRoads(state)) };
  }

  const t = state.turn;
  if (t.step === 'discard') return t.discards[pi] ? discardAction(state, pi) : null;

  for (const o of state.offers) {
    if (o.from === pi) continue;
    if (o.to && !o.to.includes(pi)) continue;
    if (o.accepted.includes(pi) || o.declined.includes(pi)) continue;
    return { type: 'respondTrade', offer: o.id, accept: evaluateOffer(state, pi, o) };
  }
  if (state.cur !== pi) return null;

  if (t.acts > 60 && t.step === 'main') return { type: 'endTurn' };

  switch (t.step) {
    case 'roll': {
      if (p.dev.knight > 0 && !t.devPlayed) {
        const rob = state.board.hexes[state.robber];
        const mine = rob.vertices.some((v) => state.buildings[v] && state.buildings[v].p === pi);
        if (mine && pips(rob.number) >= 3) return { type: 'playKnight' };
      }
      return { type: 'roll' };
    }
    case 'robber':
      return robberAction(state, pi);
    case 'steal': {
      let best = t.victims[0];
      for (const v of t.victims) if (total(state.players[v].hand) > total(state.players[best].hand)) best = v;
      return { type: 'steal', victim: best };
    }
    case 'roadbuilding': {
      const edges = legalRoadEdges(state, pi);
      return { type: 'buildRoad', edge: bestRoad(state, pi, edges) };
    }
    case 'main':
      return mainAction(state, pi);
    default:
      return null;
  }
}

module.exports = { botAct, vertexValue };

