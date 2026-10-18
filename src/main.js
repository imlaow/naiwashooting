import { Application } from 'pixi.js';
import { buildArt } from './art.js';
import { loadSkins, loadLaugh } from './skins.js';
import { buildTerrainTextures } from './view/world.js';
import { Input } from './input.js';
import { Game } from './view/game.js';
import { sfx } from './audio.js';
import { laugh } from './laugh.js';
import { t, setLang, applyDom, CJK_TEXT } from './i18n.js';
import { Dashboard } from './dashboard.js';
import { initMenu } from './menu.js';
import { RANDOM_ID, makeChoice, choiceKey, worldFor, findTheme, readSelected, recordRun } from './maps.js';
import { serverUrl, readRecent, rememberServer, readName, writeName } from './online.js';
import { teamColour } from './skins.js';
import './style.css';

const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function show(id) {
  for (const el of document.querySelectorAll('.panel')) el.classList.toggle('hidden', el.id !== id);
  $('overlay').classList.toggle('hidden', !id);
  document.body.classList.toggle('playing', !id);
  if (id) laugh.pause();
  else laugh.resume();
}

function setLoading(text, pct) {
  $('load-text').textContent = text;
  $('load-bar').style.width = `${pct}%`;
}

// Which map to show first: ?map=theme/id, ?seed=N (a random island with that seed), the map
// played last, or the classic island.
function initialChoice() {
  const q = new URLSearchParams(location.search);
  const seed = Number(q.get('seed'));
  if (seed) return makeChoice('island', RANDOM_ID, seed);
  const m = q.get('map');
  if (m) {
    const [theme, id] = m.includes('/') ? m.split('/') : ['island', m];
    return makeChoice(theme, id);
  }
  return readSelected() ?? makeChoice('island', 'cove');
}

function readBest() {
  try { return Number(localStorage.getItem('naiwa-best') || 0); } catch { return 0; }
}
function writeBest(v) {
  try { localStorage.setItem('naiwa-best', String(v)); } catch { /* storage unavailable */ }
}

// Phones always play in landscape. Android locks the orientation once fullscreen; where that
// isn't possible (iPhone) and the phone is held upright, #app is turned a quarter turn instead.
const isPhone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
function layout() {
  const rotated = isPhone && innerHeight > innerWidth;
  const gw = rotated ? innerHeight : innerWidth, gh = rotated ? innerWidth : innerHeight;
  document.body.classList.toggle('rotated', rotated);
  document.body.classList.toggle('compact', gh < 520);
  const st = document.documentElement.style;
  st.setProperty('--gw', `${gw}px`);
  st.setProperty('--gh', `${gh}px`);
}

function lockLandscape() {
  if (!isPhone) return;
  const lock = () => screen.orientation?.lock?.('landscape').catch(() => {});
  if (document.fullscreenElement || !document.documentElement.requestFullscreen) return lock();
  document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(lock, () => {});
}

async function boot() {
  applyDom();
  initMenu();
  // Runs before Pixi's own resize handler, which waits a frame and then measures #app.
  layout();
  addEventListener('resize', layout);
  show('loading');
  const app = new Application();
  await app.init({
    resizeTo: $('app'),
    background: 0x0e3b52,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    preference: 'webgl',
  });
  $('stage').appendChild(app.canvas);

  setLoading(t('loading.fonts'), 8);
  // HUD text is drawn to canvas, so fetch the CJK glyph subsets before anything renders.
  const fonts = document.fonts ? Promise.all([document.fonts.load('32px "Lilita One"'), document.fonts.load('32px "ZCOOL KuaiLe"', CJK_TEXT)]) : null;
  await Promise.race([fonts, new Promise((r) => setTimeout(r, 2500))]).catch(() => {});
  const skins = await loadSkins();
  // The laugh animation isn't needed until the 5th kill; fetch it in the background.
  skins.laugh = null;
  loadLaugh().then((l) => { skins.laugh = l; }).catch((err) => console.error('laugh frames', err));
  await nextFrame();

  setLoading(t('loading.palms'), 20);
  await nextFrame();
  const art = buildArt();

  const gl = app.renderer.gl;
  const maxTex = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 4096;
  const input = new Input(app.canvas);
  let game = null;
  let demo = true;
  // The map whose terrain is currently painted and uploaded: { key, choice, island, terrainTex }.
  let built = null;

  // Paints and uploads the terrain for a map, behind the loading screen. The height field is
  // cheap and cached by maps.js; the 3200² terrain canvas is the slow part, so it is only
  // rebuilt when the map actually changes, and the previous one is freed first.
  const prepare = async (choice) => {
    if (built && built.key === choiceKey(choice)) return;
    const [buildMsg, paintMsg] = findTheme(choice.theme).loading;
    show('loading');
    setLoading(t(buildMsg), 38);
    await nextFrame();
    const island = worldFor(choice);
    if (game) { game.destroy(); game = null; }
    if (built) for (const tex of Object.values(built.terrainTex)) tex.destroy(true);
    built = null;
    setLoading(t(paintMsg), 55);
    await nextFrame();
    const terrainTex = buildTerrainTextures(island, maxTex);
    const layout = findTheme(choice.theme).layout(island);
    built = { key: choiceKey(choice), choice, island, layout, terrainTex };
    setLoading(t('loading.ready'), 100);
    await nextFrame();
  };

  // Debug only: ?debug&bots=N plays with N - 1 bot teammates, to see co-op without a server.
  const q = new URLSearchParams(location.search);
  const bots = q.has('debug') ? Math.max(1, Math.min(4, Number(q.get('bots')) || 1)) : 1;

  // `net`: an online game drawing that NetSim (see the ONLINE section below).
  const newGame = (isDemo, net = null, hueFilter = null) => {
    if (game) game.destroy();
    demo = isDemo;
    const { island, layout, terrainTex, choice } = built;
    game = new Game({
      app, art, skins, island, layout, terrainTex, input, demo: isDemo, Scene: findTheme(choice.theme).scene, bots: isDemo || net ? 1 : bots, net, hueFilter,
      onPause: (p) => show(p ? 'pause' : null),
      onMenu: () => toggleNetMenu(),
      onMute: (m) => $('btn-mute').classList.toggle('muted', m),
      onGameOver: ({ score, wave, kills, coop }) => {
        // Online, the room's results phase shows the results; records stay as they are.
        if (net) return;
        // Co-op runs don't count for the records.
        const best = coop ? readBest() : Math.max(readBest(), score);
        if (!coop) {
          writeBest(best);
          recordRun(choice, { score, wave, kills });
        }
        $('go-score').textContent = score.toLocaleString();
        $('go-wave').textContent = wave;
        $('go-kills').textContent = kills;
        $('go-best').textContent = best.toLocaleString();
        $('go-map').textContent = t('title.current', { name: dashboard.name(choice) });
        setTimeout(() => show('over'), 900);
      },
    });
  };

  // The title's demo behind the menus, unless it is already running. prepare() may have
  // destroyed it for a map that is still loading; once that map is in, it is rebuilt there.
  const toDemo = () => { if (built && (!demo || !game)) newGame(true); };

  const dashboard = new Dashboard({ root: $('map-themes'), onPlay: (choice) => start(choice) });
  dashboard.select(initialChoice(), { persist: false });
  dashboard.render();

  const showBest = () => { $('best-score').textContent = readBest() ? t('title.best', { n: readBest().toLocaleString() }) : ''; };
  const showCurrent = () => { $('current-map').textContent = t('title.current', { name: dashboard.name() }); };
  const showTitle = () => { toDemo(); showBest(); showCurrent(); show('title'); };
  const showMaps = () => { toDemo(); show('maps'); dashboard.open(); };

  await prepare(dashboard.choice);
  newGame(true);
  showTitle();
  for (const btn of document.querySelectorAll('[data-lang-btn]')) {
    btn.addEventListener('click', () => { setLang(btn.dataset.langBtn); showBest(); showCurrent(); dashboard.render(); });
  }

  let starting = false;
  const start = async (choice = dashboard.choice) => {
    if (starting) return;
    starting = true;
    sfx.unlock();
    lockLandscape();
    dashboard.select(choice);
    showCurrent();
    await prepare(choice);
    newGame(false);
    show(null);
    starting = false;
  };
  $('play').addEventListener('click', () => start());
  $('again').addEventListener('click', () => start());
  $('map-play').addEventListener('click', () => start());
  $('open-maps').addEventListener('click', showMaps);
  $('over-maps').addEventListener('click', showMaps);
  $('map-back').addEventListener('click', showTitle);
  $('resume').addEventListener('click', () => { game.paused = false; show(null); });
  $('quit').addEventListener('click', showTitle);
  $('btn-pause').addEventListener('click', () => game?.togglePause());
  $('btn-mute').addEventListener('click', () => game?.toggleMute());
  // Pause when the tab or app goes to the background (phone call, app switch, screen lock).
  // Online games never pause.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game && !demo && !game.net && !game.paused) game.togglePause();
  });
  const open = (id) => !$(id).classList.contains('hidden');
  addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (open('title') || open('over') || open('maps'))) start();
    else if (e.key === 'Escape' && open('maps')) showTitle();
    else if (e.key === 'Escape' && open('online') && !joining) showTitle();
    // Online: Enter opens the chat line (focused at once, so nothing typed goes to the game).
    else if (e.key === 'Enter' && document.activeElement !== chatInput && session && game?.net && !e.repeat) {
      if (openChat()) e.preventDefault();
    }
  });

  // ---------- ONLINE ----------
  // The panel joins a naiwa-server (net/online.js, loaded with the Colyseus SDK on first use).
  // While connected, every new run of the room (a new map, or the same map started over) gets
  // a fresh online Game behind the loading screen; the room's results phase shows its panel. A
  // dropped connection shows a banner while the SDK reconnects (the game goes on drawing the
  // last state); after RECONNECT_SECONDS it gives up and shows "Connection lost".
  let session = null; // { room, mod, run (the Game's), prepared (the map loaded for), loading, giveUp }
  let joining = false;
  const setStatus = (text, error = false) => {
    $('net-status').textContent = text;
    $('net-status').classList.toggle('error', error);
  };
  const renderRecent = () => {
    const box = $('net-recent');
    box.replaceChildren(...readRecent().map((url) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = url.replace(/^wss?:\/\//, '');
      b.title = url;
      b.addEventListener('click', () => { $('net-address').value = url; setStatus(''); });
      return b;
    }));
  };
  // net/online.js and the Colyseus SDK: fetched when the panel opens, so JOIN doesn't wait.
  let online = null;
  const loadOnline = () => (online ??= import('./net/online.js').catch((err) => { online = null; throw err; }));
  const showOnline = (address) => {
    loadOnline().catch(() => {});
    toDemo();
    if (address != null) $('net-address').value = address;
    $('net-name').value ||= readName();
    renderRecent();
    setStatus('');
    show('online');
  };
  const joinMessage = (err, mod) => {
    if (err.reason === 'version') return t('online.err.version', { server: err.server, client: mod.PROTOCOL });
    if (['full', 'password', 'origin', 'unreachable'].includes(err.reason)) return t(`online.err.${err.reason}`);
    return t('online.err.error', { msg: err.message });
  };

  const join = async () => {
    if (joining) return;
    const target = serverUrl($('net-address').value);
    if (target.error) { setStatus(t(`online.${target.error}`), true); return; }
    const name = $('net-name').value.trim();
    joining = true;
    sfx.unlock();
    // Before any await: the browser only allows fullscreen while the click still counts.
    lockLandscape();
    let mod;
    try {
      setStatus(t('online.loading'));
      mod = await loadOnline();
      // ?debug: the SDK's debug panel (drift telemetry, latency simulator), its own chunk.
      if (q.has('debug')) await mod.loadDebug().catch((err) => console.error('debug panel', err));
      setStatus(t('online.connecting'));
      const room = await mod.join(target.url, { name, password: $('net-password').value });
      writeName(name);
      rememberServer(target.url);
      session = { room, mod, run: -1, prepared: -1, loading: false, giveUp: null };
      document.body.classList.add('online');
      const mine = (fn) => (...a) => { if (session?.room === room) fn(...a); };
      room.onLeave(mine(lost));
      room.onDrop(mine(dropped));
      // Back after the page gave up: too late, leave again.
      room.onReconnect(() => { if (session?.room === room) reconnected(); else room.leave(); });
      room.onStateChange(mine(enterRun));
      room.onMessage('chat', mine(chatLine));
      await enterRun();
    } catch (err) {
      const refused = mod && err instanceof mod.JoinError;
      if (!refused || err.reason === 'error') console.error(err);
      setStatus(refused ? joinMessage(err, mod) : t('online.err.error', { msg: err.message }), true);
    }
    joining = false;
  };

  // A new run in the room: its map behind the loading screen, then 'ready' (the room puts
  // this player into its sim), then an online Game once the player is in the state. Called on
  // every state change, so it moves on as soon as the room does (also after a reconnect into a
  // run that started while this player was away).
  const enterRun = async () => {
    const s = session;
    if (!s || s.loading) return;
    const S = s.room.state;
    if (S.run === s.run) return;
    if (s.prepared !== S.run) {
      const run = S.run;
      s.loading = true;
      try { await prepare(makeChoice(S.map.theme, S.map.id, S.map.seed)); } finally { s.loading = false; }
      if (session !== s) { if (!session) toDemo(); return; }
      s.prepared = run;
      s.room.send('ready', run);
    }
    if (S.run === s.prepared && S.players.has(s.room.sessionId)) {
      s.run = S.run;
      // Keys pressed while the map loaded (nobody read them) don't carry into the new run.
      input.endFrame();
      newGame(false, new s.mod.NetSim(s.room, built.island, built.layout), s.mod.hueFilter);
      show(null);
    }
  };

  const dropped = () => {
    $('net-banner').classList.remove('hidden');
    clearTimeout(session.giveUp);
    session.giveUp = setTimeout(() => {
      const r = session?.room;
      if (!r) return;
      r.reconnection.maxRetries = 0;
      lost();
    }, session.mod.RECONNECT_SECONDS * 1000);
  };
  const reconnected = () => {
    $('net-banner').classList.add('hidden');
    clearTimeout(session.giveUp);
  };
  // Out of the session: the online HUD goes.
  const endSession = () => {
    if (session) clearTimeout(session.giveUp);
    session = null;
    document.body.classList.remove('online');
    $('net-banner').classList.add('hidden');
    $('chat-log').replaceChildren();
    closeChat();
    scoresOpen = false;
    $('scoreboard').classList.add('hidden');
  };
  const leave = () => {
    const s = session;
    endSession();
    s?.room.leave();
    showTitle();
  };
  const lost = () => {
    endSession();
    toDemo();
    show('lost');
  };
  const toggleNetMenu = () => {
    if (!session) return;
    const on = !open('netmenu');
    game.menu = on;
    show(on ? 'netmenu' : session.room.state.phase === 'results' ? 'netover' : null);
  };

  // ---------- Chat ----------
  // Enter (or the touch button) opens a line; one a second, 80 characters (the server cleans
  // and checks it too). The last few lines fade out over the game.
  const chatForm = $('chat-form'), chatInput = $('chat-input'), chatLog = $('chat-log');
  let chatAt = 0;
  const span = (text, color) => {
    const el = document.createElement(color ? 'b' : 'span');
    el.textContent = text;
    if (color) el.style.color = color;
    return el;
  };
  function chatLine(m) {
    const line = document.createElement('div');
    line.className = m.k ? 'chat-line system' : 'chat-line';
    line.append(span(m.n, teamColour(m.c).css), span(m.k ? ` ${t(`chat.${m.k}`)}` : `: ${m.t}`));
    chatLog.append(line);
    while (chatLog.children.length > 6) chatLog.firstChild.remove();
    setTimeout(() => line.classList.add('gone'), 9000);
    setTimeout(() => line.remove(), 10000);
  }
  function openChat() {
    // Not over a menu.
    if (!session || !game?.net || !$('overlay').classList.contains('hidden')) return false;
    chatForm.classList.remove('hidden');
    chatInput.focus();
    return true;
  }
  function closeChat() {
    chatForm.classList.add('hidden');
    chatInput.value = '';
    chatInput.blur();
  }
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (text && session && performance.now() - chatAt >= 1000) {
      chatAt = performance.now();
      session.room.send('chat', text);
    }
    closeChat();
  });
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeChat(); });
  chatInput.addEventListener('blur', () => chatForm.classList.add('hidden'));

  // ---------- Scoreboard ----------
  // While Tab is held (or toggled with the touch button): name, kills, revives, downs, ping. PvP:
  // name, kills, deaths, ping, most kills first.
  let scoresOpen = false, scoresT = 0;
  const renderScores = () => {
    const S = session.room.state, rows = [], pvp = S.mode === 'pvp';
    S.players.forEach((p, sid) => rows.push({ p, me: sid === session.room.sessionId }));
    rows.sort(pvp ? (a, b) => b.p.kills - a.p.kills || a.p.downs - b.p.downs : (a, b) => a.p.colour - b.p.colour);
    $('scoreboard').classList.toggle('pvp', pvp);
    $('score-rows').replaceChildren(...rows.map(({ p, me }) => {
      const tr = document.createElement('tr');
      tr.className = me ? 'me' : p.away ? 'out' : '';
      const ping = p.away ? '—' : p.ping ? `${p.ping}` : '…';
      const cells = pvp ? [p.name, p.kills, p.downs, ping] : [p.name, p.kills, p.revives, p.downs, ping];
      for (const [i, v] of cells.entries()) {
        const td = document.createElement('td');
        td.textContent = String(v);
        if (i === 0) td.style.color = teamColour(p.colour).css;
        tr.append(td);
      }
      return tr;
    }));
  };

  // The results panel follows the room's phase; its countdown is updated every frame.
  const updateOnline = (dt) => {
    const s = session;
    if (!s || s.loading || !game?.net) return;
    const S = s.room.state, results = S.phase === 'results';
    if (results && !open('netover') && !open('netmenu')) {
      // PvP: the winner and your deaths where co-op has the score and the wave.
      const pvp = S.mode === 'pvp', label = (id, key) => { $(id).dataset.i18n = key; $(id).textContent = t(key); };
      label('no-title', pvp ? 'netover.titlePvp' : 'netover.title');
      label('no-score-l', pvp ? 'netover.winner' : 'over.score');
      label('no-wave-l', pvp ? 'netover.deaths' : 'over.wave');
      let winner = null;
      if (pvp) S.players.forEach((p) => { if (p.id === S.winner) winner = p.name; });
      $('no-score').textContent = pvp ? winner ?? (S.winner ? '—' : t('netover.draw')) : S.score.toLocaleString();
      $('no-wave').textContent = pvp ? game.me?.downs ?? 0 : S.wave;
      $('no-kills').textContent = S.kills;
      $('no-mine').textContent = game.me?.kills ?? 0;
      show('netover');
    } else if (!results && open('netover')) show(null);
    if (results) $('no-next').textContent = t('netover.next', { n: Math.ceil(S.phaseT) });
    const scores = (game.scores || scoresOpen) && $('overlay').classList.contains('hidden');
    $('scoreboard').classList.toggle('hidden', !scores);
    if (scores && (scoresT -= dt) <= 0) { scoresT = 0.25; renderScores(); }
  };

  $('open-online').addEventListener('click', () => showOnline());
  $('net-back').addEventListener('click', () => { if (!joining) showTitle(); });
  $('net-form').addEventListener('submit', (e) => { e.preventDefault(); join(); });
  $('net-resume').addEventListener('click', toggleNetMenu);
  $('net-leave').addEventListener('click', leave);
  $('net-leave2').addEventListener('click', leave);
  $('lost-ok').addEventListener('click', showTitle);
  $('btn-scores').addEventListener('click', () => { scoresOpen = !scoresOpen; scoresT = 0; });
  $('btn-chat').addEventListener('click', () => openChat());
  // Closing the page: tell the server (best effort) rather than leave a held seat behind.
  addEventListener('pagehide', () => session?.room.leave());
  // ?server=wss://… opens straight into the panel, so a server owner can share a link.
  if (q.has('server')) showOnline(q.get('server'));

  app.renderer.on('resize', () => game && game.resize());
  if (q.has('debug')) window.__naiwa = { app, get game() { return game; }, get session() { return session; } };
  app.ticker.add((t) => {
    if (game) game.update(t.deltaMS / 1000);
    updateOnline(t.deltaMS / 1000);
  });
}

boot().catch((err) => {
  console.error(err);
  setLoading(t('loading.failed', { msg: err.message }), 100);
});
