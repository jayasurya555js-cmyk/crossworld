(() => {
  'use strict';

  // ---------- Board data ----------
  // Five boards. Every new game uses one of them, never the same one twice in a row.
  // snakes: head -> tail, ladders: bottom -> top
  const BOARDS = [
    { name: 'Classic',
      snakes: { 16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78 },
      ladders: { 1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100 } },
    { name: 'Jungle Run',
      snakes: { 17: 7, 34: 12, 54: 36, 61: 18, 73: 51, 79: 41, 88: 65, 92: 70, 96: 57, 99: 80 },
      ladders: { 3: 22, 5: 26, 11: 32, 20: 58, 27: 46, 40: 59, 52: 71, 63: 83, 76: 97 } },
    { name: 'Viper Pit',
      snakes: { 26: 5, 32: 10, 43: 21, 52: 28, 58: 37, 66: 44, 74: 49, 83: 62, 91: 68, 95: 72, 98: 77 },
      ladders: { 2: 23, 8: 30, 15: 34, 22: 45, 38: 56, 50: 70, 60: 81, 75: 94 } },
    { name: 'Ladder Rush',
      snakes: { 30: 8, 45: 25, 64: 42, 78: 56, 86: 60, 94: 73, 99: 77 },
      ladders: { 4: 25, 7: 29, 13: 33, 17: 38, 23: 44, 35: 55, 46: 67, 53: 74, 62: 84, 72: 92, 80: 100 } },
    { name: 'Long Slides',
      snakes: { 36: 6, 48: 12, 56: 15, 65: 30, 76: 47, 84: 53, 90: 68, 97: 61 },
      ladders: { 9: 40, 14: 35, 21: 57, 28: 49, 42: 79, 51: 72, 63: 86, 71: 93 } },
  ];
  let SNAKES = BOARDS[0].snakes, LADDERS = BOARDS[0].ladders, JUMPS = {};
  let boardIdx = -1;
  function setBoard(i) {
    boardIdx = i;
    SNAKES = BOARDS[i].snakes; LADDERS = BOARDS[i].ladders;
    JUMPS = { ...SNAKES, ...LADDERS };
  }
  function pickBoard() {
    let i;
    do { i = Math.floor(Math.random() * BOARDS.length); } while (i === boardIdx && BOARDS.length > 1);
    return i;
  }
  setBoard(0);
  const COLORS = ['#e63946', '#2a6fdb', '#f4a261', '#6a4c93'];
  const SNAKE_COLORS = [
    { b: '#43b04a', d: '#1c5a2a' }, // green
    { b: '#dc4332', d: '#6e140d' }, // red
    { b: '#f2c230', d: '#84560a' }, // yellow
    { b: '#8d56d9', d: '#3a1a70' }, // purple
  ];
  const PCOLORS = ['#f2c46d', '#6fa8ff', '#ffb15e', '#b99cf0']; // tint of each player's square number in the panel
  const DOTS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const show = (id) => { document.body.dataset.screen = id; ['setup', 'join', 'lobby', 'game'].forEach((s) => ($(s).hidden = s !== id)); };
  const say = (t) => ($('status').textContent = t);
  const setStartLabel = (t) => ($('startBtn').querySelector('span').textContent = t);

  function center(n) {
    const row = Math.floor((n - 1) / 10);
    let col = (n - 1) % 10;
    if (row % 2 === 1) col = 9 - col;
    return { x: col * 10 + 5, y: (9 - row) * 10 + 5 };
  }

  // ---------- State ----------
  let mode = 'cpu';        // 'cpu' | 'friends'
  let count = 2;           // players in a friends game
  let online = true;       // friends: share a link (true) or same device (false)
  let players = [];
  let turn = 0, busy = false, over = false, gid = 0, myIdx = 0;
  const pending = [];      // rolls received from the host, waiting for animations to finish
  let lobby = [];          // [{name, color}] while waiting in a room
  const net = { role: null, peer: null, conn: null, conns: [], max: 2, roomId: null, started: false };

  // ---------- Setup screen ----------
  function renderNames() {
    const box = $('names');
    box.innerHTML = '';
    box.className = 'names' + (mode === 'cpu' ? ' cpu' : '');
    const n = mode === 'cpu' ? 2 : count;                        // every seat is shown, as in the design
    for (let i = 0; i < n; i++) {
      const isCpu = mode === 'cpu' && i === 1;
      const waits = mode === 'friends' && online && i > 0;       // online friends type their own name when they join
      const label = isCpu ? 'Computer(AI)' : i === 0 ? 'Player 1 (you)' : `Player ${i + 1}`;
      const row = document.createElement('label');
      row.className = 'name-row';
      row.innerHTML = `<span class="dot${i === 0 ? '' : ' pale'}"${i === 0 ? ` style="background:${COLORS[0]}"` : ''}></span>
        <input type="text" maxlength="14" aria-label="Player ${i + 1} name">`;
      const input = row.querySelector('input');
      if (isCpu || waits) { input.value = label; input.disabled = true; } else input.placeholder = label;
      box.appendChild(row);
    }
    setStartLabel('Start Game');
  }

  function setActive(selector, el) {
    document.querySelectorAll(selector).forEach((b) => {
      b.classList.toggle('is-active', b === el);
      b.setAttribute('aria-checked', b === el);
    });
  }
  document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode; setActive('.mode', b); $('setup').dataset.mode = mode;
    $('countRow').hidden = $('whereRow').hidden = mode === 'cpu';
    renderNames();
  }));
  document.querySelectorAll('.count').forEach((b) => b.addEventListener('click', () => {
    count = +b.dataset.count; setActive('.count', b); renderNames();
  }));
  document.querySelectorAll('.where').forEach((b) => b.addEventListener('click', () => {
    online = b.dataset.online === 'true'; setActive('.where', b); renderNames();
  }));

  $('startBtn').addEventListener('click', () => {
    const typed = [...document.querySelectorAll('#names .name-row input')].map((i) => (i.disabled ? '' : i.value.trim()));
    if (mode === 'friends' && online) return createRoom(typed[0] || 'Player 1');
    startGame(typed.map((nm, i) => ({
      name: nm || (mode === 'cpu' ? (i === 0 ? 'You' : 'Computer') : `Player ${i + 1}`),
      color: COLORS[i],
      cpu: mode === 'cpu' && i === 1,
    })));
  });

  // ---------- Online rooms (PeerJS / WebRTC) ----------
  const rand = () => Math.random().toString(36).slice(2, 8);
  const clean = (s) => String(s || '').trim().slice(0, 14);
  const broadcast = (msg) => net.conns.forEach((c) => c && c.open && c.send(msg));
  const needPeer = () => {
    if (typeof Peer !== 'undefined') return true;
    alert('Online play could not load. Check your connection, or choose "Same device".');
    return false;
  };

  // STUN finds a direct path between the two phones; TURN relays the game when a
  // direct path is impossible (mobile networks, strict Wi-Fi).
  const ICE = { config: { sdpSemantics: 'unified-plan', iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
    { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
  ] } };

  // Phones suspend the page (and drop its connection to the PeerJS signalling
  // server) when you switch to another app, e.g. to paste the invite link into
  // WhatsApp. This brings the room back online when you return, instead of
  // treating the dropped connection as a fatal error.
  function keepOnline(peer) {
    let tries = 0, timer = null;
    const revive = () => {
      if (net.peer !== peer || peer.destroyed || !peer.disconnected) { tries = 0; return; }
      try { peer.reconnect(); } catch (e) {}
      if (++tries < 15) { clearTimeout(timer); timer = setTimeout(revive, 1500); }
    };
    const wake = () => { if (document.visibilityState === 'visible') revive(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('pageshow', wake);
    window.addEventListener('online', revive);
    peer.on('disconnected', () => setTimeout(revive, 300));
    peer.on('open', () => { tries = 0; });
    peer.on('close', () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('pageshow', wake);
      window.removeEventListener('online', revive);
    });
    return revive;
  }

  function createRoom(hostName, attempt = 0) {
    if (!needPeer()) return;
    $('startBtn').disabled = true;
    setStartLabel('Creating…');
    net.role = 'host'; net.max = count; net.started = false; net.conns = [null];
    lobby = [{ name: clean(hostName), color: COLORS[0] }];
    myIdx = 0;
    const id = 'cwsl-' + rand();
    const peer = (net.peer = new Peer(id, ICE));
    let opened = false;
    const revive = keepOnline(peer);
    peer.on('open', () => {
      if (opened) return; // fired again after a reconnect: the lobby is already showing
      opened = true;
      net.roomId = id;
      // Use the page's full address (location.origin is "null" for local files)
      const url = `${location.href.split('?')[0].split('#')[0]}?room=${id}`;
      $('fileWarn').hidden = location.protocol !== 'file:';
      $('shareLink').value = url;
      $('waBtn').href = 'https://wa.me/?text=' + encodeURIComponent('Play Snakes & Ladders with me: ' + url);
      show('lobby'); renderLobby();
    });
    peer.on('connection', (c) => {
      c.on('data', (m) => hostData(c, m));
      c.on('close', () => hostLeft(c));
    });
    peer.on('error', (err) => {
      if (opened) { revive(); return; } // room already exists: a dropped connection is not fatal
      if (net.peer !== peer) return;
      closeNet();
      if (err && err.type === 'unavailable-id' && attempt < 3) return createRoom(hostName, attempt + 1);
      alert('Could not create a room. Please try again.'); toSetup();
    });
  }

  function hostData(c, m) {
    if (m.t === 'join') {
      if (net.started || lobby.length >= net.max || typeof c.idx === 'number') {
        c.send({ t: 'full' });
        return setTimeout(() => c.close(), 300);
      }
      const idx = lobby.length;
      c.idx = idx; net.conns[idx] = c;
      lobby.push({ name: clean(m.name) || `Player ${idx + 1}`, color: COLORS[idx] });
      broadcastLobby();
      if (lobby.length === net.max) startOnline();
    } else if (m.t === 'rollReq' && net.started && c.idx === turn && !busy && !over) {
      requestRoll();
    }
  }

  function hostLeft(c) {
    if (typeof c.idx !== 'number' || net.role !== 'host') return;
    const i = c.idx;
    if (!net.started) {
      lobby.splice(i, 1); net.conns.splice(i, 1);
      lobby.forEach((p, k) => { p.color = COLORS[k]; if (net.conns[k]) net.conns[k].idx = k; });
      broadcastLobby();
    } else if (!players[i].cpu) {
      players[i].cpu = true; players[i].name += ' (left)'; net.conns[i] = null;
      broadcast({ t: 'takeover', idx: i });
      renderPlayers();
      if (turn === i && !busy && !over) nextTurnUI();
    }
  }

  function broadcastLobby() {
    net.conns.forEach((c, i) => c && c.open && c.send({ t: 'lobby', lobby, max: net.max, you: i }));
    renderLobby();
  }

  function startOnline() {
    net.started = true; net.max = lobby.length;
    const list = lobby.map((p) => ({ name: p.name, color: p.color, cpu: false }));
    const board = pickBoard();
    net.conns.forEach((c, i) => c && c.send({ t: 'start', players: list, you: i, board }));
    myIdx = 0;
    startGame(list, board);
  }

  function renderLobby() {
    const host = net.role === 'host';
    $('lobby').dataset.role = host ? 'host' : 'guest';
    $('lobbyTitle').textContent = `Waiting for players (${lobby.length}/${net.max})`;
    $('hostBox').hidden = !host;
    $('guestWait').hidden = host;
    $('startNowBtn').hidden = !(host && lobby.length >= 2 && lobby.length < net.max);
    const ul = $('slots'); ul.innerHTML = '';
    for (let i = 0; i < net.max; i++) {
      const p = lobby[i];
      const li = document.createElement('li');
      li.className = 'slot' + (p ? ' filled' : ' empty') + (p && i === myIdx ? ' is-me' : '');
      li.innerHTML = `<span class="dot${p ? '' : ' pale'}"${p ? ` style="background:${p.color}"` : ''}></span><span class="pname"></span>`;
      li.querySelector('.pname').textContent = p ? p.name + (i === myIdx ? ' (you)' : ' (joined)') : `Player ${i + 1} (waiting…)`;
      ul.appendChild(li);
    }
  }

  function joinRoom(roomId, name) {
    if (!needPeer()) return;
    $('joinBtn').disabled = true;
    $('joinMsg').textContent = 'Connecting…';
    net.role = 'guest'; net.roomId = roomId; net.started = false;
    let connected = false, inFlight = false, tries = 0, lastErr = '', retryTimer = null;
    const fail = (msg) => {
      clearTimeout(giveUp); clearTimeout(retryTimer);
      closeNet();
      $('joinMsg').textContent = msg; $('joinBtn').disabled = false; show('join');
    };
    // The host may be in another app (e.g. sending the link on WhatsApp) and
    // come back online a few seconds later, so keep trying for 90 seconds.
    const giveUp = setTimeout(() => {
      if (!connected) fail('Could not reach the room' + (lastErr ? ' (' + lastErr + ')' : '') + '. Make sure your friend has the game open, then try again.');
    }, 90000);
    const peer = (net.peer = new Peer(undefined, ICE));
    const revive = keepOnline(peer);
    const retry = () => { inFlight = false; clearTimeout(retryTimer); retryTimer = setTimeout(attempt, 2500); };
    function attempt() {
      if (connected || inFlight || net.peer !== peer || peer.destroyed) return;
      if (peer.disconnected) { revive(); clearTimeout(retryTimer); retryTimer = setTimeout(attempt, 1500); return; }
      inFlight = true;
      $('joinMsg').textContent = tries ? 'Waiting for the host… (' + tries + ')' : 'Connecting…';
      tries++;
      const c = (net.conn = peer.connect(roomId, { reliable: true }));
      let opened = false;
      const stall = setTimeout(() => { if (!opened) { try { c.close(); } catch (e) {} retry(); } }, 10000);
      c.on('open', () => {
        opened = true; connected = true; clearTimeout(stall); clearTimeout(giveUp);
        c.send({ t: 'join', name: clean(name) || 'Player' });
      });
      c.on('data', (m) => guestData(m, fail));
      c.on('error', (e) => { lastErr = (e && e.type) || lastErr; });
      c.on('close', () => {
        clearTimeout(stall);
        if (!opened) { if (net.peer === peer) retry(); return; }
        if (net.role === 'guest' && !over) { alert('The host left the game.'); toSetup(); }
      });
    }
    peer.on('open', attempt);
    peer.on('error', (err) => {
      if (connected) return;
      lastErr = (err && err.type) || lastErr;
      retry();
    });
  }

  function guestData(m, fail) {
    if (m.t === 'lobby') {
      lobby = m.lobby; net.max = m.max; myIdx = m.you;
      show('lobby'); renderLobby();
    } else if (m.t === 'full') {
      fail('This room is full or the game has already started.');
    } else if (m.t === 'start') {
      myIdx = m.you; net.started = true; startGame(m.players, m.board);
    } else if (m.t === 'roll') {
      pending.push(m.n); pump();
    } else if (m.t === 'takeover' && players[m.idx]) {
      players[m.idx].cpu = true; players[m.idx].name += ' (left)'; renderPlayers();
    }
  }

  function closeNet() {
    const { peer, conn } = net;
    net.role = null; net.peer = net.conn = null; net.conns = []; net.started = false; lobby = [];
    try { conn && conn.close(); } catch (e) {}
    try { peer && peer.destroy(); } catch (e) {}
  }

  $('copyBtn').addEventListener('click', async () => {
    const input = $('shareLink');
    try { await navigator.clipboard.writeText(input.value); } catch (e) { input.select(); document.execCommand('copy'); }
    $('copyBtn').textContent = 'Copied!'; $('copyBtn').classList.add('copied');
    setTimeout(() => { $('copyBtn').textContent = 'Copy'; $('copyBtn').classList.remove('copied'); }, 1500);
  });
  $('startNowBtn').addEventListener('click', () => { if (net.role === 'host' && lobby.length >= 2) startOnline(); });
  $('cancelLobby').addEventListener('click', toSetup);
  $('joinBtn').addEventListener('click', () => joinRoom(new URLSearchParams(location.search).get('room'), $('joinName').value));
  $('joinBack').addEventListener('click', toSetup);

  // ---------- Board drawing ----------
  function buildBoard() {
    const cells = $('cells');
    cells.innerHTML = '';
    for (let r = 9; r >= 0; r--) {
      for (let c = 0; c < 10; c++) {
        const n = r * 10 + (r % 2 === 0 ? c + 1 : 10 - c);
        const d = document.createElement('div');
        d.className = 'cell ' + ((r + c) % 2 ? 'b' : 'a') + (n === 100 ? ' goal' : '');
        d.textContent = n === 100 ? 'Home' : n;
        cells.appendChild(d);
      }
    }
    drawArt();
  }

  const NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    parent.appendChild(e);
    return e;
  }
  function drawArt() {
    const svg = $('art');
    svg.innerHTML = '';
    Object.entries(LADDERS).forEach(([from, to]) => drawLadder(svg, center(+from), center(to)));
    Object.entries(SNAKES).forEach(([head, tail], i) => drawSnake(svg, center(+head), center(tail), SNAKE_COLORS[i % SNAKE_COLORS.length]));
  }
  function drawLadder(svg, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len, px = -uy * 1.3, py = ux * 1.3;
    const g = el('g', { opacity: 0.92 }, svg);
    const line = (x1, y1, x2, y2, w) =>
      {
        el('line', { x1, y1, x2, y2, stroke: '#6b2d0c', 'stroke-width': w + 0.8, 'stroke-linecap': 'round' }, g);
        el('line', { x1, y1, x2, y2, stroke: '#ff9a52', 'stroke-width': w, 'stroke-linecap': 'round' }, g);
      }
    for (let d = 3; d < len - 1; d += 3.6) line(a.x + ux * d + px, a.y + uy * d + py, a.x + ux * d - px, a.y + uy * d - py, 0.7);
    line(a.x + px, a.y + py, b.x + px, b.y + py, 1.1);
    line(a.x - px, a.y - py, b.x - px, b.y - py, 1.1);
  }
  // Realistic top-down snake: tapered body, dark back blotches, small head with tongue
  function drawSnake(svg, h, t, col) {
    const dx = t.x - h.x, dy = t.y - h.y, len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len;
    const amp = Math.min(6, len * 0.16), k = Math.max(2, Math.round(len / 18)), W = 3.4, N = 60;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const f = i / N, o = amp * Math.sin(f * Math.PI * k);
      pts.push({ f, x: h.x + dx * f + nx * o, y: h.y + dy * f + ny * o });
    }
    const width = (f) => W * (f < 0.1 ? 0.7 + 3 * f : 1 - 0.88 * ((f - 0.1) / 0.9));
    const L = [], R = [];
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N, i + 1)];
      const tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty) || 1;
      p.tx = tx / tl; p.ty = ty / tl;
      const w = width(p.f) / 2;
      L.push(`${(p.x - p.ty * w).toFixed(2)},${(p.y + p.tx * w).toFixed(2)}`);
      R.push(`${(p.x + p.ty * w).toFixed(2)},${(p.y - p.tx * w).toFixed(2)}`);
    });
    const g = el('g', {}, svg);
    el('polygon', { points: L.concat(R.reverse()).join(' '), fill: col.b, stroke: col.d, 'stroke-width': 0.35, 'stroke-linejoin': 'round' }, g);
    el('polyline', { points: pts.slice(2, 45).map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '), fill: 'none', stroke: 'rgba(255,255,255,.28)', 'stroke-width': 0.55, 'stroke-linecap': 'round' }, g);
    for (let i = 7; i < N - 3; i += 4) {          // dark blotches along the back
      const p = pts[i], w = width(p.f), ang = Math.atan2(p.ty, p.tx) * 180 / Math.PI;
      el('ellipse', { cx: p.x, cy: p.y, rx: w * 0.46, ry: w * 0.28, fill: col.d, opacity: 0.85,
        transform: `rotate(${ang.toFixed(1)} ${p.x.toFixed(2)} ${p.y.toFixed(2)})` }, g);
    }
    // head, facing away from the body
    const p0 = pts[0], ang = Math.atan2(-p0.ty, -p0.tx) * 180 / Math.PI;
    const hg = el('g', { transform: `translate(${(h.x - p0.tx * 1.2).toFixed(2)} ${(h.y - p0.ty * 1.2).toFixed(2)}) rotate(${ang.toFixed(1)})` }, g);
    el('path', { d: 'M2.3 0 L4.1 0 M4.1 0 L4.9 -0.5 M4.1 0 L4.9 0.5', fill: 'none', stroke: '#e0202c', 'stroke-width': 0.3, 'stroke-linecap': 'round' }, hg);
    el('ellipse', { rx: 2.5, ry: 1.7, fill: col.b, stroke: col.d, 'stroke-width': 0.35 }, hg);
    [-1, 1].forEach((s) => {
      el('circle', { cx: 1.0, cy: s * 1.0, r: 0.42, fill: '#111' }, hg);
      el('circle', { cx: 1.1, cy: s * 0.9, r: 0.14, fill: '#fff' }, hg);
    });
  }

  // ---------- Board placement on the illustrated desktop screen ----------
  // The painted board is slightly in perspective. We map the live (square) board onto the same four corners.
  const DESK = matchMedia('(min-aspect-ratio: 5/4)');   // wide screens use the 2234x1056 artwork, others the 704x1520 one
  const QUAD_WIDE = { w: 2234, q: [[364, 168], [1143, 168], [1175, 964], [329, 964]] }; // TL, TR, BR, BL in the artwork
  const QUAD_PHONE = { w: 704, q: [[77, 154], [629, 154], [649, 727], [50, 727]] };
  function layoutBoard() {
    const b = $('board'), g = $('game');
    if (g.hidden || !g.clientWidth) return;
    const art = DESK.matches ? QUAD_WIDE : QUAD_PHONE;
    const s = g.clientWidth / art.w, B = 800;
    const [p0, p1, p2, p3] = art.q.map(([x, y]) => ({ x: x * s, y: y * s }));
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
    const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
    const det = dx1 * dy2 - dx2 * dy1;
    const gg = (dx3 * dy2 - dx2 * dy3) / det, hh = (dx1 * dy3 - dx3 * dy1) / det;
    const a = p1.x - p0.x + gg * p1.x, bb = p3.x - p0.x + hh * p3.x;
    const d = p1.y - p0.y + gg * p1.y, e = p3.y - p0.y + hh * p3.y;
    b.style.transform = `matrix3d(${a / B},${d / B},0,${gg / B},${bb / B},${e / B},0,${hh / B},0,0,1,0,${p0.x},${p0.y},0,1)`;
  }
  new ResizeObserver(layoutBoard).observe($('game'));
  DESK.addEventListener('change', layoutBoard);

  // ---------- Tokens & panel ----------
  function placeToken(i, jump) {
    const p = players[i];
    const c = center(Math.max(p.pos, 1));
    const k = players.filter((q, j) => q.pos === p.pos && j <= i).length - 1;
    const off = [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]][k % 4];
    p.node.classList.toggle('jump', !!jump);
    p.node.style.left = c.x + off[0] + '%';
    p.node.style.top = c.y + off[1] + '%';
  }
  function buildTokens() {
    const box = $('tokens');
    box.innerHTML = '';
    players.forEach((p) => {
      p.node = document.createElement('div');
      p.node.className = 'token';
      p.node.style.background = p.color;
      box.appendChild(p.node);
    });
    players.forEach((_, i) => placeToken(i));
  }
  function renderPlayers() {
    const ul = $('playerList');
    ul.innerHTML = '';
    players.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = i === turn && !over ? 'is-turn' : '';
      li.style.setProperty('--pc', PCOLORS[i % PCOLORS.length]);
      const badge = p.pos === 100 ? ['won', 'WINNER'] : i === turn && !over ? ['ready', 'READY'] : ['waiting', 'WAITING'];
      li.innerHTML = `<span class="dot" style="background:${p.color}"></span>
        <span class="pname"></span><span class="ppos">${p.pos === 0 ? 'Start' : p.pos}</span><span class="badge ${badge[0]}">${badge[1]}</span>`;
      li.querySelector('.pname').textContent = p.name + (p.cpu ? ' 🤖' : '') + (net.role && i === myIdx ? ' (you)' : '');
      ul.appendChild(li);
    });
    players.forEach((p, i) => p.node.classList.toggle('active', i === turn && !over));
  }
  function setDie(n) {
    const die = $('die');
    die.dataset.face = n;
    die.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const s = document.createElement('i');
      if (DOTS[n].includes(i)) s.className = 'on';
      die.appendChild(s);
    }
  }

  // ---------- Game flow ----------
  function startGame(list, board) {
    setBoard(Number.isInteger(board) && BOARDS[board] ? board : pickBoard());
    gid++; turn = 0; busy = false; over = false; pending.length = 0;
    players = list.map((p) => ({ name: p.name, color: p.color, cpu: p.cpu, pos: 0 }));
    $('winModal').hidden = true;
    $('againBtn').hidden = !!net.role; // online rooms: go back to the menu to start a new one
    $('game').dataset.n = Math.min(4, Math.max(2, players.length));
    show('game');
    buildBoard(); buildTokens(); setDie(1);
    layoutBoard();
    requestAnimationFrame(layoutBoard);
    nextTurnUI();
  }

  function nextTurnUI() {
    renderPlayers();
    const p = players[turn], g = gid;
    const btn = $('rollBtn');
    btn.disabled = true;
    if (p.cpu) {
      say(`${p.name} is thinking…`);
      if (net.role !== 'guest') {
        setTimeout(() => { if (g === gid && !over && !busy && players[turn] === p) requestRoll(); }, 900);
      }
    } else if (!net.role || turn === myIdx) {
      btn.disabled = false;
      say(mode === 'friends' && !net.role ? `${p.name}, roll the dice!` : 'Your turn. Roll the dice!');
      btn.focus({ preventScroll: true });
    } else {
      say(`${p.name}'s turn…`);
    }
    pump();
  }

  // Rolls received from the host are played in order, once the current move has finished.
  function pump() {
    if (!busy && !over && pending.length && players.length) performRoll(pending.shift());
  }

  // Called when the dice should be rolled (button click, computer turn, or a guest's request).
  function requestRoll() {
    if (busy || over) return;
    if (net.role === 'guest') {
      net.conn.send({ t: 'rollReq' });
      $('rollBtn').disabled = true;
      return;
    }
    const n = 1 + Math.floor(Math.random() * 6);
    if (net.role === 'host') broadcast({ t: 'roll', n });
    performRoll(n);
  }

  async function performRoll(n) {
    if (busy || over) return;
    busy = true;
    const g = gid;
    $('rollBtn').disabled = true;
    const die = $('die');
    die.classList.add('rolling');
    for (let i = 0; i < 6; i++) { setDie(1 + Math.floor(Math.random() * 6)); await sleep(reduceMotion ? 20 : 70); }
    die.classList.remove('rolling');
    setDie(n);
    await sleep(200);
    if (g !== gid) return;
    await takeMove(n, g);
  }

  async function takeMove(n, g) {
    const p = players[turn], idx = turn;
    const msg = `${p.name} rolled a ${n}.`;
    const wait = async (ms) => { await sleep(ms); return g === gid; };

    if (p.pos + n > 100) {
      say(`${msg} Needs exactly ${100 - p.pos} to finish. Turn passes.`);
      if (!(await wait(1100))) return;
      return endTurn(false);
    }
    for (let s = 0; s < n; s++) {
      p.pos++; placeToken(idx); renderPlayers();
      if (!(await wait(reduceMotion ? 30 : 230))) return;
    }
    if (p.pos === 100) return win(idx);

    if (JUMPS[p.pos]) {
      const up = JUMPS[p.pos] > p.pos;
      say(`${msg} ${up ? '🪜 A ladder! Climbing up' : '🐍 A snake! Sliding down'} to ${JUMPS[p.pos]}.`);
      if (!(await wait(450))) return;
      p.pos = JUMPS[p.pos];
      placeToken(idx, true); renderPlayers();
      if (!(await wait(reduceMotion ? 50 : 900))) return;
      p.node.classList.remove('jump');
      if (p.pos === 100) return win(idx);
    } else {
      say(msg);
    }
    if (n === 6) {
      say(`${msg} A six, so ${p.name} rolls again!`);
      if (!(await wait(900))) return;
      return endTurn(true);
    }
    if (!(await wait(350))) return;
    endTurn(false);
  }

  function endTurn(again) {
    if (!again) turn = (turn + 1) % players.length;
    busy = false;
    nextTurnUI();
  }

  function win(idx) {
    over = true;
    const p = players[idx];
    renderPlayers();
    const youWon = net.role ? idx === myIdx : mode === 'cpu' && !p.cpu;
    const solo = net.role || mode === 'cpu';
    $('winTitle').textContent = solo ? (youWon ? 'You won!' : `${p.name} wins!`) : `${p.name} wins!`;
    $('winText').textContent = youWon ? 'You reached square 100 first. Nicely played.' : `${p.name} reached square 100 first.`;
    $('rollBtn').disabled = true;
    setTimeout(() => ($('winModal').hidden = false), 500);
  }

  // ---------- Navigation ----------
  function toSetup() {
    gid++; over = true; busy = false; pending.length = 0;
    closeNet();
    history.replaceState(null, '', location.pathname);
    $('winModal').hidden = true;
    $('startBtn').disabled = false;
    $('joinBtn').disabled = false;
    $('joinMsg').textContent = '';
    renderNames();
    show('setup');
  }
  $('rollBtn').addEventListener('click', requestRoll);
  $('againBtn').addEventListener('click', () => startGame(players));
  $('menuBtn').addEventListener('click', toSetup);
  $('quitBtn').addEventListener('click', () => { if (confirm('Leave this game?')) toSetup(); });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !$('game').hidden && !$('rollBtn').disabled && document.activeElement === document.body) {
      e.preventDefault(); requestRoll();
    }
  });

  // ---------- Start ----------
  $('setup').dataset.mode = mode;
  renderNames();
  if (new URLSearchParams(location.search).get('room')) show('join');
  else show('setup');
})();
