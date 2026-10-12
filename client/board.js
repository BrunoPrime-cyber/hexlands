/* Hexlands board renderer: SVG, original art, theme-able via CSS classes, pan + pinch zoom,
   hover info, ghost previews, spotlight, and a staged "boot" animation. */
(function (global) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const SERIF = "'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua','URW Palladio L',Georgia,'Noto Serif',serif";

  const TERRAIN_FILL = { forest: '#2f7142', hills: '#c0592f', pasture: '#9bc761', fields: '#e6b83a', mountains: '#7a8593', desert: '#e3ce96' };
  const TERRAIN_EDGE = { forest: '#1b4527', hills: '#8d3d1d', pasture: '#6c9a3a', fields: '#b18a1c', mountains: '#4f5966', desert: '#bda46a' };
  const RES_FILL = { timber: '#2f7142', clay: '#c0592f', wool: '#9bc761', grain: '#e6b83a', ore: '#7a8593' };
  const RES_LABEL = { timber: 'Timber', clay: 'Clay', wool: 'Wool', grain: 'Grain', ore: 'Ore' };
  const TERRAIN_NAME = { forest: 'Forest', hills: 'Hills', pasture: 'Pasture', fields: 'Fields', mountains: 'Mountains', desert: 'Desert' };
  const TERRAIN_RES = { forest: 'timber', hills: 'clay', pasture: 'wool', fields: 'grain', mountains: 'ore' };
  const RES_TERRAIN = { timber: 'forest', clay: 'hills', wool: 'pasture', grain: 'fields', ore: 'mountains' };

  // Icons are drawn in a roughly 1x0.9 box centred on (0,0).
  const ICONS = {
    forest:
      '<g stroke="#12351f" stroke-width=".03" stroke-linejoin="round">' +
      '<rect x="-.2" y=".1" width=".05" height=".1" fill="#5b3a1e" stroke="none"/><polygon points="-.22,.12 -.34,.12 -.22,-.12 -.1,.12" fill="#1d5733"/><polygon points="-.22,-.02 -.31,.07 -.13,.07" fill="#2c7a47" stroke="none"/>' +
      '<rect x=".03" y=".12" width=".06" height=".12" fill="#5b3a1e" stroke="none"/><polygon points=".06,.14 -.1,.14 .06,-.2 .22,.14" fill="#236a3e"/><polygon points=".06,-.04 -.05,.08 .17,.08" fill="#35905a" stroke="none"/>' +
      '<rect x=".27" y=".1" width=".05" height=".1" fill="#5b3a1e" stroke="none"/><polygon points=".3,.12 .18,.12 .3,-.1 .42,.12" fill="#1d5733"/></g>',
    hills:
      '<g stroke="#4f1f10" stroke-width=".03" stroke-linejoin="round" fill="#a8442a">' +
      '<rect x="-.3" y=".02" width=".28" height=".14" rx=".02"/><rect x="0" y=".02" width=".28" height=".14" rx=".02"/>' +
      '<rect x="-.15" y="-.14" width=".28" height=".14" rx=".02"/><rect x=".13" y="-.14" width=".2" height=".14" rx=".02" fill="#bd5a3b"/>' +
      '<path d="M-.26 .06 H-.08 M.04 .06 H.22 M-.11 -.1 H.07" stroke="#d78a68" stroke-width=".02" fill="none"/></g>',
    pasture:
      '<g stroke="#2d4a19" stroke-width=".025" stroke-linejoin="round">' +
      '<ellipse cx="-.14" cy=".02" rx=".17" ry=".11" fill="#fbf8ec"/><ellipse cx="-.3" cy="-.01" rx=".07" ry=".06" fill="#3a352e"/>' +
      '<rect x="-.24" y=".1" width=".03" height=".08" fill="#3a352e" stroke="none"/><rect x="-.1" y=".1" width=".03" height=".08" fill="#3a352e" stroke="none"/>' +
      '<ellipse cx=".22" cy="-.06" rx=".13" ry=".09" fill="#fbf8ec"/><ellipse cx=".34" cy="-.08" rx=".05" ry=".045" fill="#3a352e"/>' +
      '<rect x=".17" y=".01" width=".025" height=".07" fill="#3a352e" stroke="none"/><rect x=".27" y=".01" width=".025" height=".07" fill="#3a352e" stroke="none"/></g>',
    fields:
      '<g stroke="#7c5406" stroke-width=".035" stroke-linecap="round" fill="#cf9610">' +
      '<path d="M-.3 .16 V-.12 M-.15 .16 V-.2 M0 .16 V-.24 M.15 .16 V-.2 M.3 .16 V-.12" fill="none"/>' +
      '<ellipse cx="-.3" cy="-.14" rx=".04" ry=".08"/><ellipse cx="-.15" cy="-.22" rx=".04" ry=".08"/><ellipse cx="0" cy="-.26" rx=".04" ry=".08"/>' +
      '<ellipse cx=".15" cy="-.22" rx=".04" ry=".08"/><ellipse cx=".3" cy="-.14" rx=".04" ry=".08"/></g>',
    mountains:
      '<g stroke="#343d4a" stroke-width=".03" stroke-linejoin="round">' +
      '<polygon points="-.38,.16 -.12,-.26 .14,.16" fill="#566170"/><polygon points="-.12,-.26 -.2,-.1 -.12,-.14 -.04,-.1" fill="#f6f8fa" stroke="none"/>' +
      '<polygon points=".0,.16 .22,-.14 .42,.16" fill="#6c7888"/><polygon points=".22,-.14 .15,-.04 .22,-.07 .29,-.04" fill="#f6f8fa" stroke="none"/></g>',
    desert:
      '<g fill="none" stroke="#b5903f" stroke-width=".04" stroke-linecap="round">' +
      '<path d="M-.36 .14 Q-.2 -.02 -.02 .14 T .34 .14"/><path d="M-.3 .02 Q-.15 -.1 0 .02 T .3 .02" opacity=".6"/>' +
      '<g stroke="#3b7a36" stroke-width=".05"><path d="M.18 -.06 V-.26 M.18 -.14 H.1 V-.2 M.18 -.18 H.26 V-.24"/></g></g>',
  };

  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };

  const corner = (cx, cy, s, i) => {
    const a = ((60 * i + 30) * Math.PI) / 180;
    return [cx + s * Math.cos(a), cy + s * Math.sin(a)];
  };
  const hexPoints = (cx, cy, s) => {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const [x, y] = corner(cx, cy, s, i);
      pts.push(x.toFixed(3) + ',' + y.toFixed(3));
    }
    return pts.join(' ');
  };
  const hexPath = (cx, cy, s, from, to) => {
    const pts = [];
    for (let i = from; i <= to; i++) {
      const [x, y] = corner(cx, cy, s, i % 6);
      pts.push((i === from ? 'M' : 'L') + x.toFixed(3) + ' ' + y.toFixed(3));
    }
    return pts.join(' ');
  };

  const pipsOf = (n) => (n ? 6 - Math.abs(7 - n) : 0);

  // mix a #rrggbb colour toward black (f < 0) or white (f > 0)
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255;
    let g = (n >> 8) & 255;
    let b = n & 255;
    const t = f < 0 ? 0 : 255;
    const p = Math.abs(f);
    r = Math.round(r + (t - r) * p);
    g = Math.round(g + (t - g) * p);
    b = Math.round(b + (t - b) * p);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  // Small inline SVG (as an HTML string) for a resource / terrain icon.
  function iconSvg(terrainOrRes, px) {
    const terrain = ICONS[terrainOrRes] ? terrainOrRes : RES_TERRAIN[terrainOrRes];
    const s = px || 28;
    return `<svg class="ico" width="${s}" height="${s}" viewBox="-.5 -.4 1 .8" aria-hidden="true">${ICONS[terrain] || ''}</svg>`;
  }

  // Shared defs: sea gradient, waves, terrain hatching. Colours are overridden per theme in CSS.
  function addDefs(svg) {
    const defs = el('defs', null, svg);
    const grad = el('radialGradient', { id: 'seaGrad', cx: '50%', cy: '48%', r: '78%' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#2b8497' }, grad);
    el('stop', { offset: '100%', 'stop-color': '#0d3d50' }, grad);
    const waves = el('pattern', { id: 'waves', width: 1.6, height: 0.9, patternUnits: 'userSpaceOnUse' }, defs);
    el('path', { d: 'M0 .22 q.2 -.16 .4 0 t.4 0 t.4 0 t.4 0', fill: 'none', stroke: '#bfe6e4', 'stroke-opacity': 0.2, 'stroke-width': 0.035, 'stroke-linecap': 'round' }, waves);
    el('path', { d: 'M-.8 .67 q.2 -.16 .4 0 t.4 0 t.4 0 t.4 0 t.4 0 t.4 0', fill: 'none', stroke: '#bfe6e4', 'stroke-opacity': 0.14, 'stroke-width': 0.035, 'stroke-linecap': 'round' }, waves);
    const fields = el('pattern', { id: 'pat-fields', width: 0.2, height: 0.2, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(-18)' }, defs);
    el('line', { x1: 0, y1: 0, x2: 0, y2: 0.2, stroke: '#a67a12', 'stroke-opacity': 0.3, 'stroke-width': 0.035 }, fields);
    const dots = el('pattern', { id: 'pat-dots', width: 0.17, height: 0.17, patternUnits: 'userSpaceOnUse' }, defs);
    el('circle', { cx: 0.05, cy: 0.05, r: 0.016, fill: '#7a5a1c', 'fill-opacity': 0.28 }, dots);
    const grass = el('pattern', { id: 'pat-pasture', width: 0.22, height: 0.22, patternUnits: 'userSpaceOnUse' }, defs);
    el('path', { d: 'M.04 .12 l.02 -.06 M.12 .18 l.02 -.06', stroke: '#4d7f22', 'stroke-opacity': 0.32, 'stroke-width': 0.025, 'stroke-linecap': 'round' }, grass);
    const rock = el('pattern', { id: 'pat-mountains', width: 0.26, height: 0.26, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(35)' }, defs);
    el('line', { x1: 0, y1: 0, x2: 0, y2: 0.26, stroke: '#2f3946', 'stroke-opacity': 0.18, 'stroke-width': 0.03 }, rock);
    return defs;
  }

  function drawHex(g, h) {
    // soft shadow under the tile, dark rim, painted face, hatch, bevel highlights
    el('polygon', { class: 'hx-shadow', points: hexPoints(h.x + 0.03, h.y + 0.07, 1.0), fill: '#000', opacity: 0.28 }, g);
    el('polygon', { class: 'hx-rim', points: hexPoints(h.x, h.y, 1.0), fill: TERRAIN_EDGE[h.terrain] }, g);
    el('polygon', { class: 'hx-face', points: hexPoints(h.x, h.y, 0.93), fill: TERRAIN_FILL[h.terrain] }, g);
    const pat = { fields: 'pat-fields', pasture: 'pat-pasture', mountains: 'pat-mountains', desert: 'pat-dots' }[h.terrain];
    if (pat) el('polygon', { class: 'hx-pat', points: hexPoints(h.x, h.y, 0.93), fill: `url(#${pat})` }, g);
    el('path', { class: 'hx-hi', d: hexPath(h.x, h.y, 0.9, 2, 4), fill: 'none', stroke: '#fff', 'stroke-opacity': 0.32, 'stroke-width': 0.05, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
    el('path', { class: 'hx-lo', d: hexPath(h.x, h.y, 0.9, 5, 7), fill: 'none', stroke: '#000', 'stroke-opacity': 0.2, 'stroke-width': 0.05, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
  }

  function drawToken(g, h) {
    const tk = el('g', { class: 'token', transform: `translate(${h.x},${h.y + 0.2})` }, g);
    el('circle', { class: 'tk-shadow', r: 0.34, fill: '#3b2a18', opacity: 0.35, cy: 0.035 }, tk);
    el('circle', { class: 'tk-coin', r: 0.33, fill: '#f8efd4', stroke: '#7a5a2a', 'stroke-width': 0.045 }, tk);
    el('circle', { class: 'tk-ring', r: 0.265, fill: 'none', stroke: '#b99a60', 'stroke-width': 0.015 }, tk);
    const red = h.number === 6 || h.number === 8;
    const tx = el('text', { class: 'tk-num' + (red ? ' red' : ''), y: 0.075, 'text-anchor': 'middle', 'font-size': 0.36, 'font-weight': 800, fill: red ? '#b3261a' : '#2a1f17', 'font-family': SERIF }, tk);
    tx.textContent = h.number;
    const p = pipsOf(h.number);
    for (let i = 0; i < p; i++) el('circle', { class: 'tk-pip' + (red ? ' red' : ''), cx: (i - (p - 1) / 2) * 0.072, cy: 0.215, r: 0.024, fill: red ? '#b3261a' : '#3b2f24' }, tk);
    return tk;
  }

  // One building shape, used for placed pieces and for ghost previews.
  function drawPieceShape(g, type, fill) {
    const roof = shade(fill, -0.38);
    el('ellipse', { class: 'pc-shadow', cx: 0.02, cy: 0.16, rx: type === 'city' ? 0.3 : 0.22, ry: 0.06, fill: '#000', opacity: 0.38 }, g);
    if (type === 'city') {
      el('path', { class: 'pc-body', d: 'M-.26 .15 V-.01 H-.07 V-.2 H.17 V-.01 H.26 V.15 Z', fill, stroke: '#1d140c', 'stroke-width': 0.045, 'stroke-linejoin': 'round' }, g);
      el('path', { class: 'pc-roof', d: 'M-.1 -.2 L.05 -.34 L.2 -.2 Z', fill: roof, stroke: '#1d140c', 'stroke-width': 0.04, 'stroke-linejoin': 'round' }, g);
      el('path', { class: 'pc-roof', d: 'M-.28 -.01 L-.165 -.12 L-.05 -.01 Z', fill: roof, stroke: '#1d140c', 'stroke-width': 0.04, 'stroke-linejoin': 'round' }, g);
      el('rect', { class: 'pc-win', x: 0.0, y: -0.14, width: 0.07, height: 0.08, fill: '#fff3c9', opacity: 0.9 }, g);
      el('rect', { class: 'pc-win', x: -0.2, y: 0.04, width: 0.07, height: 0.07, fill: '#fff3c9', opacity: 0.85 }, g);
      el('path', { d: 'M-.07 -.17 V.1', stroke: '#fff', 'stroke-opacity': 0.25, 'stroke-width': 0.03 }, g);
    } else {
      el('path', { class: 'pc-body', d: 'M-.18 .15 V-.03 H.18 V.15 Z', fill, stroke: '#1d140c', 'stroke-width': 0.045, 'stroke-linejoin': 'round' }, g);
      el('path', { class: 'pc-roof', d: 'M-.23 -.02 L0 -.24 L.23 -.02 Z', fill: roof, stroke: '#1d140c', 'stroke-width': 0.045, 'stroke-linejoin': 'round' }, g);
      el('rect', { class: 'pc-win', x: -0.035, y: 0.05, width: 0.07, height: 0.1, fill: '#2a1f17', opacity: 0.85 }, g);
      el('path', { d: 'M-.18 -.0 H.18', stroke: '#fff', 'stroke-opacity': 0.22, 'stroke-width': 0.03 }, g);
    }
  }

  class BoardView {
    // handlers: { hexHover(id, clientX, clientY), hexLeave(), hexTap(id, clientX, clientY) }
    constructor(svg, onPick, handlers) {
      this.svg = svg;
      this.onPick = onPick;
      this.h = handlers || {};
      this.board = null;
      this.base = null;
      this.vb = null;
      this.moved = false;
      this.pointers = new Map();
      this.seen = { b: new Set(), r: new Set(), robber: null };
      this.primed = false;
      this.focus = null;
      this.myColor = '#ffffff';
      this.pendingGhost = null;
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      this._bind();
    }

    setBoard(board) {
      this.board = board;
      const svg = this.svg;
      svg.innerHTML = '';
      this.seen = { b: new Set(), r: new Set(), robber: null };
      this.primed = false;
      this.pendingGhost = null;
      addDefs(svg);
      const b = board.bounds;
      const pad = 1.45;
      this.base = { x: b.minX - pad, y: b.minY - pad, w: b.maxX - b.minX + 2 * pad, h: b.maxY - b.minY + 2 * pad };
      this.vb = Object.assign({}, this.base);
      const big = { x: this.base.x - 40, y: this.base.y - 40, width: this.base.w + 80, height: this.base.h + 80 };
      el('rect', Object.assign({ class: 'sea', fill: 'url(#seaGrad)' }, big), svg);
      el('rect', Object.assign({ class: 'sea-waves', fill: 'url(#waves)' }, big), svg);
      this.gHex = el('g', null, svg);
      this.gPort = el('g', null, svg);
      this.gRoad = el('g', null, svg);
      this.gBuild = el('g', null, svg);
      this.gRobber = el('g', null, svg);
      this.gFx = el('g', { class: 'fx-layer', 'pointer-events': 'none' }, svg);
      this.gHint = el('g', null, svg);
      this.gGhost = el('g', { class: 'ghost-layer', 'pointer-events': 'none' }, svg);
      this._drawStatic();
      this._makeRobber();
      this._applyVb();
      this._boot();
    }

    // Tiles assemble from the centre outwards when a board first appears.
    _boot() {
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) return;
      const b = this.board;
      const cx = (b.bounds.minX + b.bounds.maxX) / 2;
      const cy = (b.bounds.minY + b.bounds.maxY) / 2;
      const order = b.hexes.map((h) => ({ id: h.id, d: Math.hypot(h.x - cx, h.y - cy) })).sort((a, c) => a.d - c.d);
      order.forEach((o, i) => {
        const node = this.hexNodes.get(o.id);
        if (node) node.style.setProperty('--i', String(i));
      });
      this.gHex.classList.add('boot');
      this.gPort.classList.add('boot-port');
      clearTimeout(this._bootTimer);
      this._bootTimer = setTimeout(() => {
        this.gHex.classList.remove('boot');
        this.gPort.classList.remove('boot-port');
      }, 1900);
    }

    _drawStatic() {
      const board = this.board;
      this.tokens = new Map();
      this.hexNodes = new Map();
      for (const h of board.hexes) {
        const g = el('g', { class: 'hex', 'data-hex': h.id }, this.gHex);
        this.hexNodes.set(h.id, g);
        drawHex(g, h);
        const icon = el('g', { class: 'hx-icon', transform: `translate(${h.x},${h.y - 0.34}) scale(0.95)`, opacity: '.96' }, g);
        icon.innerHTML = ICONS[h.terrain];
        if (h.number) {
          const tk = drawToken(g, h);
          this.tokens.set(h.id, tk);
          tk.addEventListener('pointerenter', () => this.highlightNumber(h.number));
          tk.addEventListener('pointerleave', () => this.highlightNumber(null));
        }
        g.addEventListener('pointerenter', (ev) => this.h.hexHover && !this.moved && this.h.hexHover(h.id, ev.clientX, ev.clientY));
        g.addEventListener('pointermove', (ev) => this.h.hexHover && !this.moved && this.h.hexHover(h.id, ev.clientX, ev.clientY));
        g.addEventListener('pointerleave', () => this.h.hexLeave && this.h.hexLeave());
        g.addEventListener('click', (ev) => {
          if (!this.moved && this.h.hexTap) this.h.hexTap(h.id, ev.clientX, ev.clientY);
        });
      }
      board.ports.forEach((p) => {
        const a = board.vertices[p.a];
        const bb = board.vertices[p.b];
        const mx = p.x + p.nx * 0.8;
        const my = p.y + p.ny * 0.8;
        const special = p.type !== 'any';
        const g = el('g', { class: 'port', style: `--rc:${special ? shade(RES_FILL[p.type], 0.1) : '#3de1ff'}` }, this.gPort);
        for (const v of [a, bb]) {
          el('line', { class: 'pt-dock-a', x1: v.x, y1: v.y, x2: mx, y2: my, stroke: '#2b1a0e', 'stroke-width': 0.12, 'stroke-linecap': 'round', opacity: 0.8 }, g);
          el('line', { class: 'pt-dock-b', x1: v.x, y1: v.y, x2: mx, y2: my, stroke: '#a77a47', 'stroke-width': 0.07, 'stroke-linecap': 'round' }, g);
          el('line', { class: 'pt-dock-c', x1: v.x, y1: v.y, x2: mx, y2: my, stroke: '#d6aa72', 'stroke-width': 0.02, 'stroke-linecap': 'round', opacity: 0.8 }, g);
        }
        el('circle', { class: 'pt-shadow', cx: mx, cy: my + 0.04, r: 0.38, fill: '#000', opacity: 0.3 }, g);
        el('circle', { class: 'pt-coin', cx: mx, cy: my, r: 0.38, fill: special ? shade(RES_FILL[p.type], 0.12) : '#f4ecd2', stroke: '#6b4a1f', 'stroke-width': 0.055 }, g);
        el('circle', { class: 'pt-ring', cx: mx, cy: my, r: 0.3, fill: 'none', stroke: '#6b4a1f', 'stroke-opacity': 0.4, 'stroke-width': 0.016 }, g);
        const label = el('text', { class: 'pt-label', x: mx, y: my + (special ? 0.22 : 0.095), 'text-anchor': 'middle', 'font-size': 0.26, 'font-weight': 800, fill: '#2a1f17', 'font-family': SERIF }, g);
        label.textContent = special ? '2:1' : '3:1';
        if (special) {
          const ic = el('g', { transform: `translate(${mx},${my - 0.06}) scale(.42)` }, g);
          ic.innerHTML = ICONS[RES_TERRAIN[p.type]];
        }
        const title = el('title', null, g);
        title.textContent = special ? `${RES_LABEL[p.type]} harbour (2:1)` : 'Harbour (3:1 any resource)';
      });
    }

    _makeRobber() {
      const wrap = el('g', { class: 'robber-wrap' }, this.gRobber);
      this.robberEl = wrap;
      const rg = el('g', { class: 'robber', transform: 'translate(-0.42 0.1) scale(1.18)' }, wrap);
      el('ellipse', { cx: 0, cy: 0.17, rx: 0.19, ry: 0.055, fill: '#000', opacity: 0.4 }, rg);
      el('path', { class: 'rb-body', d: 'M-.15 .16 Q-.16 -.08 0 -.14 Q.16 -.08 .15 .16 Z', fill: '#2b2a33', stroke: '#0c0b10', 'stroke-width': 0.035 }, rg);
      el('path', { d: 'M-.09 .1 Q-.1 -.05 -.02 -.1', fill: 'none', stroke: '#6a6878', 'stroke-width': 0.03, 'stroke-linecap': 'round' }, rg);
      el('circle', { class: 'rb-head', cx: 0, cy: -0.21, r: 0.095, fill: '#2b2a33', stroke: '#0c0b10', 'stroke-width': 0.035 }, rg);
      el('circle', { class: 'rb-eye', cx: 0, cy: -0.21, r: 0.032, fill: '#ff4d5e' }, rg);
    }

    // game: server view. show: { vertices:[], vertexKind, edges:[], hexes:[] }
    update(game, show) {
      if (!this.board) return;
      const board = this.board;
      const color = (i) => game.players[i].color;
      this.myColor = game.youIndex >= 0 && game.players[game.youIndex] ? color(game.youIndex) : '#ffffff';
      const animate = this.primed;
      this.gRoad.innerHTML = '';
      this.gBuild.innerHTML = '';
      this.gHint.innerHTML = '';

      for (const [eid, pi] of Object.entries(game.roads)) {
        const e = board.edges[Number(eid)];
        const a = board.vertices[e.a];
        const b = board.vertices[e.b];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        const k = 0.1 / len;
        const x1 = a.x + dx * k;
        const y1 = a.y + dy * k;
        const x2 = b.x - dx * k;
        const y2 = b.y - dy * k;
        const fresh = animate && !this.seen.r.has(eid);
        this.seen.r.add(eid);
        const g = el('g', { class: fresh ? 'road new' : 'road', 'data-p': pi, style: `--pc:${color(pi)}` }, this.gRoad);
        el('line', { class: 'rd-glow', x1, y1, x2, y2, stroke: color(pi), 'stroke-width': 0.36, 'stroke-linecap': 'round', opacity: 0.3 }, g);
        el('line', { class: 'rd-shadow', x1, y1: y1 + 0.03, x2, y2: y2 + 0.03, stroke: '#000', 'stroke-width': 0.2, 'stroke-linecap': 'round', opacity: 0.3 }, g);
        el('line', { class: 'rd-out', x1, y1, x2, y2, stroke: '#1d140c', 'stroke-width': 0.23, 'stroke-linecap': 'round' }, g);
        el('line', { class: 'rd-body', x1, y1, x2, y2, stroke: color(pi), 'stroke-width': 0.15, 'stroke-linecap': 'round' }, g);
        el('line', { class: 'rd-hi', x1, y1: y1 - 0.025, x2, y2: y2 - 0.025, stroke: '#fff', 'stroke-opacity': 0.32, 'stroke-width': 0.035, 'stroke-linecap': 'round' }, g);
        if (fresh) {
          g.style.setProperty('--len', String(len));
          this.ring((a.x + b.x) / 2, (a.y + b.y) / 2, color(pi), 0.22);
        }
        if (this.focus !== null && pi !== this.focus) g.classList.add('dim');
      }

      for (const [vid, b] of Object.entries(game.buildings)) {
        const v = board.vertices[Number(vid)];
        const key = vid + ':' + b.t;
        const fresh = animate && !this.seen.b.has(key);
        this.seen.b.add(key);
        const outer = el('g', { class: 'bldg', 'data-p': b.p, transform: `translate(${v.x},${v.y}) scale(1.18)`, style: `--pc:${color(b.p)}` }, this.gBuild);
        if (this.focus !== null && b.p !== this.focus) outer.classList.add('dim');
        el('circle', { class: 'pc-glow', cx: 0, cy: 0, r: b.t === 'city' ? 0.42 : 0.34, fill: color(b.p), opacity: 0.24 }, outer);
        const g = el('g', { class: fresh ? 'piece new' : 'piece' }, outer);
        drawPieceShape(g, b.t, color(b.p));
        if (fresh) this.ring(v.x, v.y, color(b.p), 0.3);
      }

      // the robber glides between hexes
      const rh = board.hexes[game.robber];
      if (this.seen.robber === null || !animate) this.robberEl.classList.add('still');
      else this.robberEl.classList.remove('still');
      this.robberEl.style.transform = `translate(${rh.x}px, ${rh.y}px)`;
      if (animate && this.seen.robber !== null && this.seen.robber !== game.robber) setTimeout(() => this.ring(rh.x, rh.y, '#ff4d5e', 0.5), 450);
      this.seen.robber = game.robber;

      // lit-up number tokens for the last roll
      const sum = game.turn.dice ? game.turn.dice[0] + game.turn.dice[1] : null;
      for (const [hid, tk] of this.tokens) {
        const hot = sum && board.hexes[hid].number === sum && game.turn.step !== 'roll' && game.phase === 'main';
        const was = tk.getAttribute('class') === 'token hot';
        tk.setAttribute('class', hot ? 'token hot' : 'token');
        if (hot && !was && animate) {
          const h = board.hexes[hid];
          this.ring(h.x, h.y + 0.2, '#ffb02e', 0.34);
        }
      }
      this.primed = true;

      if (!show) return;
      const onPick = this.onPick;
      const guard = (kind, id) => (ev) => {
        if (this.moved) return;
        ev.stopPropagation();
        onPick(kind, id);
      };
      for (const hid of show.hexes || []) {
        const h = board.hexes[hid];
        const p = el('polygon', { points: hexPoints(h.x, h.y, 0.93), class: 'hint hint-hex' }, this.gHint);
        p.addEventListener('click', guard('hex', hid));
      }
      for (const eid of show.edges || []) {
        const e = board.edges[eid];
        const a = board.vertices[e.a];
        const b = board.vertices[e.b];
        el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'hint hint-edge' }, this.gHint);
        const hit = el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'hit' }, this.gHint);
        hit.addEventListener('click', guard('edge', eid));
        hit.addEventListener('pointerenter', (ev) => {
          if (ev.pointerType !== 'mouse') return;
          this.showGhost('edge', eid);
          if (this.h.spotHover) this.h.spotHover();
        });
        hit.addEventListener('pointerleave', () => this.clearGhost(true));
      }
      for (const vid of show.vertices || []) {
        const v = board.vertices[vid];
        el('circle', { cx: v.x, cy: v.y, r: show.vertexKind === 'city' ? 0.29 : 0.23, class: 'hint hint-vertex' }, this.gHint);
        const hit = el('circle', { cx: v.x, cy: v.y, r: 0.34, class: 'hit' }, this.gHint);
        hit.addEventListener('click', guard('vertex', vid));
        hit.addEventListener('pointerenter', (ev) => {
          if (ev.pointerType !== 'mouse') return;
          this.showGhost('vertex', vid, show.vertexKind);
          if (this.h.spotHover) this.h.spotHover();
        });
        hit.addEventListener('pointerleave', () => this.clearGhost(true));
      }
      // keep a pinned (confirm-step) ghost alive across re-renders
      if (this.pendingGhost) this.showGhost(this.pendingGhost.kind, this.pendingGhost.id, this.pendingGhost.vk, true);
    }

    // A hexagonal shockwave that expands and fades (CSS animates it; hidden in themes that do not want it).
    ring(x, y, color, r) {
      if (!this.gFx) return;
      const p = el('polygon', { class: 'fx-ring', points: hexPoints(x, y, r || 0.3), style: `--pc:${color}` }, this.gFx);
      p.addEventListener('animationend', () => p.remove());
      setTimeout(() => p.remove(), 1400);
    }

    // Semi-transparent preview of what a click would place.
    showGhost(kind, id, vk, pin) {
      if (!this.board) return;
      if (pin) this.pendingGhost = { kind, id, vk };
      this.gGhost.innerHTML = '';
      const board = this.board;
      if (kind === 'edge') {
        const e = board.edges[id];
        const a = board.vertices[e.a];
        const b = board.vertices[e.b];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const k = 0.1 / Math.hypot(dx, dy);
        const g = el('g', { class: 'ghost', style: `--pc:${this.myColor}` }, this.gGhost);
        el('line', { x1: a.x + dx * k, y1: a.y + dy * k, x2: b.x - dx * k, y2: b.y - dy * k, stroke: '#1d140c', 'stroke-width': 0.23, 'stroke-linecap': 'round' }, g);
        el('line', { x1: a.x + dx * k, y1: a.y + dy * k, x2: b.x - dx * k, y2: b.y - dy * k, stroke: this.myColor, 'stroke-width': 0.15, 'stroke-linecap': 'round' }, g);
      } else if (kind === 'vertex') {
        const v = board.vertices[id];
        const outer = el('g', { class: 'ghost', transform: `translate(${v.x},${v.y}) scale(1.18)`, style: `--pc:${this.myColor}` }, this.gGhost);
        drawPieceShape(outer, vk === 'city' ? 'city' : 'settlement', this.myColor);
      } else if (kind === 'hex') {
        const h = board.hexes[id];
        el('polygon', { class: 'ghost ghost-hex', points: hexPoints(h.x, h.y, 0.93) }, this.gGhost);
      }
    }

    clearGhost(keepPinned) {
      if (keepPinned && this.pendingGhost) {
        this.showGhost(this.pendingGhost.kind, this.pendingGhost.id, this.pendingGhost.vk, true);
        return;
      }
      this.pendingGhost = null;
      this.gGhost.innerHTML = '';
    }

    // Hovering a number token lights every hex that shares it.
    highlightNumber(n) {
      for (const h of this.board.hexes) {
        const node = this.hexNodes.get(h.id);
        if (node) node.classList.toggle('same', n !== null && h.number === n);
      }
    }

    // Spotlight one player's pieces (null = show everyone).
    setFocus(pi) {
      this.focus = pi;
      if (!this.board) return;
      for (const n of this.gRoad.children) n.classList.toggle('dim', pi !== null && Number(n.dataset.p) !== pi);
      for (const n of this.gBuild.children) n.classList.toggle('dim', pi !== null && Number(n.dataset.p) !== pi);
    }

    // Client (screen) position of a point in board units, for effects layered above the board.
    screenPoint(x, y) {
      const pt = this.svg.createSVGPoint();
      pt.x = x;
      pt.y = y;
      const m = this.svg.getScreenCTM();
      if (!m) return null;
      const r = pt.matrixTransform(m);
      return { x: r.x, y: r.y };
    }

    hexScreenPos(hexId) {
      const h = this.board.hexes[hexId];
      return this.screenPoint(h.x, h.y);
    }

    vertexScreenPos(id) {
      const v = this.board.vertices[id];
      return this.screenPoint(v.x, v.y);
    }

    edgeScreenPos(id) {
      const e = this.board.edges[id];
      const a = this.board.vertices[e.a];
      const c = this.board.vertices[e.b];
      return this.screenPoint((a.x + c.x) / 2, (a.y + c.y) / 2);
    }

    // A huge ring that sweeps across the whole board (used on every roll).
    shock(color) {
      if (!this.board || !this.gFx) return;
      const b = this.board.bounds;
      const p = el('polygon', { class: 'fx-ring big', points: hexPoints((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 0.5), style: `--pc:${color}` }, this.gFx);
      p.addEventListener('animationend', () => p.remove());
      setTimeout(() => p.remove(), 1600);
    }

    // ---- view / pan / zoom ---------------------------------------------------
    _applyVb() {
      const v = this.vb;
      this.svg.setAttribute('viewBox', `${v.x.toFixed(3)} ${v.y.toFixed(3)} ${v.w.toFixed(3)} ${v.h.toFixed(3)}`);
    }

    reset() {
      if (!this.base) return;
      this.vb = Object.assign({}, this.base);
      this._applyVb();
    }

    zoomBy(factor, cx, cy) {
      if (!this.vb) return;
      const v = this.vb;
      const nw = Math.min(this.base.w * 1.3, Math.max(this.base.w / 4, v.w / factor));
      const f = nw / v.w;
      const nh = v.h * f;
      const px = cx === undefined ? v.x + v.w / 2 : cx;
      const py = cy === undefined ? v.y + v.h / 2 : cy;
      this.vb = { x: px - (px - v.x) * f, y: py - (py - v.y) * f, w: nw, h: nh };
      this._applyVb();
    }

    _clientToSvg(clientX, clientY) {
      const r = this.svg.getBoundingClientRect();
      const v = this.vb;
      const scale = Math.min(r.width / v.w, r.height / v.h);
      const ox = (r.width - v.w * scale) / 2;
      const oy = (r.height - v.h * scale) / 2;
      return { x: v.x + (clientX - r.left - ox) / scale, y: v.y + (clientY - r.top - oy) / scale, scale };
    }

    _bind() {
      const svg = this.svg;
      svg.style.touchAction = 'none';
      svg.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        const p = this._clientToSvg(ev.clientX, ev.clientY);
        this.zoomBy(ev.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y);
      }, { passive: false });

      svg.addEventListener('pointerdown', (ev) => {
        this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY });
        this.moved = false;
        this._pinch = null;
      });
      const move = (ev) => {
        const p = this.pointers.get(ev.pointerId);
        if (!p) return;
        // a mouse that is no longer pressed cannot be dragging (guards against a lost pointerup)
        if (ev.pointerType === 'mouse' && ev.buttons === 0) {
          this.pointers.delete(ev.pointerId);
          this._pinch = null;
          return;
        }
        const dx = ev.clientX - p.x;
        const dy = ev.clientY - p.y;
        if (this.pointers.size === 1) {
          if (!this.moved && Math.hypot(ev.clientX - p.sx, ev.clientY - p.sy) > 6) {
            this.moved = true;
            if (this.h.hexLeave) this.h.hexLeave();
          }
          if (this.moved) {
            const s = this._clientToSvg(0, 0).scale;
            this.vb.x -= dx / s;
            this.vb.y -= dy / s;
            this._applyVb();
          }
          p.x = ev.clientX;
          p.y = ev.clientY;
        } else if (this.pointers.size === 2) {
          p.x = ev.clientX;
          p.y = ev.clientY;
          const [a, b] = [...this.pointers.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (this._pinch) {
            const mid = this._clientToSvg((a.x + b.x) / 2, (a.y + b.y) / 2);
            this.zoomBy(dist / this._pinch, mid.x, mid.y);
          }
          this._pinch = dist;
          this.moved = true;
        }
      };
      const up = (ev) => {
        this.pointers.delete(ev.pointerId);
        if (this.pointers.size < 2) this._pinch = null;
        if (!this.pointers.size) setTimeout(() => (this.moved = false), 0);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    }
  }

  // A small decorative island for the home screen: a seven-hex flower with tokens.
  function heroIsland(svg) {
    svg.innerHTML = '';
    addDefs(svg);
    const layout = [
      [0, 0, 'fields', 8],
      [1, 0, 'forest', 5],
      [-1, 0, 'hills', 9],
      [0, -1, 'pasture', 6],
      [1, -1, 'mountains', 4],
      [-1, 1, 'forest', 10],
      [0, 1, 'hills', 11],
    ];
    const SQ3 = Math.sqrt(3);
    const g = el('g', null, svg);
    for (const [q, r, terrain, number] of layout) {
      const x = SQ3 * (q + r / 2);
      const y = 1.5 * r;
      const hg = el('g', { class: 'hex' }, g);
      drawHex(hg, { x, y, terrain });
      const icon = el('g', { class: 'hx-icon', transform: `translate(${x},${y - 0.34}) scale(0.95)` }, hg);
      icon.innerHTML = ICONS[terrain];
      drawToken(hg, { x, y, number });
    }
    svg.setAttribute('viewBox', '-2.8 -2.68 5.6 5.45');
  }

  global.HexBoard = { BoardView, iconSvg, heroIsland, shade, RES_FILL, RES_LABEL, TERRAIN_FILL, TERRAIN_NAME, TERRAIN_RES, pipsOf, hexPoints };
})(window);
