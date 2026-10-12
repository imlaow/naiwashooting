import { Application } from 'pixi.js';
import { Island } from './island.js';
import { buildArt } from './art.js';
import { loadSkins, loadLaugh } from './skins.js';
import { buildTerrainTextures } from './world.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { sfx } from './audio.js';
import { laugh } from './laugh.js';
import { t, setLang, applyDom, CJK_TEXT } from './i18n.js';
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

function readBest() {
  try { return Number(localStorage.getItem('naiwa-best') || 0); } catch { return 0; }
}
function writeBest(v) {
  try { localStorage.setItem('naiwa-best', String(v)); } catch { /* storage unavailable */ }
}

async function boot() {
  applyDom();
  show('loading');
  const app = new Application();
  await app.init({
    resizeTo: window,
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

  setLoading(t('loading.island'), 38);
  await nextFrame();
  const seed = Number(new URLSearchParams(location.search).get('seed')) || 20261012;
  const island = new Island(seed);

  setLoading(t('loading.beaches'), 55);
  await nextFrame();
  const gl = app.renderer.gl;
  const maxTex = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 4096;
  const terrainTex = buildTerrainTextures(island, maxTex);

  setLoading(t('loading.ready'), 100);
  await nextFrame();

  const input = new Input(app.canvas);
  let game = null;
  let demo = true;

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
        $('go-score').textContent = score.toLocaleString();
        $('go-wave').textContent = wave;
        $('go-kills').textContent = kills;
        $('go-best').textContent = best.toLocaleString();
        setTimeout(() => show('over'), 900);
      },
    });
  };

  const showBest = () => { $('best-score').textContent = readBest() ? t('title.best', { n: readBest().toLocaleString() }) : ''; };
  newGame(true);
  showBest();
  show('title');
  for (const btn of document.querySelectorAll('[data-lang-btn]')) {
    btn.addEventListener('click', () => { setLang(btn.dataset.langBtn); showBest(); });
  }

  const start = () => {
    sfx.unlock();
    // Fullscreen hides the browser bars on phones (Android; iPhone Safari has no element fullscreen).
    if (input.touch && !document.fullscreenElement) document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
    newGame(false);
    show(null);
  };
  $('play').addEventListener('click', start);
  $('again').addEventListener('click', start);
  $('resume').addEventListener('click', () => { game.paused = false; show(null); });
  $('quit').addEventListener('click', () => { newGame(true); show('title'); });
  $('btn-pause').addEventListener('click', () => game.togglePause());
  $('btn-mute').addEventListener('click', () => game.toggleMute());
  // Pause when the tab or app goes to the background (phone call, app switch, screen lock).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !demo && !game.paused) game.togglePause();
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
