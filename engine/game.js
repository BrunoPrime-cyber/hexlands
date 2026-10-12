'use strict';
// Hexlands rules engine. Pure, deterministic and JSON-serialisable: all
// randomness flows through state.rng so a game can be replayed from its seed
// and the list of accepted actions.

const { makeRng, seedHolder } = require("./rng.js");
const { generateBoard, RESOURCES, TERRAIN_RES, describeMaps } = require("./board.js");
const { getMap } = require("./maps.js");

const COST = {
  road: { timber: 1, clay: 1 },
  settlement: { timber: 1, clay: 1, wool: 1, grain: 1 },
  city: { grain: 2, ore: 3 },
  dev: { wool: 1, grain: 1, ore: 1 },
};
const LIMIT = { road: 15, settlement: 5, city: 4 };
const DEV_TYPES = ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'vp'];
const PLAYABLE_DEV = ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly'];

const DEFAULT_SETTINGS = {
  map: 'classic',
  vp: 10,
  dice: 'random', // 'random' | 'balanced'
  friendlyRobber: false,
  discardLimit: 7,
  quickStart: false,
  balanced: true,
};

const emptyHand = () => ({ timber: 0, clay: 0, wool: 0, grain: 0, ore: 0 });
const emptyDev = () => ({ knight: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0, vp: 0 });
const total = (h) => RESOURCES.reduce((a, r) => a + h[r], 0);
const sumObj = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const isRes = (r) => RESOURCES.includes(r);

function sanitizeSettings(input) {
  const s = Object.assign({}, DEFAULT_SETTINGS, input || {});
  if (!getMap(s.map)) s.map = DEFAULT_SETTINGS.map;
  s.vp = Math.max(4, Math.min(30, Math.floor(Number(s.vp)) || 10));
  s.dice = s.dice === 'balanced' ? 'balanced' : 'random';
  s.friendlyRobber = !!s.friendlyRobber;
  s.discardLimit = Math.max(4, Math.min(20, Math.floor(Number(s.discardLimit)) || 7));
  s.quickStart = !!s.quickStart;
  s.balanced = s.balanced !== false;
  return s;
}

function devDeckFor(playerCount, hexCount) {
  let comp;
  if (playerCount <= 4 && hexCount <= 24) comp = { knight: 14, vp: 5, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2 };
  else if (hexCount <= 32) comp = { knight: 20, vp: 5, roadBuilding: 3, yearOfPlenty: 3, monopoly: 3 };
  else comp = { knight: 26, vp: 6, roadBuilding: 4, yearOfPlenty: 4, monopoly: 4 };
  const deck = [];
  for (const [k, n] of Object.entries(comp)) for (let i = 0; i < n; i++) deck.push(k);
  return deck;
}

function createGame(cfg) {
  const settings = sanitizeSettings(cfg.settings);
  const seed = (cfg.seed >>> 0) || ((Math.random() * 4294967296) >>> 0) || 1;
  const holder = seedHolder(seed);
  const rng = makeRng(holder);
  const board = generateBoard(settings.map, { balanced: settings.balanced }, rng);
  const n = cfg.players.length;
  if (n < 2) throw new Error('need at least 2 players');
  if (n > board.maxPlayers) throw new Error(`this map supports at most ${board.maxPlayers} players`);

  const players = rng.shuffle(
    cfg.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      bot: !!p.bot,
      hand: emptyHand(),
      dev: emptyDev(),
      devNew: emptyDev(),
      knights: 0,
      roads: [],
      settlements: [],
      cities: [],
      longest: 0,
    }))
  );

  const hexCount = board.hexes.length;
  const bankPer = hexCount <= 19 ? 19 : hexCount <= 30 ? 24 : 30;
  const bank = {};
  for (const r of RESOURCES) bank[r] = bankPer;

  const order = [];
  for (let i = 0; i < n; i++) order.push(i);
  for (let i = n - 1; i >= 0; i--) order.push(i);

  const state = {
    v: 1,
    seed,
    settings,
    rng: holder,
    board,
    players,
    phase: 'setup',
    cur: 0,
    setup: { i: 0, sub: 'settlement', last: null, order },
    turn: { n: 0, step: 'setup', dice: null, devPlayed: false, after: 'main', discards: {}, roadsLeft: 0, victims: [] },
    robber: board.desert,
    buildings: {},
    roads: {},
    bank,
    devDeck: rng.shuffle(devDeckFor(n, hexCount)),
    devTotal: 0,
    diceDeck: [],
    offers: [],
    offerSeq: 0,
    longestHolder: null,
    armyHolder: null,
    winner: null,
    log: [],
    seq: 0,
    actions: 0,
  };
  state.devTotal = state.devDeck.length;
  state.cur = order[0];
  emit(state, { t: 'start', map: board.name });
  return state;
}

function emit(state, ev) {
  ev.seq = ++state.seq;
  state.log.push(ev);
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
}

// ---- queries ---------------------------------------------------------------

function vpOf(state, pi, withHidden) {
  const p = state.players[pi];
  let v = p.settlements.length + p.cities.length * 2;
  if (state.longestHolder === pi) v += 2;
  if (state.armyHolder === pi) v += 2;
  if (withHidden) v += p.dev.vp + p.devNew.vp;
  return v;
}

function portsFor(state, pi) {
  const res = new Set();
  let any = false;
  for (const port of state.board.ports) {
    const a = state.buildings[port.a];
    const b = state.buildings[port.b];
    if ((a && a.p === pi) || (b && b.p === pi)) {
      if (port.type === 'any') any = true;
      else res.add(port.type);
    }
  }
  return { any, res };
}

function tradeRatio(state, pi, res) {
  const { any, res: set } = portsFor(state, pi);
  if (set.has(res)) return 2;
  if (any) return 3;
  return 4;
}

const distanceOk = (state, v) => state.board.vertices[v].nbrs.every((nb) => !state.buildings[nb]);
const ownRoadAt = (state, pi, v) => state.board.vertices[v].edges.some((e) => state.roads[e] === pi);

function legalSetupVertices(state) {
  const out = [];
  for (const v of state.board.vertices) if (!state.buildings[v.id] && distanceOk(state, v.id)) out.push(v.id);
  return out;
}

function legalSettlementVertices(state, pi) {
  const out = [];
  for (const v of state.board.vertices) {
    if (!state.buildings[v.id] && distanceOk(state, v.id) && ownRoadAt(state, pi, v.id)) out.push(v.id);
  }
  return out;
}

function roadConnects(state, pi, e) {
  const edge = state.board.edges[e];
  for (const u of [edge.a, edge.b]) {
    const b = state.buildings[u];
    if (b && b.p === pi) return true;
    if (!(b && b.p !== pi) && ownRoadAt(state, pi, u)) return true;
  }
  return false;
}

function legalRoadEdges(state, pi) {
  const out = [];
  for (const e of state.board.edges) {
    if (state.roads[e.id] === undefined && roadConnects(state, pi, e.id)) out.push(e.id);
  }
  return out;
}

function legalSetupRoads(state) {
  const v = state.setup.last;
  if (v === null) return [];
  return state.board.vertices[v].edges.filter((e) => state.roads[e] === undefined);
}

function legalRobberHexes(state) {
  const out = [];
  for (const h of state.board.hexes) {
    if (h.id === state.robber) continue;
    if (state.settings.friendlyRobber) {
      let blocked = false;
      for (const v of h.vertices) {
        const b = state.buildings[v];
        if (b && b.p !== state.cur && vpOf(state, b.p, false) <= 2) blocked = true;
      }
      if (blocked) continue;
    }
    out.push(h.id);
  }
  return out;
}

function longestRoadLen(state, pi) {
  const mine = state.players[pi].roads;
  if (!mine.length) return 0;
  const adj = new Map();
  for (const e of mine) {
    const edge = state.board.edges[e];
    for (const v of [edge.a, edge.b]) {
      if (!adj.has(v)) adj.set(v, []);
      adj.get(v).push(e);
    }
  }
  const blocked = (v) => {
    const b = state.buildings[v];
    return !!b && b.p !== pi;
  };
  let best = 0;
  const used = new Set();
  const dfs = (v, len) => {
    if (len > best) best = len;
    for (const e of adj.get(v) || []) {
      if (used.has(e)) continue;
      const edge = state.board.edges[e];
      const w = edge.a === v ? edge.b : edge.a;
      used.add(e);
      if (blocked(w)) {
        if (len + 1 > best) best = len + 1;
      } else dfs(w, len + 1);
      used.delete(e);
    }
  };
  for (const v of adj.keys()) dfs(v, 0);
  return best;
}

function updateLongest(state) {
  let max = 0;
  state.players.forEach((p, i) => {
    p.longest = longestRoadLen(state, i);
    if (p.longest > max) max = p.longest;
  });
  let holder = null;
  if (max >= 5) {
    const top = [];
    state.players.forEach((p, i) => {
      if (p.longest === max) top.push(i);
    });
    if (state.longestHolder !== null && top.includes(state.longestHolder)) holder = state.longestHolder;
    else if (top.length === 1) holder = top[0];
  }
  if (holder !== state.longestHolder) {
    state.longestHolder = holder;
    emit(state, { t: 'longest', p: holder });
  }
}

function updateArmy(state, pi) {
  const p = state.players[pi];
  if (p.knights < 3) return;
  const h = state.armyHolder;
  if (h === null || (h !== pi && p.knights > state.players[h].knights)) {
    state.armyHolder = pi;
    emit(state, { t: 'army', p: pi });
  }
}

// ---- helpers ---------------------------------------------------------------

const hasRes = (hand, cost) => RESOURCES.every((r) => hand[r] >= (cost[r] || 0));

function pay(state, p, cost) {
  for (const r of RESOURCES) {
    const c = cost[r] || 0;
    p.hand[r] -= c;
    state.bank[r] += c;
  }
}

function giveFromBank(state, p, res, n) {
  const k = Math.min(n, state.bank[res]);
  p.hand[res] += k;
  state.bank[res] -= k;
  return k;
}

function drawDice(state) {
  const rng = makeRng(state.rng);
  if (state.settings.dice === 'balanced') {
    if (!state.diceDeck.length) {
      const deck = [];
      for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) deck.push([a, b]);
      state.diceDeck = rng.shuffle(deck);
    }
    return state.diceDeck.pop();
  }
  return [1 + rng.int(6), 1 + rng.int(6)];
}

function produce(state, sum) {
  const gains = state.players.map(() => emptyHand());
  for (const h of state.board.hexes) {
    if (h.number !== sum || h.id === state.robber || h.terrain === 'desert') continue;
    const res = TERRAIN_RES[h.terrain];
    for (const v of h.vertices) {
      const b = state.buildings[v];
      if (b) gains[b.p][res] += b.t === 'city' ? 2 : 1;
    }
  }
  const shortages = [];
  for (const r of RESOURCES) {
    const demand = gains.reduce((a, g) => a + g[r], 0);
    if (!demand) continue;
    if (state.bank[r] >= demand) continue;
    const receivers = gains.map((g, i) => (g[r] > 0 ? i : -1)).filter((i) => i >= 0);
    if (receivers.length === 1) gains[receivers[0]][r] = state.bank[r];
    else gains.forEach((g) => (g[r] = 0));
    shortages.push(r);
  }
  const summary = [];
  gains.forEach((g, i) => {
    if (!total(g)) return;
    for (const r of RESOURCES) if (g[r]) giveFromBank(state, state.players[i], r, g[r]);
    summary.push({ p: i, res: g });
  });
  emit(state, { t: 'produce', sum, gains: summary, short: shortages });
}

function startRobber(state, after) {
  state.turn.step = 'robber';
  state.turn.after = after;
  state.turn.victims = [];
}

function finishRobber(state) {
  state.turn.step = state.turn.after;
  state.turn.victims = [];
}

function stealFrom(state, thief, victim) {
  const v = state.players[victim];
  const pool = [];
  for (const r of RESOURCES) for (let i = 0; i < v.hand[r]; i++) pool.push(r);
  if (!pool.length) return;
  const r = makeRng(state.rng).pick(pool);
  v.hand[r]--;
  state.players[thief].hand[r]++;
  emit(state, { t: 'steal', p: thief, from: victim });
}

function clearOffers(state) {
  state.offers = [];
}

function checkWin(state) {
  if (state.phase !== 'main') return;
  if (vpOf(state, state.cur, true) >= state.settings.vp) {
    state.phase = 'over';
    state.winner = state.cur;
    state.turn.step = 'over';
    clearOffers(state);
    emit(state, { t: 'win', p: state.cur });
  }
}

function finishSetup(state) {
  state.phase = 'main';
  state.cur = 0;
  state.turn = { n: 1, step: 'roll', dice: null, devPlayed: false, after: 'main', discards: {}, roadsLeft: 0, victims: [] };
  if (state.settings.quickStart) {
    for (const p of state.players) {
      for (const [r, c] of Object.entries({ timber: 2, clay: 2, wool: 1, grain: 1 })) giveFromBank(state, p, r, c);
    }
  }
  updateLongest(state);
  emit(state, { t: 'turn', p: 0, n: 1 });
}

// ---- action handlers (return an error string, or null on success) ----------

function needMain(state, pi) {
  if (state.phase !== 'main') return 'The game is not in the main phase';
  if (state.cur !== pi) return 'Not your turn';
  return null;
}

function aSetupSettlement(state, pi, a) {
  if (state.setup.sub !== 'settlement') return 'Place a road now';
  const v = a.vertex;
  if (!Number.isInteger(v) || !state.board.vertices[v]) return 'Invalid spot';
  if (state.buildings[v] || !distanceOk(state, v)) return 'That spot is not allowed';
  const p = state.players[pi];
  state.buildings[v] = { p: pi, t: 'settlement' };
  p.settlements.push(v);
  state.setup.last = v;
  state.setup.sub = 'road';
  emit(state, { t: 'build', p: pi, what: 'settlement', at: v });
  if (state.setup.i >= state.players.length) {
    for (const h of state.board.vertices[v].hexes) {
      const hex = state.board.hexes[h];
      if (hex.terrain !== 'desert') giveFromBank(state, p, TERRAIN_RES[hex.terrain], 1);
    }
  }
  return null;
}

function aSetupRoad(state, pi, a) {
  if (state.setup.sub !== 'road') return 'Place a settlement first';
  const e = a.edge;
  if (!Number.isInteger(e) || !legalSetupRoads(state).includes(e)) return 'That road is not allowed';
  state.roads[e] = pi;
  state.players[pi].roads.push(e);
  emit(state, { t: 'build', p: pi, what: 'road', at: e });
  state.setup.i++;
  state.setup.sub = 'settlement';
  state.setup.last = null;
  if (state.setup.i >= state.setup.order.length) finishSetup(state);
  else state.cur = state.setup.order[state.setup.i];
  return null;
}

function aRoll(state, pi) {
  const err = needMain(state, pi);
  if (err) return err;
  if (state.turn.step !== 'roll') return 'You already rolled';
  const dice = drawDice(state);
  state.turn.dice = dice;
  emit(state, { t: 'roll', p: pi, d: dice });
  const sum = dice[0] + dice[1];
  if (sum === 7) {
    const needs = {};
    state.players.forEach((p, i) => {
      const t = total(p.hand);
      if (t > state.settings.discardLimit) needs[i] = Math.floor(t / 2);
    });
    if (Object.keys(needs).length) {
      state.turn.step = 'discard';
      state.turn.discards = needs;
    } else startRobber(state, 'main');
  } else {
    produce(state, sum);
    state.turn.step = 'main';
  }
  return null;
}

function aDiscard(state, pi, a) {
  if (state.phase !== 'main' || state.turn.step !== 'discard') return 'Nobody needs to discard';
  const need = state.turn.discards[pi];
  if (!need) return 'You do not need to discard';
  const cards = a.cards || {};
  let n = 0;
  for (const [r, c] of Object.entries(cards)) {
    if (!isRes(r) || !Number.isInteger(c) || c < 0) return 'Bad discard';
    if (c > state.players[pi].hand[r]) return 'You do not have those cards';
    n += c;
  }
  if (n !== need) return `Discard exactly ${need} cards`;
  const p = state.players[pi];
  for (const [r, c] of Object.entries(cards)) {
    p.hand[r] -= c;
    state.bank[r] += c;
  }
  delete state.turn.discards[pi];
  emit(state, { t: 'discard', p: pi, n });
  if (!Object.keys(state.turn.discards).length) startRobber(state, 'main');
  return null;
}

function aMoveRobber(state, pi, a) {
  const err = needMain(state, pi);
  if (err) return err;
  if (state.turn.step !== 'robber') return 'You cannot move the robber now';
  if (!Number.isInteger(a.hex) || !legalRobberHexes(state).includes(a.hex)) return 'The robber cannot go there';
  state.robber = a.hex;
  emit(state, { t: 'robber', p: pi, hex: a.hex });
  const victims = [];
  for (const v of state.board.hexes[a.hex].vertices) {
    const b = state.buildings[v];
    if (b && b.p !== pi && !victims.includes(b.p) && total(state.players[b.p].hand) > 0) victims.push(b.p);
  }
  if (victims.length === 0) finishRobber(state);
  else if (victims.length === 1) {
    stealFrom(state, pi, victims[0]);
    finishRobber(state);
  } else {
    state.turn.step = 'steal';
    state.turn.victims = victims;
  }
  return null;
}

function aSteal(state, pi, a) {
  const err = needMain(state, pi);
  if (err) return err;
  if (state.turn.step !== 'steal') return 'Nobody to steal from';
  if (!state.turn.victims.includes(a.victim)) return 'Pick one of the highlighted players';
  stealFrom(state, pi, a.victim);
  finishRobber(state);
  return null;
}

function aBuildRoad(state, pi, a) {
  if (state.phase === 'setup') return aSetupRoad(state, pi, a);
  const err = needMain(state, pi);
  if (err) return err;
  const free = state.turn.step === 'roadbuilding';
  if (!free && state.turn.step !== 'main') return 'You cannot build now';
  const p = state.players[pi];
  if (p.roads.length >= LIMIT.road) return 'No road pieces left';
  if (!free && !hasRes(p.hand, COST.road)) return 'Not enough resources';
  const e = a.edge;
  if (!Number.isInteger(e) || !state.board.edges[e]) return 'Invalid spot';
  if (state.roads[e] !== undefined) return 'That edge is taken';
  if (!roadConnects(state, pi, e)) return 'A road must connect to your network';
  if (!free) pay(state, p, COST.road);
  state.roads[e] = pi;
  p.roads.push(e);
  emit(state, { t: 'build', p: pi, what: 'road', at: e, free });
  updateLongest(state);
  if (free) {
    state.turn.roadsLeft--;
    if (state.turn.roadsLeft <= 0 || p.roads.length >= LIMIT.road || !legalRoadEdges(state, pi).length) {
      state.turn.roadsLeft = 0;
      state.turn.step = state.turn.after;
    }
  }
  return null;
}

function aBuildSettlement(state, pi, a) {
  if (state.phase === 'setup') return aSetupSettlement(state, pi, a);
  const err = needMain(state, pi);
  if (err) return err;
  if (state.turn.step !== 'main') return 'You cannot build now';
  const p = state.players[pi];
  if (p.settlements.length >= LIMIT.settlement) return 'No settlement pieces left';
  if (!hasRes(p.hand, COST.settlement)) return 'Not enough resources';
  const v = a.vertex;
  if (!Number.isInteger(v) || !state.board.vertices[v]) return 'Invalid spot';
  if (state.buildings[v]) return 'That spot is taken';
  if (!distanceOk(state, v)) return 'Too close to another settlement';
  if (!ownRoadAt(state, pi, v)) return 'A settlement must touch one of your roads';
  pay(state, p, COST.settlement);
  state.buildings[v] = { p: pi, t: 'settlement' };
  p.settlements.push(v);
  emit(state, { t: 'build', p: pi, what: 'settlement', at: v });
  updateLongest(state);
  return null;
}

function aBuildCity(state, pi, a) {
  const err = needMain(state, pi);
  if (err) return err;
  if (state.turn.step !== 'main') return 'You cannot build now';
  const p = state.players[pi];
  if (p.cities.length >= LIMIT.city) return 'No city pieces left';
  if (!hasRes(p.hand, COST.city)) return 'Not enough resources';
  const v = a.vertex;
  const b = state.buildings[v];
  if (!b || b.p !== pi || b.t !== 'settlement') return 'Upgrade one of your settlements';
  pay(state, p, COST.city);
  b.t = 'city';
  p.settlements.splice(p.settlements.indexOf(v), 1);
  p.cities.push(v);
  emit(state, { t: 'build', p: pi, what: 'city', at: v });
  return null;
}

function aBuyDev(state, pi) {
  const err = needMain(state, pi);
  if (err) return err;
  if (state.turn.step !== 'main') return 'You cannot buy now';
  const p = state.players[pi];
  if (!state.devDeck.length) return 'The development deck is empty';
  if (!hasRes(p.hand, COST.dev)) return 'Not enough resources';
  pay(state, p, COST.dev);
  const card = state.devDeck.pop();
  p.devNew[card]++;
  emit(state, { t: 'devbuy', p: pi });
  return null;
}

function devGuard(state, pi, card) {
  const err = needMain(state, pi);
  if (err) return err;
  if (state.turn.step !== 'roll' && state.turn.step !== 'main') return 'You cannot play a card now';
  if (state.turn.devPlayed) return 'Only one development card per turn';
  if (state.players[pi].dev[card] < 1) return 'You do not have that card (cards bought this turn must wait)';
  return null;
}

function aPlayKnight(state, pi) {
  const err = devGuard(state, pi, 'knight');
  if (err) return err;
  const p = state.players[pi];
  p.dev.knight--;
  p.knights++;
  state.turn.devPlayed = true;
  emit(state, { t: 'dev', p: pi, card: 'knight' });
  updateArmy(state, pi);
  clearOffers(state);
  startRobber(state, state.turn.step);
  return null;
}

function aPlayRoadBuilding(state, pi) {
  const err = devGuard(state, pi, 'roadBuilding');
  if (err) return err;
  const p = state.players[pi];
  if (p.roads.length >= LIMIT.road) return 'No road pieces left';
  if (!legalRoadEdges(state, pi).length) return 'You have nowhere to build a road';
  p.dev.roadBuilding--;
  state.turn.devPlayed = true;
  state.turn.roadsLeft = Math.min(2, LIMIT.road - p.roads.length);
  state.turn.after = state.turn.step;
  state.turn.step = 'roadbuilding';
  emit(state, { t: 'dev', p: pi, card: 'roadBuilding' });
  clearOffers(state);
  return null;
}

function aPlayYearOfPlenty(state, pi, a) {
  const err = devGuard(state, pi, 'yearOfPlenty');
  if (err) return err;
  if (!isRes(a.a) || !isRes(a.b)) return 'Pick two resources';
  const need = {};
  need[a.a] = (need[a.a] || 0) + 1;
  need[a.b] = (need[a.b] || 0) + 1;
  for (const [r, c] of Object.entries(need)) if (state.bank[r] < c) return 'The bank is out of that resource';
  const p = state.players[pi];
  p.dev.yearOfPlenty--;
  state.turn.devPlayed = true;
  giveFromBank(state, p, a.a, 1);
  giveFromBank(state, p, a.b, 1);
  emit(state, { t: 'dev', p: pi, card: 'yearOfPlenty', res: [a.a, a.b] });
  return null;
}

function aPlayMonopoly(state, pi, a) {
  const err = devGuard(state, pi, 'monopoly');
  if (err) return err;
  if (!isRes(a.res)) return 'Pick a resource';
  const p = state.players[pi];
  p.dev.monopoly--;
  state.turn.devPlayed = true;
  let taken = 0;
  state.players.forEach((o, i) => {
    if (i === pi) return;
    taken += o.hand[a.res];
    p.hand[a.res] += o.hand[a.res];
    o.hand[a.res] = 0;
  });
  emit(state, { t: 'dev', p: pi, card: 'monopoly', res: a.res, n: taken });
  return null;
}

function aBankTrade(state, pi, a) {
  const err = needMain(state, pi);
  if (err) return err;
  if (state.turn.step !== 'main') return 'You can only trade after rolling';
  if (!isRes(a.give) || !isRes(a.get) || a.give === a.get) return 'Pick two different resources';
  const p = state.players[pi];
  const ratio = tradeRatio(state, pi, a.give);
  if (p.hand[a.give] < ratio) return `You need ${ratio} ${a.give} for this trade`;
  if (state.bank[a.get] < 1) return 'The bank is out of that resource';
  p.hand[a.give] -= ratio;
  state.bank[a.give] += ratio;
  p.hand[a.get] += 1;
  state.bank[a.get] -= 1;
  emit(state, { t: 'bank', p: pi, give: a.give, get: a.get, ratio });
  return null;
}

function cleanBundle(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return null;
  for (const [r, c] of Object.entries(obj)) {
    if (!isRes(r) || !Number.isInteger(c) || c < 0 || c > 19) return null;
    if (c > 0) out[r] = c;
  }
  return out;
}

function aProposeTrade(state, pi, a) {
  const err = needMain(state, pi);
  if (err) return err;
  if (state.turn.step !== 'main') return 'You can only trade after rolling';
  const give = cleanBundle(a.give);
  const want = cleanBundle(a.want);
  if (!give || !want || !sumObj(give) || !sumObj(want)) return 'Offer something and ask for something';
  for (const r of Object.keys(give)) if (want[r]) return 'Do not ask for a resource you are offering';
  const p = state.players[pi];
  for (const [r, c] of Object.entries(give)) if (p.hand[r] < c) return 'You do not have those cards';
  let to = null;
  if (Array.isArray(a.to) && a.to.length) {
    to = [...new Set(a.to)].filter((i) => Number.isInteger(i) && i !== pi && state.players[i]);
    if (!to.length) return 'Pick someone to trade with';
  }
  const offer = { id: ++state.offerSeq, from: pi, give, want, to, accepted: [], declined: [] };
  state.offers = [offer];
  emit(state, { t: 'offer', p: pi, give, want });
  return null;
}

function aRespondTrade(state, pi, a) {
  if (state.phase !== 'main') return 'No trade in progress';
  const offer = state.offers.find((o) => o.id === a.offer);
  if (!offer) return 'That offer is gone';
  if (offer.from === pi) return 'You made this offer';
  if (offer.to && !offer.to.includes(pi)) return 'This offer is not for you';
  const p = state.players[pi];
  offer.accepted = offer.accepted.filter((i) => i !== pi);
  offer.declined = offer.declined.filter((i) => i !== pi);
  if (a.accept) {
    for (const [r, c] of Object.entries(offer.want)) if (p.hand[r] < c) return 'You do not have the cards to accept';
    offer.accepted.push(pi);
  } else offer.declined.push(pi);
  return null;
}

function aConfirmTrade(state, pi, a) {
  const err = needMain(state, pi);
  if (err) return err;
  const offer = state.offers.find((o) => o.id === a.offer);
  if (!offer || offer.from !== pi) return 'That offer is gone';
  const partner = a.with;
  if (!offer.accepted.includes(partner)) return 'That player has not accepted';
  const me = state.players[pi];
  const other = state.players[partner];
  for (const [r, c] of Object.entries(offer.give)) if (me.hand[r] < c) return 'You no longer have those cards';
  for (const [r, c] of Object.entries(offer.want)) if (other.hand[r] < c) return 'They no longer have those cards';
  for (const [r, c] of Object.entries(offer.give)) {
    me.hand[r] -= c;
    other.hand[r] += c;
  }
  for (const [r, c] of Object.entries(offer.want)) {
    other.hand[r] -= c;
    me.hand[r] += c;
  }
  emit(state, { t: 'trade', p: pi, with: partner, give: offer.give, want: offer.want });
  clearOffers(state);
  return null;
}

function aCancelTrade(state, pi) {
  const err = needMain(state, pi);
  if (err) return err;
  clearOffers(state);
  return null;
}

function aEndTurn(state, pi) {
  const err = needMain(state, pi);
  if (err) return err;
  if (state.turn.step !== 'main') return 'Finish your turn first (roll, then act)';
  const p = state.players[pi];
  for (const k of DEV_TYPES) {
    p.dev[k] += p.devNew[k];
    p.devNew[k] = 0;
  }
  clearOffers(state);
  const n = state.players.length;
  state.cur = (state.cur + 1) % n;
  state.turn = {
    n: state.turn.n + 1,
    step: 'roll',
    dice: null,
    devPlayed: false,
    after: 'main',
    discards: {},
    roadsLeft: 0,
    victims: [],
  };
  emit(state, { t: 'turn', p: state.cur, n: state.turn.n });
  checkWin(state);
  return null;
}

const HANDLERS = {
  roll: aRoll,
  discard: aDiscard,
  moveRobber: aMoveRobber,
  steal: aSteal,
  buildRoad: aBuildRoad,
  buildSettlement: aBuildSettlement,
  buildCity: aBuildCity,
  buyDev: aBuyDev,
  playKnight: aPlayKnight,
  playRoadBuilding: aPlayRoadBuilding,
  playYearOfPlenty: aPlayYearOfPlenty,
  playMonopoly: aPlayMonopoly,
  bankTrade: aBankTrade,
  proposeTrade: aProposeTrade,
  respondTrade: aRespondTrade,
  confirmTrade: aConfirmTrade,
  cancelTrade: aCancelTrade,
  endTurn: aEndTurn,
};

// Apply an action by player index `pi`. Returns { ok: true } or { ok: false, error }.
function act(state, pi, action) {
  if (!action || typeof action.type !== 'string') return { ok: false, error: 'Bad action' };
  if (state.phase === 'over') return { ok: false, error: 'The game is over' };
  if (!Number.isInteger(pi) || !state.players[pi]) return { ok: false, error: 'Unknown player' };
  const isDiscard = action.type === 'discard';
  const isTradeReply = action.type === 'respondTrade';
  if (state.phase === 'setup') {
    if (state.cur !== pi) return { ok: false, error: 'Not your turn' };
    if (action.type !== 'buildSettlement' && action.type !== 'buildRoad') return { ok: false, error: 'Place your starting pieces' };
  } else if (!isDiscard && !isTradeReply && state.cur !== pi) {
    return { ok: false, error: 'Not your turn' };
  }
  if (state.phase === 'main' && state.turn.step === 'discard' && !isDiscard) return { ok: false, error: 'Waiting for discards' };
  const h = HANDLERS[action.type];
  if (!h) return { ok: false, error: 'Unknown action' };
  const error = h(state, pi, action);
  if (error) return { ok: false, error };
  state.actions++;
  state.turn.acts = (state.turn.acts || 0) + 1;
  if (state.phase === 'main') checkWin(state);
  return { ok: true };
}

// Players who may need to act right now (used to drive bots / "waiting for" UI).
function pendingActors(state) {
  if (state.phase === 'over') return [];
  if (state.phase === 'setup') return [state.cur];
  if (state.turn.step === 'discard') return Object.keys(state.turn.discards).map(Number);
  const out = [state.cur];
  for (const o of state.offers) {
    state.players.forEach((_, i) => {
      if (i === o.from || out.includes(i)) return;
      if (o.to && !o.to.includes(i)) return;
      if (o.accepted.includes(i) || o.declined.includes(i)) return;
      out.push(i);
    });
  }
  return out;
}

// ---- views -----------------------------------------------------------------

function legalHints(state, pi) {
  const hints = {};
  if (state.phase === 'over' || state.cur !== pi) {
    if (state.phase === 'main' && state.turn.step === 'discard' && state.turn.discards[pi]) hints.discard = state.turn.discards[pi];
    return hints;
  }
  const p = state.players[pi];
  if (state.phase === 'setup') {
    if (state.setup.sub === 'settlement') hints.vertices = legalSetupVertices(state);
    else hints.edges = legalSetupRoads(state);
    return hints;
  }
  const step = state.turn.step;
  if (step === 'discard') {
    if (state.turn.discards[pi]) hints.discard = state.turn.discards[pi];
  } else if (step === 'robber') hints.hexes = legalRobberHexes(state);
  else if (step === 'steal') hints.victims = state.turn.victims.slice();
  else if (step === 'roadbuilding') hints.edges = legalRoadEdges(state, pi);
  else if (step === 'main') {
    if (p.roads.length < LIMIT.road && hasRes(p.hand, COST.road)) hints.roads = legalRoadEdges(state, pi);
    if (p.settlements.length < LIMIT.settlement && hasRes(p.hand, COST.settlement)) hints.settlements = legalSettlementVertices(state, pi);
    if (p.cities.length < LIMIT.city && hasRes(p.hand, COST.city)) hints.cities = p.settlements.slice();
  }
  return hints;
}

function publicPlayer(state, i) {
  const p = state.players[i];
  return {
    i,
    id: p.id,
    name: p.name,
    color: p.color,
    bot: p.bot,
    vp: vpOf(state, i, false),
    cards: total(p.hand),
    dev: sumObj(p.dev) + sumObj(p.devNew),
    knights: p.knights,
    longest: p.longest,
    hasLongest: state.longestHolder === i,
    hasArmy: state.armyHolder === i,
    roads: p.roads.length,
    settlements: p.settlements.length,
    cities: p.cities.length,
  };
}

// The state as seen by player index `pi` (pi = -1 for spectators / replays).
function viewFor(state, pi, opts) {
  const o = opts || {};
  const me = state.players[pi] || null;
  const over = state.phase === 'over';
  const view = {
    phase: state.phase,
    cur: state.cur,
    settings: state.settings,
    turn: {
      n: state.turn.n,
      step: state.turn.step,
      dice: state.turn.dice,
      devPlayed: state.turn.devPlayed,
      roadsLeft: state.turn.roadsLeft,
      victims: state.turn.victims,
      discards: Object.keys(state.turn.discards).map((k) => ({ p: Number(k), need: state.turn.discards[k] })),
    },
    setup: state.phase === 'setup' ? { i: state.setup.i, total: state.setup.order.length, sub: state.setup.sub } : null,
    players: state.players.map((_, i) => publicPlayer(state, i)),
    buildings: state.buildings,
    roads: state.roads,
    robber: state.robber,
    bank: state.bank,
    deckLeft: state.devDeck.length,
    offers: state.offers,
    log: state.log.slice(-80),
    winner: state.winner,
    longestHolder: state.longestHolder,
    armyHolder: state.armyHolder,
    youIndex: pi,
    you: me
      ? {
          hand: me.hand,
          dev: me.dev,
          devNew: me.devNew,
          playable: Object.fromEntries(PLAYABLE_DEV.map((k) => [k, me.dev[k] > 0])),
          vpHidden: me.dev.vp + me.devNew.vp,
          ratios: Object.fromEntries(RESOURCES.map((r) => [r, tradeRatio(state, pi, r)])),
        }
      : null,
    hints: me ? legalHints(state, pi) : {},
    actions: state.actions,
  };
  if (over) {
    view.final = state.players.map((p, i) => ({
      i,
      vp: vpOf(state, i, true),
      vpCards: p.dev.vp + p.devNew.vp,
      hand: p.hand,
    }));
  }
  if (o.withBoard) view.board = state.board;
  return view;
}

module.exports = {
  COST,
  LIMIT,
  DEFAULT_SETTINGS,
  RESOURCES,
  TERRAIN_RES,
  sanitizeSettings,
  createGame,
  act,
  viewFor,
  pendingActors,
  vpOf,
  total,
  emptyHand,
  portsFor,
  tradeRatio,
  legalSetupVertices,
  legalSettlementVertices,
  legalRoadEdges,
  legalSetupRoads,
  legalRobberHexes,
  longestRoadLen,
  describeMaps,
  _updateLongest: updateLongest,
};

