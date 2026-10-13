// The map lobby (index.html): overall records up top, one tab per theme, a card per map and a
// detail panel for the selected map that launches play.html.
import { WORLD } from './island.js';
import { THEMES, RANDOM_ID, makeChoice, mapKey, choiceKey, worldFor, thumbnailFor, readStats, readSelected, writeSelected, mapName, playUrl, choiceFromQuery } from './maps.js';
import { t, setLang, applyDom } from './i18n.js';
import './lobby.css';

// Old links went straight into the game with a seed; keep them working.
if (new URLSearchParams(location.search).has('seed')) location.replace(`play.html${location.search}`);

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const CARD = 128, PREVIEW = 320;

const state = {
  choice: choiceFromQuery(location.search) ?? readSelected() ?? makeChoice(THEMES[0].id, THEMES[0].variants[0].id),
  theme: null,
  // The random card keeps the seed it last showed, per theme.
  randomSeeds: {},
};
state.theme = state.choice.theme;
if (state.choice.id === RANDOM_ID) state.randomSeeds[state.choice.theme] = state.choice.seed;

// ---------- Preview painting ----------
// Painted canvases, keyed by exact terrain and size. The height field behind each takes
// ~100 ms, so paints are queued one per frame to keep the page responsive.
const thumbs = new Map();
const queue = [];
let painting = false;

function requestThumb(choice, size, onReady) {
  const key = `${choiceKey(choice)}@${size}`;
  const have = thumbs.get(key);
  if (have) { onReady(have); return; }
  queue.push({ key, choice, size, onReady });
  if (!painting) drain();
}

function drain() {
  painting = true;
  requestAnimationFrame(() => {
    const job = queue.shift();
    if (!job) { painting = false; return; }
    let canvas = thumbs.get(job.key);
    if (!canvas) {
      canvas = thumbnailFor(job.choice, job.size);
      thumbs.set(job.key, canvas);
      if (thumbs.size > 24) thumbs.delete(thumbs.keys().next().value);
    }
    job.onReady(canvas);
    drain();
  });
}

// A preview box: the painted map plus pins for the spawn, village and lookout.
function preview(choice, size, cls) {
  const box = el('div', cls);
  box.dataset.key = choiceKey(choice);
  box.append(el('span', 'wait', t('lobby.loading')));
  requestThumb(choice, size, (canvas) => {
    // A cached paint lands synchronously, before the box is even in the page, so only the
    // key is checked: a box never changes its choice, and painting a detached box is harmless.
    if (box.dataset.key !== choiceKey(choice)) return;
    box.replaceChildren(cloneCanvas(canvas));
    const world = worldFor(choice);
    for (const [kind, p] of [['spawn', world.spawn], ['village', world.village], ['lookout', world.lookout]]) {
      if (!p) continue;
      const pin = el('span', `pin ${kind}`);
      pin.title = t(`lobby.legend.${kind}`);
      pin.style.left = `${(p.x / WORLD) * 100}%`;
      pin.style.top = `${(p.y / WORLD) * 100}%`;
      box.append(pin);
    }
  });
  return box;
}

// The same canvas can't sit in both the card and the detail panel, so each box gets a copy.
function cloneCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

// ---------- Records ----------
function overall() {
  const all = readStats();
  const sum = { runs: 0, kills: 0, best: 0, wave: 0, fav: null };
  let favPlays = 0;
  for (const [key, s] of Object.entries(all)) {
    sum.runs += s.plays; sum.kills += s.kills;
    sum.best = Math.max(sum.best, s.best); sum.wave = Math.max(sum.wave, s.wave);
    if (s.plays > favPlays) { favPlays = s.plays; sum.fav = key; }
  }
  return sum;
}

function nameOfKey(key) {
  const [theme, id] = key.split('/');
  return t(`theme.${theme}.${id}.name`);
}

function recordLine(s) {
  if (!s?.plays) return t('maps.unplayed');
  return [t('maps.best', { n: s.best.toLocaleString() }), t('maps.wave', { n: s.wave }), t('maps.plays', { n: s.plays })].join(' · ');
}

// ---------- Rendering ----------
function renderStats() {
  const o = overall();
  const tiles = [
    ['lobby.runs', o.runs.toLocaleString()],
    ['lobby.kills', o.kills.toLocaleString()],
    ['lobby.best', o.best ? o.best.toLocaleString() : t('lobby.none')],
    ['lobby.wave', o.wave || t('lobby.none')],
    ['lobby.fav', o.fav ? nameOfKey(o.fav) : t('lobby.none')],
  ];
  $('stats').replaceChildren(...tiles.map(([k, v]) => {
    const tile = el('div', 'tile');
    tile.append(el('span', 'k', t(k)), el('b', 'v', String(v)));
    return tile;
  }));
}

function renderTabs() {
  const tabs = $('tabs');
  tabs.replaceChildren(...THEMES.map((theme) => {
    const b = el('button', 'tab');
    b.type = 'button';
    b.role = 'tab';
    b.setAttribute('aria-selected', String(theme.id === state.theme));
    const n = theme.variants.length + (theme.random ? 1 : 0);
    b.append(el('span', 'name', t(`theme.${theme.id}.name`)), el('span', 'n', String(n)));
    b.addEventListener('click', () => { state.theme = theme.id; renderTabs(); renderGrid(); });
    return b;
  }));
}

function themeChoices(theme) {
  const list = theme.variants.map((v) => [makeChoice(theme.id, v.id), v.tags]);
  if (theme.random) {
    const seed = state.randomSeeds[theme.id] || (state.randomSeeds[theme.id] = makeChoice(theme.id, RANDOM_ID, 0).seed);
    list.push([makeChoice(theme.id, RANDOM_ID, seed), ['random']]);
  }
  return list;
}

function renderGrid() {
  const theme = THEMES.find((th) => th.id === state.theme);
  $('theme-desc').textContent = t(`theme.${theme.id}.desc`);
  const stats = readStats();
  $('grid').replaceChildren(...themeChoices(theme).map(([choice, tags]) => {
    const key = mapKey(choice);
    const card = el('button', 'card');
    card.type = 'button';
    card.role = 'listitem';
    card.dataset.map = key;
    card.classList.toggle('on', key === mapKey(state.choice));
    card.append(preview(choice, CARD, 'thumb'));
    card.append(el('b', 'name', t(`theme.${choice.theme}.${choice.id}.name`)));
    const tagRow = el('div', 'tags');
    for (const tg of tags) tagRow.append(el('span', '', t(`tag.${tg}`)));
    card.append(tagRow);
    const rec = el('span', `rec${stats[key]?.plays ? '' : ' none'}`, recordLine(stats[key]));
    card.append(rec);
    card.addEventListener('click', () => select(choice));
    card.addEventListener('dblclick', () => play(choice));
    return card;
  }));
}

function renderDetail() {
  const c = state.choice;
  const d = $('detail');
  d.replaceChildren();
  d.append(preview(c, PREVIEW, 'big'));
  const legend = el('div', 'legend');
  for (const kind of ['spawn', 'village', 'lookout']) {
    const item = el('span');
    item.append(el('i', `pin ${kind}`), document.createTextNode(t(`lobby.legend.${kind}`)));
    legend.append(item);
  }
  d.append(legend);
  d.append(el('h2', '', mapName(c)));
  d.append(el('p', 'desc', t(`theme.${c.theme}.${c.id}.desc`)));
  if (c.id === RANDOM_ID) {
    const row = el('div', 'seed');
    row.append(el('span', '', t('maps.seed', { n: c.seed })));
    const re = el('button', 'reroll', t('maps.reroll'));
    re.type = 'button';
    re.addEventListener('click', () => {
      const next = makeChoice(c.theme, RANDOM_ID, 0);
      state.randomSeeds[c.theme] = next.seed;
      select(next);
      renderGrid();
    });
    row.append(re);
    d.append(row);
  }
  const s = readStats()[mapKey(c)] ?? { best: 0, wave: 0, plays: 0, kills: 0 };
  const recs = el('div', 'records');
  for (const [k, v] of [['best', s.best.toLocaleString()], ['wave', s.wave], ['plays', s.plays], ['kills', s.kills.toLocaleString()]]) {
    const tile = el('div');
    tile.append(el('span', '', t(`lobby.record.${k}`)), el('b', '', String(v)));
    recs.append(tile);
  }
  d.append(recs);
  const go = el('a', 'play', t('lobby.play'));
  go.href = playUrl(c);
  go.addEventListener('click', () => writeSelected(c));
  d.append(go);
}

function select(choice) {
  state.choice = choice;
  writeSelected(choice);
  const key = mapKey(choice);
  for (const card of document.querySelectorAll('.card')) card.classList.toggle('on', card.dataset.map === key);
  renderDetail();
}

function play(choice) {
  writeSelected(choice);
  location.href = playUrl(choice);
}

function renderAll() {
  applyDom();
  document.title = t('lobby.title');
  renderStats();
  renderTabs();
  renderGrid();
  renderDetail();
}

for (const btn of document.querySelectorAll('[data-lang-btn]')) {
  btn.addEventListener('click', () => { setLang(btn.dataset.langBtn); renderAll(); });
}
addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.target.closest('button')) play(state.choice); });
// Records change while the game runs in this same tab; refresh when the player comes back.
addEventListener('pageshow', (e) => { if (e.persisted) { renderStats(); renderGrid(); renderDetail(); } });
renderAll();
