'use strict';
// Hexlands server: zero dependencies. Static files + JSON API + Server-Sent Events.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const G = require("../engine/game.js");
const { botAct } = require("../engine/bot.js");
const { describeMaps } = require("../engine/board.js");

const VERSION = require("../package.json").version;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const CLIENT_DIR = path.join(__dirname, '..', 'client');
// The single-file build (Hexlands.exe / hexlands.js) carries the client files inside itself and keeps saves per user.
const EMBEDDED = global.__HEXLANDS_ASSETS || null;
const BUNDLED = Boolean(global.__HEXLANDS_BUNDLED);

function userDataDir() {
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Hexlands');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Hexlands');
  return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'hexlands');
}
const DATA_FILE =
  process.env.HEXLANDS_DATA || (BUNDLED ? path.join(userDataDir(), 'rooms.json') : path.join(__dirname, '..', 'data', 'rooms.json'));
const PERSIST = process.env.HEXLANDS_NO_PERSIST !== '1';

const COLORS = ['#e5483c', '#2f7de1', '#f0a30a', '#2fb35a', '#9b51e0', '#17b3ae'];
const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dax', 'Eve', 'Finn'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const MAPS = describeMaps();
const MAP_BY_ID = new Map(MAPS.map((m) => [m.id, m]));

const rooms = new Map();
const BOT_DELAY = Number(process.env.HEXLANDS_BOT_DELAY || 650);

// ---- helpers ---------------------------------------------------------------

const token = () => crypto.randomBytes(16).toString('hex');
const memberId = () => crypto.randomBytes(5).toString('hex');

function roomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let tries = 0; tries < 200; tries++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += letters[crypto.randomInt(letters.length)];
    if (!rooms.has(c)) return c;
  }
  throw new Error('no room codes left');
}

const cleanName = (s, fallback) => {
  const n = String(s || '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 20);
  return n || fallback;
};

function json(res, status, body, headers) {
  const data = JSON.stringify(body);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, headers));
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (!req.headers['content-type'] || !req.headers['content-type'].toLowerCase().startsWith('application/json')) {
      reject(Object.assign(new Error('Content-Type must be application/json'), { status: 415 }));
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) {
        reject(new Error('Request too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        reject(new Error('Bad JSON'));
      }
    });
    req.on('error', reject);
  });
}

const currentPort = () => (server.address() && server.address().port) || PORT;

function lanUrls() {
  const out = [];
  let nets = {};
  try {
    nets = os.networkInterfaces();
  } catch (e) {
    // Android shells (Termux) deny listing interfaces; the game still works, we just cannot print the LAN address
  }
  for (const list of Object.values(nets)) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) out.push(`http://${i.address}:${currentPort()}`);
    }
  }
  return out;
}

// ---- rooms -----------------------------------------------------------------

function newRoom() {
  const room = {
    code: roomCode(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'lobby', // lobby | playing | over
    settings: G.sanitizeSettings({}),
    members: [],
    spectators: [],
    state: null,
    initial: null,
    history: [],
    chat: [],
    gameNo: 0,
    clients: new Set(),
    timer: null,
  };
  rooms.set(room.code, room);
  return room;
}

function freeColor(room) {
  const used = new Set(room.members.map((m) => m.color));
  return COLORS.find((c) => !used.has(c)) || COLORS[0];
}

function addMember(room, name, bot) {
  const m = { id: memberId(), token: token(), name, color: freeColor(room), bot: !!bot, human: !bot, connected: false };
  room.members.push(m);
  return m;
}

const findByToken = (room, t) => room.members.find((m) => m.token === t) || null;
const findSpectator = (room, t) => room.spectators.find((s) => s.token === t) || null;
const hostOf = (room) => room.members.find((m) => !m.bot) || null;

function publicInfo(room) {
  const map = MAP_BY_ID.get(room.settings.map);
  return {
    code: room.code,
    status: room.status,
    hostId: hostOf(room) ? hostOf(room).id : null,
    settings: room.settings,
    mapMax: map ? map.maxPlayers : 6,
    members: room.members.map((m) => ({ id: m.id, name: m.name, color: m.color, bot: m.bot, human: !!m.human, connected: m.connected })),
    spectators: room.spectators.length,
    chat: room.chat.slice(-60),
    gameNo: room.gameNo,
  };
}

function playerIndex(room, memberIdValue) {
  if (!room.state) return -1;
  return room.state.players.findIndex((p) => p.id === memberIdValue);
}

function sendTo(client, room) {
  const info = publicInfo(room);
  let game = null;
  let index = -1;
  if (room.state) {
    index = client.memberId ? playerIndex(room, client.memberId) : -1;
    const withBoard = client.boardSent !== room.gameNo;
    game = G.viewFor(room.state, index, { withBoard });
    client.boardSent = room.gameNo;
  }
  const payload = { type: 'update', info, game, me: { id: client.memberId || null, index, spectator: !client.memberId }, gameNo: room.gameNo, t: Date.now() };
  try {
    client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch (e) {
    /* connection closed; cleanup happens on 'close' */
  }
}

function broadcast(room) {
  room.updatedAt = Date.now();
  for (const c of room.clients) sendTo(c, room);
  schedulePersist();
}

function refreshConnected(room) {
  const live = new Set();
  for (const c of room.clients) if (c.memberId) live.add(c.memberId);
  for (const m of room.members) m.connected = live.has(m.id);
}

// ---- bots ------------------------------------------------------------------

function botMemberIds(room) {
  return new Set(room.members.filter((m) => m.bot).map((m) => m.id));
}

function scheduleBots(room) {
  if (room.timer || room.status !== 'playing' || !room.state) return;
  const bots = botMemberIds(room);
  if (!bots.size) return;
  const actors = G.pendingActors(room.state).filter((pi) => bots.has(room.state.players[pi].id));
  if (!actors.length) return;
  const delay = room.state.phase === 'setup' ? Math.min(BOT_DELAY, 350) : BOT_DELAY;
  room.timer = setTimeout(() => {
    room.timer = null;
    runBot(room);
  }, delay);
}

function runBot(room) {
  if (room.status !== 'playing' || !room.state) return;
  const bots = botMemberIds(room);
  for (const pi of G.pendingActors(room.state)) {
    if (!bots.has(room.state.players[pi].id)) continue;
    const action = botAct(room.state, pi);
    if (!action) continue;
    const r = G.act(room.state, pi, action);
    if (r.ok) {
      room.history.push([pi, action]);
      afterAction(room);
      return;
    }
    // A rejected bot move should never happen; fall back to ending the turn so the game cannot hang.
    console.error(`bot rejected: ${JSON.stringify(action)} -> ${r.error}`);
    if (room.state.cur === pi && room.state.turn.step === 'main') {
      const e = G.act(room.state, pi, { type: 'endTurn' });
      if (e.ok) {
        room.history.push([pi, { type: 'endTurn' }]);
        afterAction(room);
      }
    }
    return;
  }
}

function afterAction(room) {
  if (room.state.phase === 'over') room.status = 'over';
  broadcast(room);
  scheduleBots(room);
}

// ---- lobby / game operations ----------------------------------------------

function startGame(room) {
  const members = room.members;
  if (members.length < 2) throw new Error('You need at least 2 players (add a bot if you are alone)');
  const map = MAP_BY_ID.get(room.settings.map);
  if (members.length > map.maxPlayers) throw new Error(`${map.name} supports at most ${map.maxPlayers} players`);
  const state = G.createGame({
    players: members.map((m) => ({ id: m.id, name: m.name, color: m.color, bot: m.bot })),
    settings: room.settings,
    seed: crypto.randomInt(1, 2 ** 31),
  });
  room.state = state;
  room.initial = JSON.stringify(state);
  room.history = [];
  room.status = 'playing';
  room.gameNo++;
  for (const c of room.clients) c.boardSent = null;
  room.chat.push({ sys: true, text: 'The game has started. Good luck!', t: Date.now() });
}

function lobbyOp(room, member, body) {
  const isHost = hostOf(room) && hostOf(room).id === member.id;
  const op = body.op;
  if (op === 'name') {
    member.name = cleanName(body.name, member.name);
    return;
  }
  if (op === 'color') {
    if (!COLORS.includes(body.color)) throw new Error('Unknown colour');
    const taken = room.members.find((m) => m.color === body.color && m.id !== member.id);
    if (taken) throw new Error('That colour is taken');
    if (room.status !== 'lobby') throw new Error('Colours are locked during a game');
    member.color = body.color;
    return;
  }
  if (op === 'leave') {
    if (room.status !== 'lobby') throw new Error('You cannot leave a running game (ask the host to set you to auto-play)');
    room.members = room.members.filter((m) => m.id !== member.id);
    return;
  }
  if (!isHost) throw new Error('Only the host can do that');
  if (op === 'settings') {
    if (room.status !== 'lobby') throw new Error('Settings are locked during a game');
    room.settings = G.sanitizeSettings(Object.assign({}, room.settings, body.settings || {}));
    return;
  }
  if (op === 'addBot') {
    if (room.status !== 'lobby') throw new Error('Bots can only be added in the lobby');
    if (room.members.length >= 6) throw new Error('The table is full');
    const used = new Set(room.members.map((m) => m.name));
    const name = 'Bot ' + (BOT_NAMES.find((n) => !used.has('Bot ' + n)) || room.members.length);
    addMember(room, name, true);
    return;
  }
  if (op === 'remove') {
    if (room.status !== 'lobby') throw new Error('Players can only be removed in the lobby');
    if (body.id === member.id) throw new Error('You are the host');
    room.members = room.members.filter((m) => m.id !== body.id);
    return;
  }
  if (op === 'autoplay') {
    const target = room.members.find((m) => m.id === body.id);
    if (!target || target.id === member.id) throw new Error('Pick another player');
    target.bot = !!body.on;
    if (room.state) {
      const p = room.state.players.find((x) => x.id === target.id);
      if (p) p.bot = target.bot;
    }
    return;
  }
  if (op === 'start') {
    if (room.status === 'playing') throw new Error('A game is already running');
    startGame(room);
    return;
  }
  if (op === 'reset') {
    if (room.status === 'lobby') return;
    room.status = 'lobby';
    room.state = null;
    room.initial = null;
    room.history = [];
    clearTimeout(room.timer);
    room.timer = null;
    return;
  }
  throw new Error('Unknown lobby action');
}

// ---- replay ------------------------------------------------------------------

function replayState(room, step) {
  const state = JSON.parse(room.initial);
  const n = Math.max(0, Math.min(step, room.history.length));
  for (let i = 0; i < n; i++) G.act(state, room.history[i][0], room.history[i][1]);
  return state;
}

// ---- persistence -----------------------------------------------------------

let persistTimer = null;
function schedulePersist() {
  if (!PERSIST || persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      const out = [];
      for (const r of rooms.values()) {
        out.push({
          code: r.code,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          status: r.status,
          settings: r.settings,
          members: r.members,
          spectators: r.spectators,
          state: r.state,
          initial: r.initial,
          history: r.history,
          chat: r.chat.slice(-100),
          gameNo: r.gameNo,
        });
      }
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(out));
      fs.renameSync(tmp, DATA_FILE);
    } catch (e) {
      console.error('persist failed:', e.message);
    }
  }, 800);
}

function loadRooms() {
  if (!PERSIST) return;
  try {
    const list = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const cutoff = Date.now() - 48 * 3600 * 1000;
    for (const r of list) {
      if (r.updatedAt < cutoff) continue;
      const room = Object.assign(newRoomShell(), r);
      room.members.forEach((m) => (m.connected = false));
      rooms.set(room.code, room);
      scheduleBots(room);
    }
    if (rooms.size) console.log(`restored ${rooms.size} room(s)`);
  } catch (e) {
    /* first run or unreadable file: start fresh */
  }
}

function newRoomShell() {
  return { clients: new Set(), timer: null, spectators: [], chat: [], history: [], members: [] };
}

// ---- HTTP ------------------------------------------------------------------

function getRoom(code) {
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room) throw Object.assign(new Error('Room not found'), { status: 404 });
  return room;
}

function authed(room, tok) {
  const member = findByToken(room, tok);
  if (member) return { member };
  const spec = findSpectator(room, tok);
  if (spec) return { spectator: spec };
  throw Object.assign(new Error('Not in this room'), { status: 403 });
}

async function handleApi(req, res, url) {
  const route = url.pathname;

  if (route === '/api/maps' && req.method === 'GET') return json(res, 200, { maps: MAPS });
  if (route === '/api/info' && req.method === 'GET') {
    return json(res, 200, { app: 'hexlands', version: VERSION, urls: lanUrls(), port: currentPort() }, { 'Access-Control-Allow-Origin': '*' });
  }

  if (route === '/api/stream' && req.method === 'GET') {
    const room = getRoom(url.searchParams.get('code'));
    const who = authed(room, url.searchParams.get('token'));
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 1500\n\n');
    const client = { res, memberId: who.member ? who.member.id : null, boardSent: null };
    room.clients.add(client);
    refreshConnected(room);
    sendTo(client, room);
    broadcast(room);
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch (e) {
        /* closed */
      }
    }, 15000);
    req.on('close', () => {
      clearInterval(ping);
      room.clients.delete(client);
      refreshConnected(room);
      broadcast(room);
    });
    return;
  }

  if (req.method !== 'POST' && route !== '/api/replay') return json(res, 405, { error: 'Method not allowed' });

  if (route === '/api/replay') {
    const room = getRoom(url.searchParams.get('code'));
    authed(room, url.searchParams.get('token'));
    if (!room.initial) return json(res, 400, { error: 'No game to replay' });
    const step = Number(url.searchParams.get('step') || 0);
    const state = replayState(room, step);
    const view = G.viewFor(state, -1, { withBoard: url.searchParams.get('board') === '1' });
    return json(res, 200, { step: Math.min(step, room.history.length), total: room.history.length, game: view });
  }

  const body = await readBody(req);

  if (route === '/api/create') {
    const room = newRoom();
    const m = addMember(room, cleanName(body.name, 'Host'), false);
    schedulePersist();
    return json(res, 200, { code: room.code, token: m.token, id: m.id });
  }

  if (route === '/api/join') {
    const room = getRoom(body.code);
    if (body.token) {
      const existing = findByToken(room, body.token) || findSpectator(room, body.token);
      if (existing) return json(res, 200, { code: room.code, token: existing.token, id: existing.id || null, spectator: !!findSpectator(room, body.token) });
    }
    if (room.status === 'lobby' && !body.spectate) {
      if (room.members.length >= 6) return json(res, 400, { error: 'The table is full' });
      const m = addMember(room, cleanName(body.name, 'Player'), false);
      broadcast(room);
      return json(res, 200, { code: room.code, token: m.token, id: m.id });
    }
    const spec = { token: token(), id: null };
    room.spectators.push(spec);
    broadcast(room);
    return json(res, 200, { code: room.code, token: spec.token, id: null, spectator: true });
  }

  const room = getRoom(body.code);
  const who = authed(room, body.token);

  if (route === '/api/lobby') {
    if (!who.member) throw Object.assign(new Error('Spectators cannot do that'), { status: 403 });
    lobbyOp(room, who.member, body);
    broadcast(room);
    scheduleBots(room);
    return json(res, 200, { ok: true });
  }

  if (route === '/api/act') {
    if (!who.member) throw Object.assign(new Error('Spectators cannot play'), { status: 403 });
    if (room.status !== 'playing' || !room.state) return json(res, 400, { error: 'No game is running' });
    const pi = playerIndex(room, who.member.id);
    if (pi < 0) return json(res, 400, { error: 'You are not seated in this game' });
    const r = G.act(room.state, pi, body.action);
    if (!r.ok) return json(res, 400, { error: r.error });
    room.history.push([pi, body.action]);
    afterAction(room);
    return json(res, 200, { ok: true });
  }

  if (route === '/api/chat') {
    const text = String(body.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300);
    if (!text) return json(res, 400, { error: 'Empty message' });
    const name = who.member ? who.member.name : 'Spectator';
    room.chat.push({ from: who.member ? who.member.id : null, name, color: who.member ? who.member.color : '#888', text, t: Date.now() });
    if (room.chat.length > 300) room.chat.splice(0, room.chat.length - 300);
    broadcast(room);
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'Unknown endpoint' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  if (EMBEDDED) {
    const key = rel.slice(1);
    if (!Object.prototype.hasOwnProperty.call(EMBEDDED, key)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(key)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    return res.end(EMBEDDED[key]);
  }
  const file = path.normalize(path.join(CLIENT_DIR, rel));
  if (!file.startsWith(CLIENT_DIR + path.sep) && file !== CLIENT_DIR) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    const status = e.status || 400;
    if (!res.headersSent) json(res, status, { error: e.message || 'Error' });
    else res.end();
  }
});

// Drop idle rooms once an hour.
setInterval(() => {
  const cutoff = Date.now() - 48 * 3600 * 1000;
  for (const [code, r] of rooms) if (r.updatedAt < cutoff && !r.clients.size) rooms.delete(code);
}, 3600 * 1000).unref();

let roomsLoaded = false;

// opts.rethrow: reject on listen errors instead of printing a message and exiting (used by the packaged app, which retries).
function start(port = PORT, host = HOST, opts = {}) {
  if (!roomsLoaded) {
    roomsLoaded = true;
    loadRooms();
  }
  return new Promise((resolve, reject) => {
    server.once('error', (e) => {
      if (opts.rethrow) return reject(e);
      if (e.code === 'EADDRINUSE') {
        console.error('');
        console.error(`  Port ${port} is already in use. Is Hexlands already running?`);
        console.error('  Close the other window, or start on another port:');
        console.error('    set PORT=3001 && node server/server.js');
        console.error('');
        process.exit(1);
      }
      throw e;
    });
    server.listen(port, host, () => {
      const addr = server.address();
      resolve(addr.port);
    });
  });
}

module.exports = { start, server, rooms, lanUrls, VERSION, PORT, HOST, DATA_FILE };

if (require.main === module) {
  start().then((port) => {
    console.log('');
    console.log('  HEXLANDS is running');
    console.log(`  On this computer:  http://localhost:${port}`);
    for (const u of lanUrls()) console.log(`  Same Wi-Fi/LAN:    ${u}`);
    console.log('');
    console.log('  Friends on other networks: see README.md ("Playing over the internet").');
    console.log('  Press Ctrl+C to stop.');
  });
}

