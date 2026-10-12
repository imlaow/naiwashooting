import { Application } from 'pixi.js';
import { Island } from './island.js';
import { buildArt } from './art.js';
import { loadSkins } from './skins.js';
import { buildTerrainTextures } from './world.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { sfx } from './audio.js';
import './style.css';

const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function show(id) {
  for (const el of document.querySelectorAll('.panel')) el.classList.toggle('hidden', el.id !== id);
  $('overlay').classList.toggle('hidden', !id);
  document.body.classList.toggle('playing', !id);
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

  setLoading('Loading fonts & hero…', 8);
  await Promise.race([document.fonts?.load('32px "Lilita One"'), new Promise((r) => setTimeout(r, 2500))]).catch(() => {});
  const skins = await loadSkins();
  await nextFrame();

  setLoading('Painting palm trees…', 20);
  await nextFrame();
  const art = buildArt();

  setLoading('Raising the island…', 38);
  await nextFrame();
  const seed = Number(new URLSearchParams(location.search).get('seed')) || 20261012;
  const island = new Island(seed);

  setLoading('Painting beaches & lagoons…', 55);
  await nextFrame();
  const gl = app.renderer.gl;
  const maxTex = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 4096;
  const terrainTex = buildTerrainTextures(island, maxTex);

  setLoading('Ready!', 100);
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

  newGame(true);
  $('best-score').textContent = readBest() ? `Best: ${readBest().toLocaleString()}` : '';
  show('title');

  const start = () => { sfx.unlock(); newGame(false); show(null); };
  $('play').addEventListener('click', start);
  $('again').addEventListener('click', start);
  $('resume').addEventListener('click', () => { game.paused = false; show(null); });
  $('quit').addEventListener('click', () => { newGame(true); show('title'); });
  addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (!$('title').classList.contains('hidden') || !$('over').classList.contains('hidden'))) start();
  });

  app.renderer.on('resize', () => game && game.resize());
  if (new URLSearchParams(location.search).has('debug')) window.__naiwa = { app, get game() { return game; } };
  app.ticker.add((t) => game && game.update(t.deltaMS / 1000));
}

boot().catch((err) => {
  console.error(err);
  setLoading(`Failed to start: ${err.message}`, 100);
});
