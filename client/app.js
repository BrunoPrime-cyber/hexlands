/* Hexlands client: screens, lobby, game HUD, trading, replay. Plain JS, no build step. */
(function () {
  'use strict';
  const HB = window.HexBoard;
  const RES = ['timber', 'clay', 'wool', 'grain', 'ore'];
  const COLORS = ['#e5483c', '#2f7de1', '#f0a30a', '#2fb35a', '#9b51e0', '#17b3ae'];
  const COST = {
    road: { timber: 1, clay: 1 },
    settlement: { timber: 1, clay: 1, wool: 1, grain: 1 },
    city: { grain: 2, ore: 3 },
    dev: { wool: 1, grain: 1, ore: 1 },
  };
  const DEV_NAMES = { knight: 'Knight', roadBuilding: 'Road Building', yearOfPlenty: 'Year of Plenty', monopoly: 'Monopoly', vp: 'Victory Point' };
  const RES_COLOR = HB.RES_FILL;
  const RES_LABEL = HB.RES_LABEL;

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
  const isDesktop = () => window.matchMedia('(min-width: 901px)').matches;

  const S = {
    session: null,
    es: null,
    info: null,
    game: null,
    me: null,
    board: null,
    boardApplied: null,
    maps: [],
    urls: [],
    mode: null,
    modal: null,
    tab: 'log',
    sideOpen: false,
    replay: null,
    seenChatT: 0,
    gameNoSeen: null,
    overDismissed: false,
    discardSel: {},
    discardKey: '',
    trade: { tab: 'players', give: {}, want: {}, to: [], bankGive: null, bankGet: null },
    yop: [],
    busy: false,
    bv: null,
    diceKey: '',
    focus: null, // player index whose pieces are spotlighted
    pending: null, // { kind, id } waiting for a second tap on touch screens
    lastSeq: null, // newest log event already reacted to
    lastOfferId: 0,
    wasMyTurn: false,
  };

  // ---- storage / api ---------------------------------------------------------

  const store = {
    get(k) {
      try { return localStorage.getItem(k); } catch (e) { return null; }
    },
    set(k, v) {
      try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ }
    },
  };

  // Personal preferences (stored on this device only).
  const COARSE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const prefs = {
    sound: store.get('hexlands.sound') !== 'off',
    haptics: store.get('hexlands.haptics') !== 'off',
    confirm: store.get('hexlands.confirm') === null ? COARSE : store.get('hexlands.confirm') === 'on',
    fx: store.get('hexlands.fx') !== 'off',
  };
  const setPref = (k, on) => {
    prefs[k] = on;
    store.set('hexlands.' + k, on ? 'on' : 'off');
    if (k === 'fx') document.documentElement.dataset.fx = on ? 'max' : 'calm';
  };
  const applyTheme = (t) => {
    document.documentElement.dataset.theme = t;
    store.set('hexlands.theme', t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === 'holo' ? '#060a11' : '#2a1c13';
  };
  const theme = () => document.documentElement.dataset.theme || 'holo';

  // Short vibration taps on phones, for placing pieces and for "your turn".
  const haptic = (pattern) => {
    if (prefs.haptics && navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (e) { /* unsupported */ }
    }
  };

  // Synthesised sound effects (no audio files). Browsers only allow audio after a tap or key press.
  const sfx = (() => {
    let ctx = null;
    const ensure = () => {
      if (ctx === null) {
        try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = false; }
      }
      if (ctx && ctx.state === 'suspended') ctx.resume();
      return ctx;
    };
    const tone = (freq, dur, o) => {
      const opt = o || {};
      const c = prefs.sound ? ensure() : null;
      if (!c) return;
      const t = c.currentTime + (opt.at || 0);
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = opt.type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (opt.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * opt.slide), t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(opt.vol || 0.07, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      if (opt.lp) {
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(opt.lp, t);
        osc.connect(lp).connect(gain).connect(c.destination);
      } else osc.connect(gain).connect(c.destination);
      osc.start(t);
      osc.stop(t + dur + 0.03);
    };
    let lastTick = 0;
    const burst = (dur, o) => {
      const opt = o || {};
      const c = prefs.sound ? ensure() : null;
      if (!c) return;
      const t = c.currentTime + (opt.at || 0);
      const len = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource();
      src.buffer = buf;
      const filter = c.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = opt.hp || 1500;
      const gain = c.createGain();
      gain.gain.value = opt.vol || 0.05;
      src.connect(filter).connect(gain).connect(c.destination);
      src.start(t);
    };
    return {
      unlock: () => ensure(),
      click: () => tone(880, 0.035, { type: 'square', vol: 0.03, lp: 3000 }),
      dice: () => { for (let i = 0; i < 6; i++) burst(0.045, { at: i * 0.055, hp: 900 + i * 220, vol: 0.05 }); tone(180, 0.1, { at: 0.34, type: 'triangle', vol: 0.06 }); },
      build: () => { tone(150, 0.14, { type: 'square', slide: 0.5, vol: 0.05 }); burst(0.06, { hp: 500, vol: 0.05 }); },
      zap: () => { tone(900, 0.17, { type: 'sawtooth', slide: 0.25, vol: 0.05, lp: 2600 }); tone(110, 0.22, { type: 'square', vol: 0.05, at: 0.03, slide: 0.5 }); burst(0.09, { hp: 3200, vol: 0.04 }); },
      sweep: () => tone(260, 0.55, { type: 'sawtooth', slide: 5, vol: 0.028, lp: 1900 }),
      tick: () => { const n = performance.now(); if (n - lastTick < 70) return; lastTick = n; tone(1500, 0.025, { type: 'square', vol: 0.014 }); },
      hit: () => { tone(64, 0.5, { type: 'sine', slide: 0.45, vol: 0.17 }); tone(180, 0.16, { type: 'sawtooth', slide: 0.3, vol: 0.05, lp: 1400 }); burst(0.2, { hp: 160, vol: 0.07 }); },
      glitch: () => { for (let i = 0; i < 6; i++) tone(260 + Math.random() * 1700, 0.032, { type: 'square', at: i * 0.036, vol: 0.03, lp: 3600 }); burst(0.12, { hp: 2400, vol: 0.04 }); },
      boot: () => { for (let i = 0; i < 9; i++) tone(280 + i * 85, 0.06, { type: 'square', at: i * 0.07, vol: 0.026, lp: 2600 }); tone(120, 0.7, { type: 'sawtooth', slide: 6, vol: 0.03, lp: 1500 }); },
      gain: () => { tone(660, 0.1, { vol: 0.05 }); tone(990, 0.16, { at: 0.08, vol: 0.05 }); },
      turn: () => { tone(494, 0.12, { type: 'square', vol: 0.04, lp: 2200 }); tone(740, 0.12, { type: 'square', at: 0.1, vol: 0.04, lp: 2200 }); tone(988, 0.26, { type: 'square', at: 0.2, vol: 0.045, lp: 2600 }); },
      ping: () => tone(880, 0.12, { vol: 0.05 }),
      error: () => tone(120, 0.2, { type: 'sawtooth', slide: 0.7, vol: 0.05 }),
      robber: () => { tone(80, 0.4, { type: 'sawtooth', slide: 0.6, vol: 0.07 }); burst(0.2, { hp: 200, vol: 0.05 }); },
      win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.45, { at: i * 0.13, vol: 0.06, type: 'triangle' })),
    };
  })();
  const loadSession = () => {
    try { return JSON.parse(store.get('hexlands.session')); } catch (e) { return null; }
  };
  const saveSession = (s) => store.set('hexlands.session', s ? JSON.stringify(s) : null);

  async function api(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let j = {};
    try { j = await r.json(); } catch (e) { /* empty */ }
    if (!r.ok) {
      const err = new Error(j.error || `Request failed (${r.status})`);
      err.status = r.status;
      throw err;
    }
    return j;
  }
  const post = (path, extra) => api(path, Object.assign({ code: S.session.code, token: S.session.token }, extra));

  function toast(msg, kind) {
    const t = document.createElement('div');
    t.className = 'toast' + (kind === 'bad' ? ' bad' : '');
    t.textContent = msg;
    $('#toast').appendChild(t);
    setTimeout(() => t.remove(), 3400);
  }

  // ---- connection ------------------------------------------------------------

  function closeStream() {
    if (S.es) {
      S.es.close();
      S.es = null;
    }
  }

  function connect() {
    closeStream();
    const { code, token } = S.session;
    const es = new EventSource(`/api/stream?code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`);
    S.es = es;
    es.onmessage = (ev) => {
      try { onUpdate(JSON.parse(ev.data)); } catch (e) { console.error(e); }
    };
    es.onerror = async () => {
      // While the browser is retrying by itself (CONNECTING) there is nothing to do.
      if (es.readyState !== EventSource.CLOSED || S.unloading || S.es !== es) return;
      // The browser gave up. Only forget the seat if the server says it is really gone.
      try {
        await api('/api/join', { code, token });
        setTimeout(() => { if (S.session && S.es === es && !S.unloading) connect(); }, 1500);
      } catch (e) {
        if (e.status === 404 || e.status === 403) leaveToHome('That game is no longer available.');
        else setTimeout(() => { if (S.session && S.es === es && !S.unloading) connect(); }, 3000);
      }
    };
  }

  function leaveToHome(msg, forget) {
    closeStream();
    if (forget !== false) saveSession(null);
    S.session = S.info = S.game = S.me = S.board = S.boardApplied = S.bv = S.replay = null;
    S.modal = null;
    S.gameNoSeen = null;
    render();
    if (msg) $('#homeErr').textContent = msg;
  }

  function onUpdate(m) {
    S.info = m.info;
    S.me = m.me;
    if (m.game) {
      if (m.game.board) {
        S.board = m.game.board;
        delete m.game.board;
      }
      S.game = m.game;
    } else {
      S.game = null;
      S.board = null;
      S.boardApplied = null;
    }
    if (S.gameNoSeen !== m.gameNo) {
      S.gameNoSeen = m.gameNo;
      S.overDismissed = false;
      S.mode = null;
      S.modal = null;
      S.discardSel = {};
      S.prevHand = null;
      S.replay = null;
      S.focus = null;
      S.pending = null;
      S.lastSeq = null;
      S.wasMyTurn = false;
      S.seenChatT = S.info.chat.length ? S.info.chat[S.info.chat.length - 1].t : 0;
    }
    render();
    reactToEvents();
  }

  // ---- shared helpers --------------------------------------------------------

  const V = () => (S.replay ? S.replay.game : S.game);
  const pill = (r, n) => `<span class="pill">${HB.iconSvg(r, 15)}${n === undefined ? '' : n}</span>`;
  const bundle = (o) => {
    const parts = RES.filter((r) => o && o[r]).map((r) => pill(r, o[r]));
    return parts.length ? parts.join('') : 'nothing';
  };
  // Player names stay readable: lightened on the dark chronicle, darkened on parchment.
  const pn = (i, onPaper) => {
    const p = V() && V().players[i];
    if (!p) return '?';
    // parchment (Tabletop) wants darker names; the Holotable glass is dark, so it keeps the light ones
    const c = onPaper && theme() !== 'holo' ? HB.shade(p.color, -0.42) : HB.shade(p.color, 0.42);
    return `<span class="pn" style="color:${esc(c)}">${esc(p.name)}</span>`;
  };

  // Pick whichever of white / dark ink reads better on a player colour (WCAG contrast).
  const relLum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
  };
  const sealInk = (hex) => {
    const l = relLum(hex);
    const white = 1.05 / (l + 0.05);
    const ink = (l + 0.05) / (relLum('#2a1f17') + 0.05);
    return ink > white ? 'color:#2a1f17;text-shadow:0 1px 0 rgba(255,255,255,.35)' : 'color:#fff';
  };

  // Stroke icons share one weight and inherit the text colour.
  const ic = (d) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const I = {
    cards: ic('<rect x="3.5" y="8" width="11" height="13" rx="2"/><path d="M8 8V6.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2V16a2 2 0 0 1-2 2h-4.5"/>'),
    scroll: ic('<path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6L12 16.6 6.6 19.6l1.2-6L3.3 9.4l6.1-.8z"/>'),
    sword: ic('<path d="M5 19L19 5M15.5 4.5H19.5V8.5"/><path d="M9.5 14.5l-3-3M7 17l-3 3"/>'),
    road: ic('<path d="M7 21L10 3M17 21L14 3M12 7v2.5M12 12.5V15M12 18v2"/>'),
    menu: ic('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    chat: ic('<path d="M4 5h16v11H9.5L4 20z"/>'),
    trade: ic('<path d="M4 8h14l-3-3M20 16H6l3 3"/>'),
    house: ic('<path d="M4 20v-9l8-6 8 6v9z"/><path d="M10 20v-5h4v5"/>'),
    city: ic('<path d="M3 20V10h6v10M9 20V5l6-2v17M15 20v-8h6v8"/>'),
    card: ic('<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M9 8h6M9 12h6"/>'),
    dice: ic('<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="15" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="9" cy="15" r="1"/>'),
    sound: ic('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>'),
    mute: ic('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  };

  // Ivory dice with real pips.
  const PIPS = {
    1: [[20, 20]],
    2: [[12, 12], [28, 28]],
    3: [[11, 11], [20, 20], [29, 29]],
    4: [[12, 12], [28, 12], [12, 28], [28, 28]],
    5: [[11, 11], [29, 11], [20, 20], [11, 29], [29, 29]],
    6: [[12, 10], [28, 10], [12, 20], [28, 20], [12, 30], [28, 30]],
  };
  const dieSvg = (n, roll) =>
    `<svg class="die ${roll ? 'roll' : ''}" viewBox="0 0 40 40" aria-label="${n}"><rect class="d-body" x="2" y="2" width="36" height="36" rx="9" fill="#fbf4df" stroke="#8a6a3b" stroke-width="2"/><rect class="d-inner" x="5" y="5" width="30" height="30" rx="6" fill="none" stroke="#d9c392" stroke-width="1"/>${PIPS[n]
      .map(([x, y]) => `<circle class="d-pip${n === 1 ? ' one' : ''}" cx="${x}" cy="${y}" r="3.7" fill="${n === 1 ? '#b3261a' : '#2a1f17'}"/>`)
      .join('')}</svg>`;
  const costChips = (cost) =>
    `<span class="cost">${RES.filter((r) => cost[r]).map((r) => Array.from({ length: cost[r] }, () => `<i class="c" style="background:${RES_COLOR[r]}"></i>`).join('')).join('')}</span>`;
  const chatHtml = (list) =>
    list
      .map((m) => (m.sys ? `<div class="sys">${esc(m.text)}</div>` : `<div><i class="cdot" style="background:${esc(m.color)}"></i><b>${esc(m.name)}</b>: ${esc(m.text)}</div>`))
      .join('');
  const missing = (hand, cost) => RES.filter((r) => (hand[r] || 0) < (cost[r] || 0)).map((r) => `${(cost[r] || 0) - (hand[r] || 0)} ${RES_LABEL[r]}`);

  function updateChat() {
    if (!S.info) return;
    const html = chatHtml(S.info.chat);
    for (const id of ['chatListLobby', 'chatListGame']) {
      const el = $('#' + id);
      if (!el) continue;
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      if (el.dataset.html !== html) {
        el.innerHTML = html;
        el.dataset.html = html;
        if (near) el.scrollTop = el.scrollHeight;
      }
    }
    const last = S.info.chat.length ? S.info.chat[S.info.chat.length - 1] : null;
    const lobby = S.info.status === 'lobby';
    const visible = lobby || (S.tab === 'chat' && (isDesktop() || S.sideOpen));
    if (visible && last) S.seenChatT = last.t;
    const dot = $('#chatDot');
    if (dot) dot.hidden = !(last && !last.sys && last.t > S.seenChatT);
  }

  // ---- home --------------------------------------------------------------------

  function showScreen(name) {
    $('#home').hidden = name !== 'home';
    $('#lobby').hidden = name !== 'lobby';
    $('#game').hidden = name !== 'game';
    if (S.screenName !== name) {
      const el = $('#' + name);
      S.screenName = name;
      // glitch in on every change except the very first paint
      if (el && S.screenSeen) {
        el.classList.remove('screen-in');
        void el.offsetWidth;
        el.classList.add('screen-in');
        setTimeout(() => el.classList.remove('screen-in'), 450);
      }
      S.screenSeen = true;
    }
  }

  function initHome() {
    HB.heroIsland($('#heroIsland'));
    $('#nameInput').value = store.get('hexlands.name') || '';
    const hash = (location.hash || '').replace('#', '').toUpperCase().slice(0, 4);
    if (hash) $('#codeInput').value = hash;
    $('#createBtn').addEventListener('click', async () => {
      const name = $('#nameInput').value.trim();
      store.set('hexlands.name', name);
      $('#homeErr').textContent = '';
      try {
        const r = await api('/api/create', { name });
        startSession({ code: r.code, token: r.token, id: r.id });
      } catch (e) { $('#homeErr').textContent = e.message; }
    });
    const join = async () => {
      const name = $('#nameInput').value.trim();
      const code = $('#codeInput').value.trim().toUpperCase();
      store.set('hexlands.name', name);
      $('#homeErr').textContent = '';
      if (code.length !== 4) { $('#homeErr').textContent = 'Enter the 4-letter room code.'; return; }
      try {
        const r = await api('/api/join', { code, name, spectate: $('#watchChk').checked });
        startSession({ code: r.code, token: r.token, id: r.id });
      } catch (e) { $('#homeErr').textContent = e.message; }
    };
    $('#joinBtn').addEventListener('click', join);
    $('#codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    $('#nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') (hash || $('#codeInput').value ? join() : $('#createBtn').click()); });
  }

  function startSession(s) {
    S.session = s;
    saveSession(s);
    history.replaceState(null, '', '#' + s.code);
    connect();
  }

  async function tryResume() {
    const saved = loadSession();
    if (!saved) return false;
    try {
      await api('/api/join', { code: saved.code, token: saved.token });
      S.session = saved;
      connect();
      return true;
    } catch (e) {
      saveSession(null);
      return false;
    }
  }

  // ---- lobby -------------------------------------------------------------------

  function mapPreview(tiles) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of tiles) {
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    // a small painted version of the map: terrain picked from the tile position, so each map looks lived-in
    const kinds = ['forest', 'hills', 'pasture', 'fields', 'mountains', 'pasture', 'forest', 'fields'];
    const polys = tiles
      .map(([x, y]) => {
        const k = kinds[Math.abs(Math.round(x * 7 + y * 13)) % kinds.length];
        return `<polygon points="${HB.hexPoints(x, y, 0.93)}" fill="${HB.TERRAIN_FILL[k]}" stroke="${HB.shade(HB.TERRAIN_FILL[k], -0.4)}" stroke-width=".1"/>`;
      })
      .join('');
    return `<div class="pv"><svg viewBox="${minX - 1.1} ${minY - 1.1} ${maxX - minX + 2.2} ${maxY - minY + 2.2}" preserveAspectRatio="xMidYMid meet">${polys}</svg></div>`;
  }

  function inviteLinks() {
    const code = S.info.code;
    const links = [];
    const here = location.origin;
    if (!/^https?:\/\/(localhost|127\.)/.test(here)) links.push(here);
    for (const u of S.urls) if (!links.includes(u)) links.push(u);
    if (!links.length) links.push(here);
    return links.map((l) => `${l}/#${code}`);
  }

  function renderLobby() {
    const info = S.info;
    const meId = S.me && S.me.id;
    const isHost = info.hostId === meId;
    const spectator = S.me && S.me.spectator;
    const st = info.settings;
    const map = S.maps.find((m) => m.id === st.map) || S.maps[0];
    const links = inviteLinks();
    const seatMax = Math.min(6, map ? map.maxPlayers : 6);
    const members = info.members
      .map((m) => {
        const mine = m.id === meId;
        return `<div class="mem">
          <span class="dot ${mine ? 'me' : ''}" style="background:${esc(m.color)}" ${mine ? 'data-act="color" title="Change colour"' : ''}></span>
          <span class="nm">${esc(m.name)}${mine ? ' (you)' : ''}
            ${m.id === info.hostId ? '<span class="tag-s host">host</span>' : ''}
            ${m.bot ? '<span class="tag-s">bot</span>' : ''}
            ${!m.bot && !m.connected ? '<span class="tag-s off">offline</span>' : ''}</span>
          ${mine ? '<button class="btn sm" data-act="rename">Rename</button>' : ''}
          ${isHost && !mine ? `<button class="btn sm danger" data-act="remove" data-id="${esc(m.id)}">Remove</button>` : ''}
          ${mine && !isHost ? '<button class="btn sm" data-act="leaveLobby">Leave</button>' : ''}
        </div>`;
      })
      .join('');
    const ro = !isHost; // read-only
    const seg = (key, opts, cur) =>
      `<div class="seg">${opts.map(([v, l]) => `<button data-act="set" data-k="${key}" data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}" ${ro ? 'disabled' : ''}>${l}</button>`).join('')}</div>`;
    const tog = (key, cur) => seg(key, [[true, 'On'], [false, 'Off']], cur);
    const maps = S.maps
      .map(
        (m) => `<button class="mapcard ${m.id === st.map ? 'sel' : ''}" data-act="map" data-id="${m.id}" ${ro ? 'disabled' : ''}>
          ${mapPreview(m.tiles)}<b>${esc(m.name)}</b><small>${m.tileCount} tiles · 2–${m.maxPlayers} players${m.random ? ' · random' : ''}</small></button>`
      )
      .join('');
    const tooMany = map && info.members.length > map.maxPlayers;
    const canStart = isHost && info.members.length >= 2 && !tooMany;
    let startHint = '';
    if (isHost && info.members.length < 2) startHint = 'Add a bot or wait for a friend to join.';
    else if (tooMany) startHint = `${map.name} fits at most ${map.maxPlayers} players. Pick a bigger map or remove players.`;
    $('#lobbyMain').innerHTML = `
      <div class="lobby-head">
        <div class="roomcode" title="Room code">${esc(info.code)}</div>
        <div class="invite">Share this link with friends:<br>${links.map((l) => `<code data-act="copy" data-text="${esc(l)}" title="Click to copy">${esc(l)}</code>`).join(' ')}
          ${S.urls.length === 0 ? '' : '<br><span>Friends on the same Wi-Fi can use the address that starts with 192.168… / 10…</span>'}</div>
      </div>
      <section class="card"><h3>Players (${info.members.length}/${seatMax})</h3>${members}
        ${isHost ? `<div style="margin-top:10px"><button class="btn" data-act="addBot" ${info.members.length >= seatMax ? 'disabled' : ''}>+ Add bot</button></div>` : ''}
      </section>
      <section class="card"><h3>Game rules ${ro ? '(set by host)' : ''}</h3>
        <div class="settings-grid">
          <div class="setting"><span class="lbl">Victory points to win</span>
            <div class="stepper"><button class="btn sm" data-act="vp" data-d="-1" ${ro ? 'disabled' : ''}>−</button><b>${st.vp}</b><button class="btn sm" data-act="vp" data-d="1" ${ro ? 'disabled' : ''}>+</button></div></div>
          <div class="setting"><span class="lbl">Dice</span>${seg('dice', [['random', 'Random'], ['balanced', 'Balanced deck']], st.dice)}</div>
          <div class="setting"><span class="lbl">Discard when over</span>${seg('discardLimit', [[7, '7'], [9, '9'], [12, '12']], st.discardLimit)}</div>
          <div class="setting"><span class="lbl">Friendly robber</span>${tog('friendlyRobber', st.friendlyRobber)}</div>
          <div class="setting"><span class="lbl">Quick start (+6 cards)</span>${tog('quickStart', st.quickStart)}</div>
          <div class="setting"><span class="lbl">Balanced board</span>${tog('balanced', st.balanced)}</div>
        </div>
      </section>
      <section class="card"><h3>Map</h3><div class="maps">${maps}</div>
        ${map ? `<p class="blurb"><b>${esc(map.name)}</b>: ${esc(map.blurb)}</p>` : ''}
      </section>
      ${isHost ? `<button class="btn primary big" data-act="start" ${canStart ? '' : 'disabled'} style="width:100%">Start game</button>` : spectator ? '' : '<p class="blurb">Waiting for the host to start…</p>'}
      ${startHint ? `<p class="warn">${esc(startHint)}</p>` : ''}
      <p style="height:12px"></p>`;
    updateChat();
  }

  // ---- game: text helpers --------------------------------------------------------

  function turnMessage(v) {
    const me = v.youIndex;
    const cur = v.players[v.cur];
    const mine = v.cur === me;
    if (v.phase === 'over') return { text: `${v.players[v.winner].name} wins!`, mine: false };
    if (v.phase === 'setup') {
      if (mine) return { text: v.setup.sub === 'settlement' ? 'Place a starting settlement' : 'Now place a road next to it', mine };
      return { text: `${cur.name} is placing a starting ${v.setup.sub}`, mine };
    }
    const t = v.turn;
    switch (t.step) {
      case 'roll': return mine ? { text: 'Your turn: roll the dice', mine } : { text: `${cur.name} is about to roll`, mine };
      case 'discard': {
        const need = t.discards.find((d) => d.p === me);
        if (need) return { text: `Discard ${need.need} cards`, mine: true };
        return { text: `Waiting for ${t.discards.map((d) => v.players[d.p].name).join(', ')} to discard`, mine: false };
      }
      case 'robber': return mine ? { text: 'Move the robber: tap a hex', mine } : { text: `${cur.name} is moving the robber`, mine };
      case 'steal': return mine ? { text: 'Choose a player to steal from', mine } : { text: `${cur.name} is choosing a victim`, mine };
      case 'roadbuilding': return mine ? { text: `Place ${t.roadsLeft} free road${t.roadsLeft === 1 ? '' : 's'}`, mine } : { text: `${cur.name} is building roads`, mine };
      default: return mine ? { text: 'Your turn: build, trade or end turn', mine } : { text: `${cur.name}'s turn`, mine };
    }
  }

  function fmtEvent(ev) {
    const a = (x) => pn(x);
    switch (ev.t) {
      case 'start': return [`Game started on <b>${esc(ev.map)}</b>.`];
      case 'turn': return [`Turn ${ev.n} · ${a(ev.p)}`, 'turn'];
      case 'roll': return [`${a(ev.p)} rolled <b>${ev.d[0]} + ${ev.d[1]} = ${ev.d[0] + ev.d[1]}</b>`];
      case 'produce': {
        if (!ev.gains.length) return ['No one received resources.' + (ev.short.length ? ` (The bank ran short on ${ev.short.map((r) => RES_LABEL[r]).join(', ')}.)` : '')];
        const lines = ev.gains.map((g) => `${a(g.p)} gets ${bundle(g.res)}`);
        if (ev.short.length) lines.push(`<i>The bank ran short on ${ev.short.map((r) => RES_LABEL[r]).join(', ')}.</i>`);
        return [lines.join('<br>')];
      }
      case 'build': {
        const what = ev.what === 'city' ? 'upgraded a settlement to a <b>city</b>' : `built a <b>${ev.what}</b>`;
        return [`${a(ev.p)} ${what}${ev.free ? ' (free)' : ''}`];
      }
      case 'robber': return [`${a(ev.p)} moved the robber`];
      case 'steal': return [`${a(ev.p)} stole a card from ${a(ev.from)}`];
      case 'discard': return [`${a(ev.p)} discarded ${ev.n} cards`];
      case 'devbuy': return [`${a(ev.p)} bought a development card`];
      case 'dev': {
        let extra = '';
        if (ev.card === 'yearOfPlenty') extra = ` and took ${bundle({ [ev.res[0]]: 1 })}${bundle({ [ev.res[1]]: 1 })}`;
        if (ev.card === 'monopoly') extra = ` on ${pill(ev.res)} and took ${ev.n}`;
        return [`${a(ev.p)} played <b>${DEV_NAMES[ev.card]}</b>${extra}`];
      }
      case 'bank': return [`${a(ev.p)} traded ${ev.ratio}×${pill(ev.give)} to the bank for ${pill(ev.get, 1)}`];
      case 'offer': return [`${a(ev.p)} offers ${bundle(ev.give)} for ${bundle(ev.want)}`];
      case 'trade': return [`${a(ev.p)} traded with ${a(ev.with)}: gave ${bundle(ev.give)} got ${bundle(ev.want)}`];
      case 'longest': return [ev.p === null ? 'Nobody holds <b>Longest Road</b> now' : `${a(ev.p)} now has <b>Longest Road</b>`];
      case 'army': return [`${a(ev.p)} now has <b>Largest Army</b>`];
      case 'win': return [`<b>${a(ev.p)} wins the game!</b>`];
      default: return [''];
    }
  }

  // ---- game: rendering -------------------------------------------------------------

  // Tile tooltip: terrain, number, real odds, and who produces from it.
  let tipTimer = null;
  function showHexTip(hexId, clientX, clientY, sticky) {
    const v = V();
    if (!v || !S.board) return;
    const h = S.board.hexes[hexId];
    const tip = $('#hexTip');
    const wrap = $('#boardWrap').getBoundingClientRect();
    const res = HB.TERRAIN_RES[h.terrain];
    const ways = h.number ? 6 - Math.abs(7 - h.number) : 0;
    const makers = [];
    for (const vid of h.vertices) {
      const b = v.buildings[vid];
      if (b) makers.push(b);
    }
    const byPlayer = new Map();
    for (const b of makers) byPlayer.set(b.p, (byPlayer.get(b.p) || 0) + (b.t === 'city' ? 2 : 1));
    const who = [...byPlayer.entries()]
      .map(([p, n]) => `<div class="who"><i style="background:${esc(v.players[p].color)}"></i>${esc(v.players[p].name)} gets ${n} per roll</div>`)
      .join('');
    tip.innerHTML = `<b>${HB.TERRAIN_NAME[h.terrain]}</b>${
      h.number
        ? `Roll <span class="odds">${h.number}</span> &middot; <span class="odds">${((ways / 36) * 100).toFixed(1)}%</span> of rolls<br>Gives ${HB.RES_LABEL[res]}`
        : 'The desert makes nothing.'
    }${v.robber === hexId ? '<br><i>The robber sits here.</i>' : ''}${who}`;
    const x = Math.min(wrap.width - 120, Math.max(120, clientX - wrap.left));
    const y = Math.max(90, clientY - wrap.top - 14);
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    tip.classList.add('show');
    clearTimeout(tipTimer);
    if (sticky) tipTimer = setTimeout(hideHexTip, 2600);
  }
  function hideHexTip() {
    clearTimeout(tipTimer);
    const tip = $('#hexTip');
    if (tip) tip.classList.remove('show');
  }

  function ensureBoardView() {
    if (!S.bv) {
      S.bv = new HB.BoardView($('#boardSvg'), onPick, {
        hexHover: (id, x, y) => { if (!COARSE) showHexTip(id, x, y, false); },
        hexLeave: () => hideHexTip(),
        hexTap: (id, x, y) => { if (COARSE) showHexTip(id, x, y, true); },
        spotHover: () => sfx.tick(),
      });
      S.boardApplied = null;
    }
    if (S.board && S.boardApplied !== S.board) {
      S.bv.setBoard(S.board);
      S.boardApplied = S.board;
      if (S.game && S.game.phase === 'setup' && S.game.setup && S.game.setup.i === 0) sfx.boot();
    }
  }

  function computeShow(v) {
    if (S.replay || v.phase === 'over' || v.youIndex < 0) return null;
    const h = v.hints || {};
    const show = { vertices: [], edges: [], hexes: [], vertexKind: 'settlement' };
    if (v.phase === 'setup') {
      if (h.vertices) show.vertices = h.vertices;
      if (h.edges) show.edges = h.edges;
      return show;
    }
    if (v.cur !== v.youIndex) return show;
    const step = v.turn.step;
    if (step === 'robber' && h.hexes) show.hexes = h.hexes;
    else if (step === 'roadbuilding' && h.edges) show.edges = h.edges;
    else if (step === 'main') {
      if (S.mode === 'road') show.edges = h.roads || [];
      if (S.mode === 'settlement') show.vertices = h.settlements || [];
      if (S.mode === 'city') {
        show.vertices = h.cities || [];
        show.vertexKind = 'city';
      }
    }
    return show;
  }

  // What a tap on the board means right now (or null).
  function actionFor(kind, id) {
    const v = S.game;
    if (!v || S.replay) return null;
    if (v.phase === 'setup') {
      if (kind === 'vertex') return { type: 'buildSettlement', vertex: id };
      if (kind === 'edge') return { type: 'buildRoad', edge: id };
      return null;
    }
    const step = v.turn.step;
    if (step === 'robber' && kind === 'hex') return { type: 'moveRobber', hex: id };
    if (step === 'roadbuilding' && kind === 'edge') return { type: 'buildRoad', edge: id };
    if (S.mode === 'road' && kind === 'edge') return { type: 'buildRoad', edge: id };
    if (S.mode === 'settlement' && kind === 'vertex') return { type: 'buildSettlement', vertex: id };
    if (S.mode === 'city' && kind === 'vertex') return { type: 'buildCity', vertex: id };
    return null;
  }

  const PICK_LABEL = { buildSettlement: 'Place settlement here?', buildCity: 'Upgrade to a city?', buildRoad: 'Build road here?', moveRobber: 'Move the robber here?' };

  function clearPending() {
    S.pending = null;
    if (S.bv) S.bv.clearGhost(false);
    renderConfirm();
  }

  function renderConfirm() {
    const bar = $('#confirmBar');
    if (!bar) return;
    const act = S.pending ? actionFor(S.pending.kind, S.pending.id) : null;
    if (!act || S.replay) {
      bar.hidden = true;
      bar.innerHTML = '';
      return;
    }
    const html = `<span>${PICK_LABEL[act.type]}</span><button class="btn primary sm" data-act="confirmPick">Confirm</button><button class="btn sm" data-act="cancelPick">Cancel</button>`;
    if (bar.innerHTML !== html) bar.innerHTML = html;
    bar.hidden = false;
  }

  function onPick(kind, id) {
    const act = actionFor(kind, id);
    if (!act) return;
    const same = S.pending && S.pending.kind === kind && S.pending.id === id;
    if (prefs.confirm && !same) {
      // first tap previews, second tap (or Confirm) commits
      S.pending = { kind, id };
      const vk = S.mode === 'city' ? 'city' : 'settlement';
      if (S.bv) S.bv.showGhost(kind, id, vk, true);
      renderConfirm();
      sfx.click();
      haptic(8);
      return;
    }
    if (S.pending) clearPending();
    doAct(act);
  }

  async function doAct(action) {
    if (S.busy) return;
    S.busy = true;
    try {
      await post('/api/act', { action });
      if (['buildRoad', 'buildSettlement', 'buildCity'].includes(action.type) && S.mode) {
        S.mode = null;
        if (S.game && !S.replay) renderGame();
      }
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      S.busy = false;
    }
  }

  // The top bar keeps its DOM so the ribbon and dice animate once, not on every update.
  function renderTop(v) {
    const top = $('#topbar');
    if (!top.dataset.ready) {
      top.dataset.ready = '1';
      top.innerHTML = `<button class="btn icon" data-act="menu" aria-label="Menu">${I.menu}</button>
        <span class="brand">Hexlands</span>
        <div class="turn-msg" id="ribbon" aria-live="polite"></div>
        <div class="dice" id="diceBox" title="Last roll"></div>
        <span class="chip" id="vpChip"></span>
        <button class="btn icon" data-act="toggleSound" id="sfxBtn" aria-label="Sound effects" title="Sound on or off"></button>
        <button class="btn" data-act="openSide" aria-label="Chronicle and chat">${I.chat}<span>Chronicle</span></button>`;
    }
    const sfxBtn = $('#sfxBtn');
    const sfxIcon = prefs.sound ? I.sound : I.mute;
    if (sfxBtn.dataset.icon !== sfxIcon) {
      sfxBtn.dataset.icon = sfxIcon;
      sfxBtn.innerHTML = sfxIcon;
    }
    const msg = turnMessage(v);
    const text = S.replay ? `Replay · step ${S.replay.step}/${S.replay.total}` : msg.text;
    const rib = $('#ribbon');
    rib.classList.toggle('mine', !!(msg.mine && !S.replay));
    if (rib.textContent !== text) {
      const had = rib.textContent !== '';
      rib.textContent = text;
      // a short chromatic glitch when the instruction changes (Neon: Max only)
      if (had && prefs.fx && !REDUCED) {
        rib.classList.remove('glitch');
        void rib.offsetWidth;
        rib.classList.add('glitch');
        clearTimeout(rib._gt);
        rib._gt = setTimeout(() => rib.classList.remove('glitch'), 450);
      }
    }
    const dice = v.turn.dice;
    const key = dice ? dice.join('-') + ':' + v.turn.n : '';
    const box = $('#diceBox');
    if (box.dataset.key !== key) {
      const first = box.dataset.key === undefined;
      box.dataset.key = key;
      clearInterval(box._iv);
      const final = dice ? dice.map((d) => dieSvg(d, !first)).join('') + `<span class="sum">${dice[0] + dice[1]}</span>` : '';
      if (dice && !first && !REDUCED && prefs.fx) {
        // digital scramble: the faces flicker before settling on the real roll
        let n = 0;
        box._iv = setInterval(() => {
          n++;
          if (n >= 6) {
            clearInterval(box._iv);
            box.innerHTML = final;
            return;
          }
          const rnd = () => 1 + Math.floor(Math.random() * 6);
          box.innerHTML = dieSvg(rnd(), n === 1) + dieSvg(rnd(), n === 1) + `<span class="sum">${String(2 + Math.floor(Math.random() * 11)).padStart(2, '0')}</span>`;
        }, 65);
      } else box.innerHTML = final;
    }
    // the "First to" part is dropped on narrow phones (see style.css) so the top bar stays on one row
    const chipEl = $('#vpChip');
    if (chipEl.dataset.vp !== String(v.settings.vp)) {
      chipEl.dataset.vp = String(v.settings.vp);
      chipEl.innerHTML = `<span class="lg">First to </span>${Number(v.settings.vp)} VP`;
    }
  }

  function renderPlayers(v) {
    const meta = S.info ? S.info.members : [];
    const pending = v.turn.step === 'discard' ? v.turn.discards.map((d) => d.p) : [v.cur];
    const stealable = v.turn.step === 'steal' && v.cur === v.youIndex ? v.hints.victims || [] : [];
    $('#playersBar').innerHTML = v.players
      .map((p) => {
        const m = meta.find((x) => x.id === p.id);
        const online = m ? m.connected || m.bot : true;
        const pick = stealable.includes(p.i);
        const initial = esc(([...p.name][0] || '?').toUpperCase());
        return `<div class="pl ${p.i === v.cur ? 'cur' : ''} ${p.i === v.youIndex ? 'me' : ''} ${pick ? 'pick' : ''} ${S.focus === p.i ? 'focus' : ''}" data-i="${p.i}" style="--c:${esc(p.color)}" title="${pick ? 'Steal from ' + esc(p.name) : 'Tap to spotlight ' + esc(p.name) + '\'s pieces'}" data-act="${pick ? 'steal' : 'focusPlayer'}" data-pi="${p.i}">
          <span class="seal" style="${sealInk(p.color)}" aria-hidden="true">${initial}</span>
          <div class="meta">
            <div class="nm"><span class="offline ${online ? 'online' : ''}" title="${online ? 'connected' : 'offline'}"></span>${esc(p.name)}${p.bot ? '<span class="tag-s">bot</span>' : ''}</div>
            <div class="stats"><span title="Resource cards">${I.cards}${p.cards}</span><span title="Development cards">${I.scroll}${p.dev}</span><span title="Knights played">${I.sword}${p.knights}</span><span title="Longest road">${I.road}${p.longest}</span></div>
            ${p.hasLongest || p.hasArmy ? `<div class="badges">${p.hasLongest ? '<span class="badge">Longest Road</span>' : ''}${p.hasArmy ? '<span class="badge army">Largest Army</span>' : ''}</div>` : ''}
          </div>
          <span class="vp" title="Victory points" aria-label="${p.vp} victory points">${p.vp}</span>
          ${v.phase !== 'over' && pending.includes(p.i) ? '<span class="waitdot"></span>' : ''}
        </div>`;
      })
      .join('');
    // keep whoever is acting in view when the bar scrolls sideways (phones)
    const bar = $('#playersBar');
    const cur = bar.querySelector('.pl.cur');
    if (cur && bar.scrollWidth > bar.clientWidth + 2 && S.lastCur !== v.cur) {
      const left = Math.max(0, cur.offsetLeft - (bar.clientWidth - cur.offsetWidth) / 2);
      bar.scrollTo({ left, behavior: S.lastCur === undefined ? 'auto' : 'smooth' });
    }
    S.lastCur = v.cur;
  }

  function whyNot(v, kind) {
    const me = v.youIndex;
    if (v.cur !== me) return 'It is not your turn.';
    if (v.turn.step === 'roll') return 'Roll the dice first.';
    if (v.turn.step !== 'main') return 'Finish the current step first.';
    const hand = v.you.hand;
    const miss = missing(hand, COST[kind]);
    if (miss.length) return 'You need ' + miss.join(', ') + ' more.';
    const me_ = v.players[me];
    if (kind === 'road' && me_.roads >= 15) return 'You have no road pieces left.';
    if (kind === 'settlement' && me_.settlements >= 5) return 'You have no settlement pieces left.';
    if (kind === 'city' && me_.cities >= 4) return 'You have no city pieces left.';
    if (kind === 'dev' && v.deckLeft < 1) return 'The development deck is empty.';
    return 'There is no legal spot for that right now.';
  }

  // The tray keeps its hand cards between updates so gains can animate; only the
  // card list and action row are rebuilt.
  function ensureTray(mode) {
    const tray = $('#tray');
    if (tray.dataset.mode === mode) return;
    tray.dataset.mode = mode;
    S.prevHand = null;
    if (mode === 'play') {
      tray.innerHTML = `<div class="hand" id="hand">${RES.map(
        (r) => `<button class="rcard" data-act="handCard" data-res="${r}" title="${RES_LABEL[r]}: tap to trade it with the bank">
          <span class="ratio" title="Bank trade rate"></span>
          <div class="art" style="--c:${RES_COLOR[r]}">${HB.iconSvg(r, 38)}</div>
          <span class="n">0</span><span class="nm">${RES_LABEL[r]}</span></button>`
      ).join('')}</div><div class="devs" id="devs"></div><div class="actions" id="actions"></div>`;
    } else if (mode === 'replay') {
      tray.innerHTML = `<div class="replaybar">
        <button class="btn" data-act="replayStep" data-d="-1" aria-label="Step back">&#9664;</button>
        <button class="btn" data-act="replayPlay" id="replayPlayBtn">Play</button>
        <button class="btn" data-act="replayStep" data-d="1" aria-label="Step forward">&#9654;</button>
        <input type="range" min="0" max="0" value="0" data-replay-range aria-label="Replay position">
        <button class="btn danger" data-act="replayExit">Exit replay</button></div>`;
    } else {
      tray.innerHTML = '<div class="devs">You are watching this game. Chat is open to everyone.</div>';
    }
  }

  function flashGain(card, n) {
    card.classList.remove('gain');
    void card.offsetWidth;
    card.classList.add('gain');
    const plus = document.createElement('span');
    plus.className = 'plus';
    plus.textContent = '+' + n;
    card.appendChild(plus);
    setTimeout(() => {
      plus.remove();
      card.classList.remove('gain');
    }, 1050);
  }

  function renderTray(v) {
    if (S.replay) {
      ensureTray('replay');
      const r = S.replay;
      const range = $('#tray [data-replay-range]');
      range.max = r.total;
      if (document.activeElement !== range) range.value = r.step;
      $('#replayPlayBtn').textContent = r.playing ? 'Pause' : 'Play';
      return;
    }
    if (!v.you || v.youIndex < 0) {
      ensureTray('watch');
      return;
    }
    ensureTray('play');
    const me = v.youIndex;
    const mine = v.cur === me && v.phase === 'main';
    const step = v.turn.step;
    const hand = v.you.hand;
    const h = v.hints || {};

    // hand: patch in place, flash cards that grew
    for (const r of RES) {
      const card = $(`#hand [data-res="${r}"]`);
      card.classList.toggle('zero', !hand[r]);
      card.querySelector('.n').textContent = hand[r];
      card.querySelector('.ratio').textContent = v.you.ratios[r] + ':1';
      if (S.prevHand && hand[r] > S.prevHand[r]) {
        const gained = hand[r] - S.prevHand[r];
        // let the flying resources land first
        setTimeout(() => flashGain(card, gained), REDUCED || document.hidden ? 0 : 650);
      }
    }
    S.prevHand = Object.assign({}, hand);

    const devKinds = ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly'];
    const canPlay = mine && !v.turn.devPlayed && (step === 'roll' || step === 'main');
    const devHtml =
      devKinds
        .filter((k) => v.you.dev[k] + v.you.devNew[k] > 0)
        .map((k) => {
          const playable = v.you.playable[k] && canPlay;
          return `<span class="dev"><b>${v.you.dev[k] + v.you.devNew[k]}&times;</b> ${DEV_NAMES[k]}${v.you.devNew[k] ? ` <span class="new">(${v.you.devNew[k]} new)</span>` : ''}
            <button class="btn sm" data-act="playDev" data-card="${k}" ${playable ? '' : 'disabled'}>Play</button></span>`;
        })
        .join('') +
      (v.you.vpHidden ? `<span class="dev"><b>${v.you.vpHidden}&times;</b> Victory Point <span class="new">(hidden, counts for you)</span></span>` : '');
    $('#devs').innerHTML = `<span>${v.deckLeft} cards left in the deck</span>${devHtml}`;

    const afford = (list) => mine && step === 'main' && list && list.length > 0;
    const keys = { road: '1', settlement: '2', city: '3' };
    const modeBtn = (kind, label, icon, list) => {
      const ok = afford(list);
      return `<button class="btn ${S.mode === kind ? 'on' : ''} ${ok ? '' : 'soft'}" data-act="mode" data-m="${kind}" data-key="${keys[kind]}" title="${ok ? `Build a ${label.toLowerCase()}` : esc(whyNot(v, kind))}">${icon}${label} ${costChips(COST[kind])}</button>`;
    };
    const buyOk = mine && step === 'main' && v.deckLeft > 0 && missing(hand, COST.dev).length === 0;
    $('#actions').innerHTML = `
      <button class="btn primary" data-act="roll" data-key="R" ${mine && step === 'roll' ? '' : 'disabled'}>${I.dice}Roll dice</button>
      ${modeBtn('road', 'Road', I.road, h.roads)}
      ${modeBtn('settlement', 'Settlement', I.house, h.settlements)}
      ${modeBtn('city', 'City', I.city, h.cities)}
      <button class="btn ${buyOk ? '' : 'soft'}" data-act="buyDev" data-key="4" title="${buyOk ? 'Buy a development card' : esc(whyNot(v, 'dev'))}">${I.card}Buy card ${costChips(COST.dev)}</button>
      <button class="btn" data-act="trade" data-key="T" ${mine && step === 'main' ? '' : 'disabled'}>${I.trade}Trade</button>
      <button class="btn primary" data-act="endTurn" data-key="E" ${mine && step === 'main' ? '' : 'disabled'}>End turn</button>`;
  }

  function renderBanner(v) {
    const box = $('#banner');
    if (S.replay || v.youIndex < 0) {
      box.innerHTML = '';
      return;
    }
    const me = v.youIndex;
    const cards = [];
    for (const o of v.offers) {
      const mineOffer = o.from === me;
      if (mineOffer) {
        const accepters = o.accepted.map((i) => `<button class="btn sm primary" data-act="confirm" data-offer="${o.id}" data-with="${i}">Trade with ${esc(v.players[i].name)}</button>`).join('');
        cards.push(`<div class="bcard">You offer ${bundle(o.give)} for ${bundle(o.want)}
          <div style="color:var(--ink-2);font-size:12px;margin-top:4px">${o.accepted.length ? 'Accepted by ' + o.accepted.map((i) => esc(v.players[i].name)).join(', ') : 'Waiting for answers…'}${o.declined.length ? ' · declined by ' + o.declined.map((i) => esc(v.players[i].name)).join(', ') : ''}</div>
          <div class="row">${accepters}<button class="btn sm" data-act="cancelOffer">Cancel offer</button></div></div>`);
      } else if ((!o.to || o.to.includes(me)) && !o.accepted.includes(me) && !o.declined.includes(me)) {
        const can = RES.every((r) => (v.you.hand[r] || 0) >= (o.want[r] || 0));
        cards.push(`<div class="bcard">${pn(o.from, true)} offers ${bundle(o.give)} for your ${bundle(o.want)}
          <div class="row"><button class="btn sm primary" data-act="respond" data-offer="${o.id}" data-accept="1" ${can ? '' : 'disabled'}>Accept</button>
          <button class="btn sm" data-act="respond" data-offer="${o.id}" data-accept="0">Decline</button>${can ? '' : '<span style="color:var(--ink-2);font-size:12px">You lack those cards</span>'}</div></div>`);
      } else if (!mineOffer && (o.accepted.includes(me) || o.declined.includes(me))) {
        cards.push(`<div class="bcard" style="border-color:var(--paper-line)">${pn(o.from, true)}'s offer: you ${o.accepted.includes(me) ? 'accepted. Waiting for them…' : 'declined.'}</div>`);
      }
    }
    box.innerHTML = cards.join('');
  }

  function renderLog(v) {
    const el = $('#logList');
    const html = v.log.map((ev) => {
      const [h, cls] = fmtEvent(ev);
      return h ? `<div class="logline ${cls || ''}">${h}</div>` : '';
    }).join('');
    if (el.dataset.html === html) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    el.innerHTML = html;
    el.dataset.html = html;
    if (near || !el.dataset.init) el.scrollTop = el.scrollHeight;
    el.dataset.init = '1';
  }

  function renderGame() {
    const v = V();
    if (!v || !S.board) return;
    ensureBoardView();
    if (!S.replay && v.youIndex >= 0) {
      const myTurnMain = v.cur === v.youIndex && v.phase === 'main' && v.turn.step === 'main';
      if (!myTurnMain) S.mode = null;
    }
    renderTop(v);
    renderPlayers(v);
    renderTray(v);
    renderBanner(v);
    renderLog(v);
    const show = computeShow(v);
    S.bv.setFocus(S.focus);
    S.bv.update(v, show);
    // a previewed spot (touch confirm step) is dropped once it stops being legal
    if (S.pending) {
      const p = S.pending;
      const list = show && (p.kind === 'vertex' ? show.vertices : p.kind === 'edge' ? show.edges : show.hexes);
      if (!list || !list.includes(p.id)) {
        S.pending = null;
        S.bv.clearGhost(false);
      }
    }
    renderConfirm();
    // corner readouts: real values, shown by the Holotable theme
    const hudTL = $('#hudTL');
    const hudBR = $('#hudBR');
    if (hudTL && hudBR) {
      const stepName = { roll: 'Roll', main: 'Actions', robber: 'Robber', steal: 'Steal', discard: 'Discard', roadbuilding: 'Roads', over: 'Ended', setup: 'Setup' };
      const phase = S.replay ? 'Replay' : v.phase === 'setup' ? 'Setup' : stepName[v.turn.step] || '';
      const tl = `SECTOR // ${esc(S.board.name.toUpperCase())}<br>${v.players.length} PLAYERS // FIRST TO <b>${v.settings.vp}</b>`;
      const br = `TURN <b>${v.turn.n ? String(v.turn.n).padStart(2, '0') : '--'}</b> // ${esc(phase.toUpperCase())}<br>DECK ${v.deckLeft}`;
      if (hudTL.dataset.h !== tl) { hudTL.dataset.h = tl; hudTL.innerHTML = tl; }
      if (hudBR.dataset.h !== br) { hudBR.dataset.h = br; hudBR.innerHTML = br; }
    }
    $('#game').classList.toggle('side-open', S.sideOpen);
    $$('#side .tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
    $('#logList').hidden = S.tab !== 'log';
    $('#chatPane').hidden = S.tab !== 'chat';
    updateChat();
    const mine = !S.replay && v.youIndex >= 0 && v.phase !== 'over' && (v.cur === v.youIndex || !!(v.hints && v.hints.discard));
    document.title = mine ? '● Your turn · Hexlands' : 'Hexlands';
  }

  // ---- effects: sound, haptics, flying resources, confetti ----------------------------

  function trailDot(x, y, color) {
    const d = document.createElement('i');
    d.className = 'trail';
    d.style.setProperty('--c', color);
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 520);
  }

  function sparks(x, y, color) {
    if (REDUCED || !prefs.fx || !x) return;
    for (let i = 0; i < 12; i++) {
      const s = document.createElement('i');
      s.className = 'spark';
      s.style.setProperty('--c', i % 3 === 0 ? '#ffffff' : color);
      document.body.appendChild(s);
      const ang = (Math.PI * 2 * i) / 12 + Math.random() * 0.5;
      const dist = 24 + Math.random() * 40;
      s.animate(
        [
          { transform: `translate(${x}px, ${y}px) scale(1)`, opacity: 1 },
          { transform: `translate(${x + Math.cos(ang) * dist}px, ${y + Math.sin(ang) * dist}px) scale(0.2)`, opacity: 0 },
        ],
        { duration: 480 + Math.random() * 200, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'forwards' }
      ).onfinish = () => s.remove();
    }
  }

  // A short RGB-split kick across the whole screen on big moments (Neon: Max only).
  function hit(strong) {
    if (REDUCED || !prefs.fx) return;
    const g = $('#game');
    if (!g || g.hidden) return;
    g.classList.remove('hit', 'hit-strong');
    void g.offsetWidth;
    g.classList.add(strong ? 'hit-strong' : 'hit');
    clearTimeout(g._ht);
    g._ht = setTimeout(() => g.classList.remove('hit', 'hit-strong'), strong ? 460 : 300);
  }

  function spawnOrb(sx, sy, tx, ty, color, delay, target, bump) {
    const orb = document.createElement('div');
    orb.className = 'orb';
    orb.style.setProperty('--c', color);
    document.body.appendChild(orb);
    const mx = (sx + tx) / 2 + (Math.random() - 0.5) * 60;
    const my = Math.min(sy, ty) - 40 - Math.random() * 30;
    const anim = orb.animate(
      [
        { transform: `translate(${sx}px, ${sy}px) scale(0.4)`, opacity: 0 },
        { transform: `translate(${mx}px, ${my}px) scale(1.15)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${tx}px, ${ty}px) scale(0.55)`, opacity: 0.95 },
      ],
      { duration: 760, delay, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'both' }
    );
    let trailIv = null;
    if (prefs.fx) {
      setTimeout(() => {
        trailIv = setInterval(() => {
          if (!orb.isConnected) return;
          const r = orb.getBoundingClientRect();
          trailDot(r.left + r.width / 2, r.top + r.height / 2, color);
        }, 55);
      }, delay);
    }
    anim.onfinish = () => {
      clearInterval(trailIv);
      orb.remove();
      if (bump && target.isConnected) {
        target.classList.remove('bump');
        void target.offsetWidth;
        target.classList.add('bump');
        setTimeout(() => target.classList.remove('bump'), 450);
      }
    };
  }

  // After a roll, resources fly from the producing tiles to whoever earned them.
  function flyOrbs(v, ev) {
    if (REDUCED || document.hidden || !S.bv || !S.board) return;
    let count = 0;
    for (const g of ev.gains) {
      for (const r of RES) {
        const n = g.res[r];
        if (!n) continue;
        const srcs = S.board.hexes.filter(
          (h) => h.number === ev.sum && HB.TERRAIN_RES[h.terrain] === r && h.id !== v.robber && h.vertices.some((vid) => v.buildings[vid] && v.buildings[vid].p === g.p)
        );
        const mineGain = g.p === v.youIndex;
        const target = mineGain ? $(`#hand [data-res="${r}"]`) : $(`#playersBar .pl[data-i="${g.p}"]`);
        if (!target || !srcs.length) continue;
        const t = target.getBoundingClientRect();
        for (let k = 0; k < n && count < 28; k++, count++) {
          const s = S.bv.hexScreenPos(srcs[k % srcs.length].id);
          if (s) spawnOrb(s.x, s.y, t.left + t.width / 2, t.top + t.height / 2, HB.RES_FILL[r], count * 70, target, !mineGain);
        }
      }
    }
  }

  function confetti() {
    if (REDUCED) return;
    const colors = ['#ffb02e', '#3de1ff', '#ff5d6c', '#4cffb0', '#ffffff', '#f1c765'];
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight * 0.3;
    for (let i = 0; i < 70; i++) {
      const p = document.createElement('i');
      p.className = 'confetti';
      p.style.background = colors[i % colors.length];
      document.body.appendChild(p);
      const ang = Math.random() * Math.PI * 2;
      const dist = 120 + Math.random() * 280;
      p.animate(
        [
          { transform: `translate(${cx}px, ${cy}px) rotate(0deg)`, opacity: 1 },
          { transform: `translate(${cx + Math.cos(ang) * dist}px, ${cy + Math.sin(ang) * dist + 170}px) rotate(${Math.random() * 720}deg)`, opacity: 0 },
        ],
        { duration: 1400 + Math.random() * 700, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' }
      ).onfinish = () => p.remove();
    }
  }

  const isMyTurn = (v) => v.youIndex >= 0 && v.phase !== 'over' && v.cur === v.youIndex;

  // Turn new log events into sound, vibration and motion. The first view after joining only records the baseline.
  function reactToEvents() {
    const v = S.game;
    if (!v || S.replay) return;
    const latest = v.log.length ? v.log[v.log.length - 1].seq : 0;
    if (S.lastSeq === null) {
      S.lastSeq = latest;
      S.wasMyTurn = isMyTurn(v);
      return;
    }
    const fresh = v.log.filter((e) => e.seq > S.lastSeq);
    S.lastSeq = latest;
    const me = v.youIndex;
    for (const ev of fresh) {
      switch (ev.t) {
        case 'roll': {
          const total = ev.d[0] + ev.d[1];
          sfx.dice();
          haptic(ev.p === me ? [12, 40, 12] : 6);
          if (S.bv) S.bv.shock(total === 7 ? '#ff4d5e' : '#3de1ff');
          if (total === 7) { sfx.hit(); hit(true); } else hit(false);
          break;
        }
        case 'produce':
          if (ev.gains.length) sfx.sweep();
          if (ev.gains.some((g) => g.p === me)) { sfx.gain(); haptic(18); }
          flyOrbs(v, ev);
          break;
        case 'build': {
          sfx.zap();
          if (ev.p === me) haptic(20);
          if (S.bv && S.board) {
            const pos = ev.what === 'road' ? S.bv.edgeScreenPos(ev.at) : S.bv.vertexScreenPos(ev.at);
            if (pos) sparks(pos.x, pos.y, v.players[ev.p].color);
          }
          if (ev.what === 'city') hit(false);
          break;
        }
        case 'robber': sfx.robber(); hit(true); break;
        case 'steal': sfx.glitch(); if (ev.p === me || ev.from === me) haptic([30, 30, 30]); break;
        case 'offer': if (ev.p !== me) { sfx.ping(); haptic(15); } break;
        case 'trade': sfx.gain(); break;
        case 'dev': case 'devbuy': sfx.click(); break;
        case 'win': sfx.win(); haptic([60, 40, 60, 40, 120]); confetti(); hit(true); break;
        default:
      }
    }
    const mine = isMyTurn(v);
    if (mine && !S.wasMyTurn) { sfx.turn(); haptic([25, 40, 25]); }
    S.wasMyTurn = mine;
  }

  // ---- modals -------------------------------------------------------------------------

  function activeModal() {
    const v = V();
    if (S.replay) return S.modal && S.modal.type === 'menu' ? S.modal : null;
    if (v.phase === 'over' && !S.overDismissed) return { type: 'over' };
    if (v.youIndex >= 0) {
      if (v.hints && v.hints.discard) return { type: 'discard' };
      if (v.turn.step === 'steal' && v.cur === v.youIndex) return { type: 'steal' };
    }
    return S.modal;
  }

  function picker(selectedFn, disabledFn, labelFn, act) {
    return `<div class="picker">${RES.map((r) => {
      const sel = selectedFn(r);
      const dis = disabledFn(r);
      return `<div class="pcard res-${r} ${sel ? 'sel' : ''} ${dis ? 'dis' : ''}" ${dis ? '' : `data-act="${act}" data-res="${r}"`}>${HB.iconSvg(r, 30)}<b>${labelFn(r)}</b><small>${RES_LABEL[r]}</small></div>`;
    }).join('')}</div>`;
  }

  function stepper(kind, r, n, max) {
    return `<div class="stepcol"><div class="pcard res-${r}" style="width:100%;cursor:default">${HB.iconSvg(r, 26)}<small>${RES_LABEL[r]}</small></div>
      <button class="btn" data-act="tradeAdj" data-side="${kind}" data-res="${r}" data-d="1" ${n >= max ? 'disabled' : ''}>＋</button>
      <span class="n">${n}</span>
      <button class="btn" data-act="tradeAdj" data-side="${kind}" data-res="${r}" data-d="-1" ${n <= 0 ? 'disabled' : ''}>－</button></div>`;
  }

  function modalHtml(m) {
    const v = V();
    const me = v.youIndex;
    if (m.type === 'discard') {
      const need = v.hints.discard;
      const hand = v.you.hand;
      const key = need + JSON.stringify(hand);
      if (S.discardKey !== key) { S.discardKey = key; S.discardSel = {}; }
      const chosen = sum(S.discardSel);
      return `<div class="sheet"><h2>The robber strikes!</h2><p class="sub">You hold more than ${v.settings.discardLimit} cards. Discard <b>${need}</b> (${chosen}/${need} chosen).</p>
        <div class="picker">${RES.map((r) => `<div class="stepcol"><div class="pcard res-${r}" style="width:100%;cursor:default">${HB.iconSvg(r, 26)}<b>${hand[r]}</b><small>${RES_LABEL[r]}</small></div>
          <button class="btn" data-act="discAdj" data-res="${r}" data-d="1" ${(S.discardSel[r] || 0) >= hand[r] || chosen >= need ? 'disabled' : ''}>＋</button>
          <span class="n">${S.discardSel[r] || 0}</span>
          <button class="btn" data-act="discAdj" data-res="${r}" data-d="-1" ${(S.discardSel[r] || 0) <= 0 ? 'disabled' : ''}>－</button></div>`).join('')}</div>
        <div class="foot"><button class="btn primary" data-act="doDiscard" ${chosen === need ? '' : 'disabled'}>Discard ${need}</button></div></div>`;
    }
    if (m.type === 'steal') {
      const victims = v.hints.victims || [];
      return `<div class="sheet"><h2>Steal a card</h2><p class="sub">Choose who to rob.</p>
        <div class="who-list">${victims.map((i) => `<button class="btn" style="border-left:8px solid ${esc(v.players[i].color)}" data-act="steal" data-pi="${i}">${esc(v.players[i].name)} · ${v.players[i].cards} cards</button>`).join('')}</div></div>`;
    }
    if (m.type === 'trade') {
      const t = S.trade;
      const hand = v.you.hand;
      const others = v.players.filter((p) => p.i !== me);
      const tabs = `<div class="tabbar"><button class="btn ${t.tab === 'players' ? 'on' : ''}" data-act="tradeTab" data-tab="players">With players</button><button class="btn ${t.tab === 'bank' ? 'on' : ''}" data-act="tradeTab" data-tab="bank">Bank &amp; ports</button></div>`;
      if (t.tab === 'bank') {
        const ratios = v.you.ratios;
        const giveOk = (r) => hand[r] >= ratios[r];
        const g = t.bankGive && giveOk(t.bankGive) ? t.bankGive : null;
        const k = t.bankGet && t.bankGet !== g ? t.bankGet : null;
        return `<div class="sheet"><h2>Trade with the bank</h2>${tabs}
          <p class="sub">Give (rate shown by your ports)</p>
          ${picker((r) => r === g, (r) => !giveOk(r), (r) => `${ratios[r]}:1`, 'bankGive')}
          <p class="sub" style="margin-top:12px">Receive 1</p>
          ${picker((r) => r === k, (r) => r === g || v.bank[r] < 1, (r) => v.bank[r], 'bankGet')}
          <div class="foot"><button class="btn" data-act="closeModal">Close</button>
          <button class="btn primary" data-act="doBank" ${g && k ? '' : 'disabled'}>${g && k ? `Trade ${ratios[g]} ${RES_LABEL[g]} for 1 ${RES_LABEL[k]}` : 'Pick both'}</button></div></div>`;
      }
      const giveSum = sum(t.give);
      const wantSum = sum(t.want);
      const overlap = RES.some((r) => t.give[r] && t.want[r]);
      const ok = giveSum > 0 && wantSum > 0 && !overlap;
      const who = `<button class="btn sm ${t.to.length === 0 ? 'on' : ''}" data-act="tradeTo" data-pi="all">Everyone</button>` + others.map((p) => `<button class="btn sm ${t.to.includes(p.i) ? 'on' : ''}" style="border-left:6px solid ${esc(p.color)}" data-act="tradeTo" data-pi="${p.i}">${esc(p.name)}</button>`).join('');
      return `<div class="sheet"><h2>Offer a trade</h2>${tabs}
        <p class="sub">You give</p><div class="picker">${RES.map((r) => stepper('give', r, t.give[r] || 0, hand[r])).join('')}</div>
        <p class="sub" style="margin-top:12px">You want</p><div class="picker">${RES.map((r) => stepper('want', r, t.want[r] || 0, 9)).join('')}</div>
        <p class="sub" style="margin-top:12px">Offer to</p><div class="who-list">${who}</div>
        ${overlap ? '<p class="warn">You cannot ask for a resource you are giving.</p>' : ''}
        <div class="foot"><button class="btn" data-act="closeModal">Close</button><button class="btn primary" data-act="sendOffer" ${ok ? '' : 'disabled'}>Send offer</button></div></div>`;
    }
    if (m.type === 'yop') {
      return `<div class="sheet"><h2>Year of Plenty</h2><p class="sub">Pick any 2 resources from the bank (${S.yop.length}/2).</p>
        ${picker((r) => S.yop.includes(r), (r) => v.bank[r] < 1, (r) => S.yop.filter((x) => x === r).length || '', 'yopPick')}
        <div class="foot"><button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" data-act="doYop" ${S.yop.length === 2 ? '' : 'disabled'}>Take them</button></div></div>`;
    }
    if (m.type === 'monopoly') {
      return `<div class="sheet"><h2>Monopoly</h2><p class="sub">Choose a resource. Every other player hands you all of theirs.</p>
        ${picker(() => false, () => false, () => '', 'monoPick')}
        <div class="foot"><button class="btn" data-act="closeModal">Cancel</button></div></div>`;
    }
    if (m.type === 'over') {
      const rows = v.final.slice().sort((a, b) => b.vp - a.vp).map((f) => {
        const p = v.players[f.i];
        return `<tr class="${f.i === v.winner ? 'win' : ''}"><td><span class="dot" style="display:inline-block;width:14px;height:14px;vertical-align:middle;background:${esc(p.color)}"></span> ${esc(p.name)}</td><td>${f.vp}</td><td>${f.vpCards}</td><td>${p.settlements}/${p.cities}</td><td>${p.longest}</td><td>${p.knights}</td></tr>`;
      }).join('');
      const isHost = S.info && S.info.hostId === (S.me && S.me.id);
      return `<div class="sheet"><div class="big-win">🏆 <span>${esc(v.players[v.winner].name)}</span> wins!</div>
        <table class="final-table"><tr><th>Player</th><th>VP</th><th>VP cards</th><th>Towns/Cities</th><th>Road</th><th>Knights</th></tr>${rows}</table>
        <div class="foot"><button class="btn" data-act="overClose">Look at the board</button><button class="btn" data-act="replayOpen">Watch replay</button>
        ${isHost ? '<button class="btn primary" data-act="toLobby">Back to lobby</button>' : '<span class="sub" style="margin:8px 0 0">Waiting for the host to start a rematch…</span>'}</div></div>`;
    }
    if (m.type === 'menu') {
      const isHost = S.info && S.info.hostId === (S.me && S.me.id);
      const st = v.settings;
      const humans = S.info ? S.info.members.filter((x) => x.human && x.id !== (S.me && S.me.id) && v.players.some((p) => p.id === x.id)) : [];
      const links = S.info ? inviteLinks() : [];
      return `<div class="sheet"><h2>Room ${esc(S.info.code)}</h2>
        <p class="sub">${esc(S.board.name)} · ${v.players.length} players · ${st.vp} VP · ${st.dice} dice${st.friendlyRobber ? ' · friendly robber' : ''}${st.quickStart ? ' · quick start' : ''}</p>
        <p class="sub">Invite: ${links.map((l) => `<code data-act="copy" data-text="${esc(l)}" style="cursor:pointer">${esc(l)}</code>`).join(' ')}</p>
        <p class="sub">Bank: ${RES.map((r) => pill(r, v.bank[r])).join('')}</p>
        ${isHost && humans.length ? `<p class="sub">Friend gone? Let a bot play for them:</p><div class="who-list">${humans.map((h) => `<button class="btn sm" data-act="autoplay" data-id="${esc(h.id)}" data-on="${h.bot ? 0 : 1}">${esc(h.name)}: ${h.bot ? 'bot is playing, give back' : 'hand over to a bot'}</button>`).join('')}</div>` : ''}
        <div style="margin-top:8px">
          <div class="set-row"><span>Look<small>Dark glass HUD or classic wooden table</small></span><div class="seg"><button data-act="setTheme" data-v="holo" class="${theme() === 'holo' ? 'on' : ''}">Holo</button><button data-act="setTheme" data-v="tabletop" class="${theme() === 'tabletop' ? 'on' : ''}">Tabletop</button></div></div>
          <div class="set-row"><span>Sound<small>Dice, building, trades, your turn</small></span><div class="seg"><button data-act="setPref" data-k="sound" data-v="on" class="${prefs.sound ? 'on' : ''}">On</button><button data-act="setPref" data-k="sound" data-v="off" class="${prefs.sound ? '' : 'on'}">Off</button></div></div>
          <div class="set-row"><span>Neon effects<small>Scanlines, glitch, light trails. Calm turns the loud ones off</small></span><div class="seg"><button data-act="setPref" data-k="fx" data-v="on" class="${prefs.fx ? 'on' : ''}">Max</button><button data-act="setPref" data-k="fx" data-v="off" class="${prefs.fx ? '' : 'on'}">Calm</button></div></div>
          <div class="set-row"><span>Vibration<small>Short taps on phones</small></span><div class="seg"><button data-act="setPref" data-k="haptics" data-v="on" class="${prefs.haptics ? 'on' : ''}">On</button><button data-act="setPref" data-k="haptics" data-v="off" class="${prefs.haptics ? '' : 'on'}">Off</button></div></div>
          <div class="set-row"><span>Confirm placements<small>Preview first, then confirm. Best on touch screens</small></span><div class="seg"><button data-act="setPref" data-k="confirm" data-v="on" class="${prefs.confirm ? 'on' : ''}">On</button><button data-act="setPref" data-k="confirm" data-v="off" class="${prefs.confirm ? '' : 'on'}">Off</button></div></div>
        </div>
        <div class="kbd-grid"><kbd>R</kbd><span>Roll</span><kbd>E</kbd><span>End turn</span><kbd>T</kbd><span>Trade</span><kbd>4</kbd><span>Buy a card</span><kbd>1 2 3</kbd><span>Road, town, city</span><kbd>Esc</kbd><span>Cancel</span></div>
        <div class="foot"><button class="btn" data-act="help">How to play</button>
          ${v.phase === 'over' ? '<button class="btn" data-act="replayOpen">Replay</button>' : ''}
          <button class="btn" data-act="home">Leave table</button><button class="btn primary" data-act="closeModal">Back to game</button></div></div>`;
    }
    if (m.type === 'help') {
      const c = (k) => `${costChips(COST[k])}`;
      return `<div class="sheet"><h2>How to play</h2>
        <p class="sub">Settle the island and be first to reach <b>${v.settings.vp} victory points</b> on your turn.</p>
        <ul style="padding-left:18px;line-height:1.5;margin:0">
          <li><b>Setup:</b> in turn order place a settlement + road, then again in reverse. Your second settlement pays out cards.</li>
          <li><b>Your turn:</b> roll, collect from every matching hex next to your pieces (cities pay double), then build / trade.</li>
          <li><b>Build:</b> Road ${c('road')} · Settlement ${c('settlement')} (1 VP) · City ${c('city')} (2 VP) · Card ${c('dev')}</li>
          <li><b>Rule:</b> settlements need an empty spot at least two roads from any other settlement, and must touch your road.</li>
          <li><b>Rolling 7:</b> anyone holding over ${v.settings.discardLimit} cards discards half; the roller moves the robber and steals a card.</li>
          <li><b>Trade:</b> 4:1 with the bank, 3:1 or 2:1 with harbours you settle on, or offer deals to players.</li>
          <li><b>Bonuses:</b> Longest Road (5+ roads) = 2 VP · Largest Army (3+ knights) = 2 VP · hidden VP cards.</li>
        </ul><div class="foot"><button class="btn primary" data-act="closeModal">Got it</button></div></div>`;
    }
    return '';
  }

  function renderModal() {
    const box = $('#modal');
    const v = V();
    if (!v || !S.board || (S.info && S.info.status === 'lobby')) { box.hidden = true; return; }
    const m = activeModal();
    if (!m) { box.hidden = true; box.innerHTML = ''; return; }
    const html = modalHtml(m);
    if (box.dataset.html !== html) {
      box.innerHTML = html;
      box.dataset.html = html;
    }
    if (box.hidden) {
      box.classList.remove('glitch-in');
      void box.offsetWidth;
      box.classList.add('glitch-in');
      clearTimeout(box._gt);
      box._gt = setTimeout(() => box.classList.remove('glitch-in'), 450);
    }
    box.hidden = false;
  }

  // ---- replay ------------------------------------------------------------------------------

  async function fetchReplay(step) {
    const url = `/api/replay?code=${encodeURIComponent(S.session.code)}&token=${encodeURIComponent(S.session.token)}&step=${step}`;
    const r = await fetch(url);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Replay failed');
    return j;
  }

  async function replayGoto(step) {
    if (!S.replay) return;
    const target = Math.max(0, Math.min(S.replay.total, step));
    try {
      const j = await fetchReplay(target);
      if (!S.replay) return;
      S.replay.step = j.step;
      S.replay.total = j.total;
      S.replay.game = j.game;
      render();
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  async function openReplay() {
    try {
      const j = await fetchReplay(0);
      S.replay = { step: 0, total: j.total, game: j.game, playing: false, timer: null };
      S.modal = null;
      S.overDismissed = true;
      S.mode = null;
      render();
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  function stopReplayTimer() {
    if (S.replay && S.replay.timer) clearInterval(S.replay.timer);
    if (S.replay) S.replay.timer = null;
  }

  function toggleReplayPlay() {
    const r = S.replay;
    if (!r) return;
    if (r.playing) {
      r.playing = false;
      stopReplayTimer();
      render();
      return;
    }
    if (r.step >= r.total) r.step = 0;
    r.playing = true;
    r.timer = setInterval(async () => {
      if (!S.replay) return;
      if (S.replay.step >= S.replay.total) {
        S.replay.playing = false;
        stopReplayTimer();
        render();
        return;
      }
      await replayGoto(S.replay.step + 1);
    }, 420);
    render();
  }

  // ---- master render -------------------------------------------------------------------------

  function render() {
    if (!S.session || !S.info) {
      showScreen('home');
      $('#modal').hidden = true;
      return;
    }
    if (S.info.status === 'lobby') {
      showScreen('lobby');
      renderLobby();
      $('#modal').hidden = true;
      return;
    }
    if (!S.game || !S.board) return;
    showScreen('game');
    renderGame();
    renderModal();
  }

  // ---- events ----------------------------------------------------------------------------------

  async function lobbyCall(extra) {
    try {
      await post('/api/lobby', extra);
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  // Clipboard API only exists on https/localhost; plain-http LAN pages and the Android app use the textarea fallback.
  function copyText(text) {
    const done = () => toast('Copied!');
    const fallback = () => {
      // Select the text inside a throwaway non-editable span, copy, then clear the selection so Android's
      // floating "copy/edit" toolbar does not stay on screen.
      const holder = document.createElement('span');
      holder.textContent = text;
      holder.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;user-select:text;-webkit-user-select:text;white-space:pre;';
      document.body.appendChild(holder);
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(holder);
      sel.removeAllRanges();
      sel.addRange(range);
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
      sel.removeAllRanges();
      holder.remove();
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      if (ok) done(); else toast(text);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  // window.prompt does nothing inside an Android WebView, so ask for text with our own dialog.
  function askText(title, label, value, max) {
    return new Promise((resolve) => {
      const box = document.createElement('div');
      box.id = 'ask';
      box.innerHTML = `<form class="sheet"><h2>${esc(title)}</h2><label class="field">${esc(label)}<input type="text" maxlength="${max}" autocomplete="off" value="${esc(value)}"></label>
        <div class="foot"><button type="button" class="btn" data-no>Cancel</button><button type="submit" class="btn primary">Save</button></div></form>`;
      const input = box.querySelector('input');
      const close = (result) => { box.remove(); resolve(result); };
      box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(null); });
      box.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === box) close(null); });
      box.querySelector('[data-no]').addEventListener('click', () => close(null));
      box.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); close(input.value.trim() || null); });
      document.body.appendChild(box);
      input.focus();
      input.select();
    });
  }

  async function handleAct(t) {
    const d = t.dataset;
    const v = S.game;
    switch (d.act) {
      // lobby
      case 'copy': return copyText(d.text);
      case 'color': {
        const used = new Set(S.info.members.filter((m) => m.id !== S.me.id).map((m) => m.color));
        const mine = S.info.members.find((m) => m.id === S.me.id).color;
        const free = COLORS.filter((c) => !used.has(c));
        const next = free[(free.indexOf(mine) + 1) % free.length];
        return lobbyCall({ op: 'color', color: next });
      }
      case 'rename': {
        const name = await askText('Your name', 'Name', S.info.members.find((m) => m.id === S.me.id).name, 20);
        if (name) { store.set('hexlands.name', name); return lobbyCall({ op: 'name', name }); }
        return;
      }
      case 'remove': return lobbyCall({ op: 'remove', id: d.id });
      case 'addBot': return lobbyCall({ op: 'addBot' });
      case 'leaveLobby': await lobbyCall({ op: 'leave' }); return leaveToHome();
      case 'start': return lobbyCall({ op: 'start' });
      case 'set': return lobbyCall({ op: 'settings', settings: { [d.k]: d.v === 'true' ? true : d.v === 'false' ? false : isNaN(d.v) ? d.v : Number(d.v) } });
      case 'vp': return lobbyCall({ op: 'settings', settings: { vp: Math.max(4, Math.min(30, S.info.settings.vp + Number(d.d))) } });
      case 'map': return lobbyCall({ op: 'settings', settings: { map: d.id } });
      // board / panels
      case 'zoomIn': return S.bv && S.bv.zoomBy(1.3);
      case 'zoomOut': return S.bv && S.bv.zoomBy(1 / 1.3);
      case 'zoomReset': return S.bv && S.bv.reset();
      // spotlight, quick bank trade, touch confirm, preferences
      case 'focusPlayer': {
        const i = Number(d.pi);
        S.focus = S.focus === i ? null : i;
        return renderGame();
      }
      case 'handCard': {
        if (!v || v.youIndex < 0 || S.replay) return;
        const mineMain = v.cur === v.youIndex && v.phase === 'main' && v.turn.step === 'main';
        if (!mineMain) return toast(v.cur !== v.youIndex ? 'Wait for your turn to trade.' : 'Roll the dice first.', 'bad');
        const ratio = v.you.ratios[d.res];
        S.trade.tab = 'bank';
        S.trade.bankGive = v.you.hand[d.res] >= ratio ? d.res : null;
        S.trade.bankGet = null;
        if (!S.trade.bankGive) toast(`You need ${ratio} ${RES_LABEL[d.res]} to trade it with the bank.`, 'bad');
        S.modal = { type: 'trade' };
        return renderModal();
      }
      case 'confirmPick': {
        const p = S.pending;
        if (!p) return;
        const a = actionFor(p.kind, p.id);
        clearPending();
        if (a) doAct(a);
        return;
      }
      case 'cancelPick': return clearPending();
      case 'setTheme': applyTheme(d.v); return renderModal();
      case 'toggleSound':
        setPref('sound', !prefs.sound);
        if (prefs.sound) { sfx.unlock(); sfx.click(); }
        renderGame();
        return renderModal();
      case 'setPref': {
        const on = d.v === 'on';
        setPref(d.k, on);
        if (d.k === 'sound' && on) { sfx.unlock(); sfx.click(); }
        if (d.k === 'haptics' && on) haptic(25);
        if (d.k === 'confirm' && !on) clearPending();
        renderGame();
        return renderModal();
      }
      case 'tab': S.tab = d.tab; return renderGame();
      case 'openSide': S.sideOpen = true; return renderGame();
      case 'closeSide': S.sideOpen = false; return renderGame();
      case 'menu': S.modal = { type: 'menu' }; return renderModal();
      case 'help': S.modal = { type: 'help' }; return renderModal();
      case 'closeModal': S.modal = null; return renderModal();
      case 'overClose': S.overDismissed = true; return renderModal();
      case 'home': return leaveToHome(null, false);
      case 'toLobby': return lobbyCall({ op: 'reset' });
      case 'autoplay': return lobbyCall({ op: 'autoplay', id: d.id, on: d.on === '1' });
      // turn actions
      case 'roll': return doAct({ type: 'roll' });
      case 'endTurn': S.mode = null; return doAct({ type: 'endTurn' });
      case 'buyDev': {
        if (!v || v.youIndex < 0) return;
        const miss = whyNot(v, 'dev');
        if (v.cur !== v.youIndex || v.turn.step !== 'main' || missing(v.you.hand, COST.dev).length || v.deckLeft < 1) return toast(miss, 'bad');
        return doAct({ type: 'buyDev' });
      }
      case 'mode': {
        const list = { road: v.hints.roads, settlement: v.hints.settlements, city: v.hints.cities }[d.m];
        if (!(v.cur === v.youIndex && v.turn.step === 'main' && list && list.length)) return toast(whyNot(v, d.m), 'bad');
        S.mode = S.mode === d.m ? null : d.m;
        return renderGame();
      }
      case 'playDev': {
        const k = d.card;
        if (k === 'knight') return doAct({ type: 'playKnight' });
        if (k === 'roadBuilding') return doAct({ type: 'playRoadBuilding' });
        if (k === 'yearOfPlenty') { S.yop = []; S.modal = { type: 'yop' }; return renderModal(); }
        if (k === 'monopoly') { S.modal = { type: 'monopoly' }; return renderModal(); }
        return;
      }
      case 'yopPick': {
        if (S.yop.length < 2) S.yop.push(d.res);
        else S.yop = [d.res];
        return renderModal();
      }
      case 'doYop': { const [a, b] = S.yop; S.modal = null; renderModal(); return doAct({ type: 'playYearOfPlenty', a, b }); }
      case 'monoPick': S.modal = null; renderModal(); return doAct({ type: 'playMonopoly', res: d.res });
      case 'steal': return doAct({ type: 'steal', victim: Number(d.pi) });
      case 'discAdj': {
        const need = v.hints.discard;
        const cur = S.discardSel[d.res] || 0;
        const n = cur + Number(d.d);
        if (n < 0 || n > v.you.hand[d.res] || (Number(d.d) > 0 && sum(S.discardSel) >= need)) return;
        S.discardSel[d.res] = n;
        return renderModal();
      }
      case 'doDiscard': return doAct({ type: 'discard', cards: Object.fromEntries(Object.entries(S.discardSel).filter(([, n]) => n > 0)) });
      // trading
      case 'trade': S.trade.tab = 'players'; S.modal = { type: 'trade' }; return renderModal();
      case 'tradeTab': S.trade.tab = d.tab; return renderModal();
      case 'tradeAdj': {
        const side = S.trade[d.side];
        const max = d.side === 'give' ? v.you.hand[d.res] : 9;
        side[d.res] = Math.max(0, Math.min(max, (side[d.res] || 0) + Number(d.d)));
        return renderModal();
      }
      case 'tradeTo': {
        if (d.pi === 'all') S.trade.to = [];
        else {
          const i = Number(d.pi);
          S.trade.to = S.trade.to.includes(i) ? S.trade.to.filter((x) => x !== i) : [...S.trade.to, i];
        }
        return renderModal();
      }
      case 'sendOffer': {
        const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, n]) => n > 0));
        const action = { type: 'proposeTrade', give: clean(S.trade.give), want: clean(S.trade.want), to: S.trade.to.length ? S.trade.to : null };
        S.modal = null;
        renderModal();
        return doAct(action);
      }
      case 'bankGive': S.trade.bankGive = d.res; if (S.trade.bankGet === d.res) S.trade.bankGet = null; return renderModal();
      case 'bankGet': S.trade.bankGet = d.res; return renderModal();
      case 'doBank': {
        const action = { type: 'bankTrade', give: S.trade.bankGive, get: S.trade.bankGet };
        S.trade.bankGive = S.trade.bankGet = null;
        return doAct(action);
      }
      case 'respond': return doAct({ type: 'respondTrade', offer: Number(d.offer), accept: d.accept === '1' });
      case 'confirm': return doAct({ type: 'confirmTrade', offer: Number(d.offer), with: Number(d.with) });
      case 'cancelOffer': return doAct({ type: 'cancelTrade' });
      // replay
      case 'replayOpen': return openReplay();
      case 'replayExit': stopReplayTimer(); S.replay = null; return render();
      case 'replayPlay': return toggleReplayPlay();
      case 'replayStep': stopReplayTimer(); if (S.replay) S.replay.playing = false; return replayGoto(S.replay.step + Number(d.d));
      default:
    }
  }

  function bindEvents() {
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act]');
      if (!t || t.disabled) return;
      handleAct(t).catch((err) => toast(err.message || String(err), 'bad'));
    });
    document.addEventListener('input', (e) => {
      if (e.target.matches('[data-replay-range]')) {
        stopReplayTimer();
        if (S.replay) S.replay.playing = false;
        replayGoto(Number(e.target.value));
      }
    });
    document.addEventListener('submit', async (e) => {
      if (!e.target.matches('[data-chat]')) return;
      e.preventDefault();
      const input = e.target.querySelector('input');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try { await post('/api/chat', { text }); } catch (err) { toast(err.message, 'bad'); }
    });
    $('#modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal') {
        const m = activeModal();
        if (m && ['trade', 'menu', 'help', 'yop', 'monopoly'].includes(m.type)) { S.modal = null; renderModal(); }
      }
    });
    // sound needs a first tap to unlock; every wooden/glass button gets a soft click
    document.addEventListener('pointerdown', (e) => {
      sfx.unlock();
      if (e.target.closest && e.target.closest('.btn, .mapcard, .seg button, .tabs button')) sfx.click();
    }, { passive: true });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (S.pending) return clearPending();
        if (S.modal) { S.modal = null; renderModal(); return; }
        if (S.mode) { S.mode = null; renderGame(); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return;
      if (!S.game || S.replay || !S.info || S.info.status === 'lobby' || !$('#modal').hidden) return;
      const keymap = { r: ['roll'], e: ['endTurn'], t: ['trade'], 1: ['mode', 'road'], 2: ['mode', 'settlement'], 3: ['mode', 'city'], 4: ['buyDev'], m: ['menu'], c: ['openSide'] };
      const hit = keymap[e.key.toLowerCase()];
      if (!hit) return;
      const btn = $(`#tray [data-act="${hit[0]}"]`);
      if (btn && btn.disabled) return;
      e.preventDefault();
      handleAct({ dataset: { act: hit[0], m: hit[1] } }).catch((err) => toast(err.message || String(err), 'bad'));
    });
    window.addEventListener('resize', () => { if (S.info && S.info.status !== 'lobby') updateChat(); });
    window.addEventListener('pagehide', () => { S.unloading = true; });
    window.addEventListener('pageshow', () => { S.unloading = false; });
  }

  // ---- boot --------------------------------------------------------------------------------------

  async function boot() {
    bindEvents();
    initHome();
    try {
      const [maps, info] = await Promise.all([fetch('/api/maps').then((r) => r.json()), fetch('/api/info').then((r) => r.json())]);
      S.maps = maps.maps;
      S.urls = info.urls;
    } catch (e) { /* server not reachable yet */ }
    const hash = (location.hash || '').replace('#', '').toUpperCase();
    const saved = loadSession();
    if (saved && (!hash || hash === saved.code)) {
      if (await tryResume()) return;
    }
    render();
  }

  window.__hexlands = S;
  S.render = render;
  boot();
})();
