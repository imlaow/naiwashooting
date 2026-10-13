import { Application } from 'pixi.js';
import { buildArt } from './art.js';
import { loadSkins, loadLaugh } from './skins.js';
import { buildTerrainTextures } from './world.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { sfx } from './audio.js';
import { laugh } from './laugh.js';
import { t, setLang, applyDom, CJK_TEXT } from './i18n.js';
import { makeChoice, worldFor, readSelected, writeSelected, recordRun, mapName, choiceFromQuery } from './maps.js';
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

// Which map to play: the lobby's ?map=theme/id (&seed=N) or legacy ?seed=N, else the map
// played last, else the classic island.
function initialChoice() {
  return choiceFromQuery(location.search) ?? readSelected() ?? makeChoice('island', 'cove');
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
  // Runs before Pixi's own resize handler, which waits a frame and then measures #app.
  layout();
  addEventListener('resize', layout);
  show('loading');
  const app = new Application();
  await app.init({
    resizeTo: $('app'),
    background: 0xfff0cf,
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
  const art = buildArt(skins.images);

  const gl = app.renderer.gl;
  const maxTex = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 4096;
  const input = new Input(app.canvas);
  let game = null;
  let demo = true;

  // The map is chosen on the lobby page (index.html) and handed over in the URL.
  const choice = initialChoice();
  writeSelected(choice);
  setLoading(t('loading.island'), 38);
  await nextFrame();
  const island = worldFor(choice);

  setLoading(t('loading.beaches'), 55);
  await nextFrame();
  const terrainTex = buildTerrainTextures(island, maxTex, skins.images);

  setLoading(t('loading.ready'), 100);
  await nextFrame();

  const newGame = (isDemo) => {
    if (game) game.destroy();
    demo = isDemo;
    game = new Game({
      app, art, skins, island, terrainTex, input, demo: isDemo,
      onPause: (p) => show(p ? 'pause' : null),
      onMute: (m) => $('btn-mute').classList.toggle('muted', m),
      onGameOver: ({ score, wave, kills }) => {
        const best = Math.max(readBest(), score);
        writeBest(best);
        recordRun(choice, { score, wave, kills });
        $('go-score').textContent = score.toLocaleString();
        $('go-wave').textContent = wave;
        $('go-kills').textContent = kills;
        $('go-best').textContent = best.toLocaleString();
        $('go-map').textContent = t('title.current', { name: mapName(choice) });
        setTimeout(() => show('over'), 900);
      },
    });
  };

  const toLobby = () => { location.href = './'; };

  const showBest = () => { $('best-score').textContent = readBest() ? t('title.best', { n: readBest().toLocaleString() }) : ''; };
  const showCurrent = () => { $('current-map').textContent = t('title.current', { name: mapName(choice) }); };
  const showTitle = () => { if (!demo) newGame(true); showBest(); showCurrent(); show('title'); };

  newGame(true);
  showTitle();
  for (const btn of document.querySelectorAll('[data-lang-btn]')) {
    btn.addEventListener('click', () => { setLang(btn.dataset.langBtn); showBest(); showCurrent(); });
  }

  const start = () => {
    sfx.unlock();
    lockLandscape();
    newGame(false);
    show(null);
  };
  $('play').addEventListener('click', start);
  $('again').addEventListener('click', start);
  $('open-maps').addEventListener('click', toLobby);
  $('over-maps').addEventListener('click', toLobby);
  $('resume').addEventListener('click', () => { game.paused = false; show(null); });
  $('quit').addEventListener('click', showTitle);
  $('btn-pause').addEventListener('click', () => game?.togglePause());
  $('btn-mute').addEventListener('click', () => game?.toggleMute());
  // Pause when the tab or app goes to the background (phone call, app switch, screen lock).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game && !demo && !game.paused) game.togglePause();
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (!$('title').classList.contains('hidden') || !$('over').classList.contains('hidden'))) start();
  });

  app.renderer.on('resize', () => game && game.resize());
  if (new URLSearchParams(location.search).has('debug')) window.__naiwa = { app, get game() { return game; } };
  app.ticker.add((t) => game && game.update(t.deltaMS / 1000));
}

boot().catch((err) => {
  console.error(err);
  setLoading(t('loading.failed', { msg: err.message }), 100);
});
