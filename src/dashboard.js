// The map dashboard: one section per theme, a card per map with a painted preview and that
// map's records, and the random card that rerolls its seed.
import { WORLD } from './island.js';
import { THEMES, RANDOM_ID, makeChoice, mapKey, choiceKey, worldFor, thumbnailFor, readStats, writeSelected } from './maps.js';
import { t } from './i18n.js';

const THUMB = 128;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export class Dashboard {
  constructor({ root, onPlay }) {
    this.root = root;
    this.onPlay = onPlay;
    this.choice = null;
    this.cards = new Map(); // mapKey -> { card, thumb, stats, seedLabel }
    this.thumbs = new Map(); // choiceKey -> canvas
    this.queue = [];
    this.painting = false;
  }

  select(choice, { persist = true } = {}) {
    this.choice = choice;
    if (persist) writeSelected(choice);
    for (const [key, c] of this.cards) c.card.classList.toggle('on', key === mapKey(choice));
    const rc = this.cards.get(mapKey(choice));
    if (rc?.seedLabel) rc.seedLabel.textContent = t('maps.seed', { n: choice.seed });
  }

  // Display name of a choice, e.g. "椰林湾" or "随机海岛 #4242".
  name(choice = this.choice) {
    const base = t(`theme.${choice.theme}.${choice.id}.name`);
    return choice.id === RANDOM_ID ? `${base} #${choice.seed}` : base;
  }

  // Builds (or rebuilds, after a language switch) the whole panel. Painted previews are kept.
  render() {
    this.root.replaceChildren();
    this.cards.clear();
    for (const theme of THEMES) {
      const section = el('section', 'theme');
      const head = el('div', 'theme-head');
      head.append(el('h3', '', t(`theme.${theme.id}.name`)), el('small', '', t(`theme.${theme.id}.desc`)));
      const count = theme.variants.length + (theme.random ? 1 : 0);
      head.append(el('span', 'count', `${count}`));
      const grid = el('div', 'map-grid');
      for (const v of theme.variants) grid.append(this.card(makeChoice(theme.id, v.id), v.tags));
      if (theme.random) {
        // Keep the seed the player last rolled; otherwise roll one now.
        const seed = this.choice?.theme === theme.id && this.choice.id === RANDOM_ID ? this.choice.seed : 0;
        grid.append(this.card(makeChoice(theme.id, RANDOM_ID, seed), ['random']));
      }
      section.append(head, grid);
      this.root.append(section);
    }
    if (this.choice) this.select(this.choice, { persist: false });
    this.refreshStats();
  }

  card(choice, tags) {
    const key = mapKey(choice);
    const random = choice.id === RANDOM_ID;
    const card = el('button', `map-card${random ? ' random' : ''}`);
    card.type = 'button';
    card.dataset.map = key;
    const thumb = el('div', 'map-thumb');
    thumb.append(random ? el('span', 'dice', '🎲') : el('span', 'wait', t('maps.loading')));
    const name = el('div', 'map-name', t(`theme.${choice.theme}.${choice.id}.name`));
    const desc = el('div', 'map-desc', t(`theme.${choice.theme}.${choice.id}.desc`));
    const tagRow = el('div', 'map-tags');
    for (const tg of tags) tagRow.append(el('span', '', t(`tag.${tg}`)));
    const stats = el('div', 'map-stats');
    card.append(thumb, name, desc, tagRow, stats);
    const entry = { card, thumb, stats, choice };
    if (random) {
      const seedRow = el('div', 'map-seed');
      entry.seedLabel = el('span', '', t('maps.seed', { n: choice.seed }));
      const reroll = el('button', 'reroll', t('maps.reroll'));
      reroll.type = 'button';
      reroll.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = makeChoice(choice.theme, RANDOM_ID, 0);
        entry.choice = next;
        this.select(next);
        this.paint(entry);
      });
      seedRow.append(entry.seedLabel, reroll);
      card.append(seedRow);
    }
    card.addEventListener('click', () => this.select(entry.choice));
    card.addEventListener('dblclick', () => this.onPlay(entry.choice));
    this.cards.set(key, entry);
    return card;
  }

  refreshStats() {
    const all = readStats();
    for (const [key, c] of this.cards) {
      const s = all[key];
      if (s?.plays) {
        c.stats.className = 'map-stats';
        c.stats.textContent = [t('maps.best', { n: s.best.toLocaleString() }), t('maps.wave', { n: s.wave }), t('maps.plays', { n: s.plays })].join(' · ');
      } else {
        c.stats.className = 'map-stats none';
        c.stats.textContent = t('maps.unplayed');
      }
    }
  }

  // Called when the panel is shown: paints any preview not painted yet, one per frame so the
  // panel stays responsive (each island's height field takes ~100 ms).
  open() {
    this.refreshStats();
    for (const c of this.cards.values()) this.paint(c);
    this.cards.get(mapKey(this.choice))?.card.scrollIntoView({ block: 'nearest' });
  }

  paint(entry) {
    const key = choiceKey(entry.choice);
    const cached = this.thumbs.get(key);
    if (cached) { this.show(entry, cached, entry.choice); return; }
    if (!this.queue.some((q) => q.entry === entry && choiceKey(q.choice) === key)) this.queue.push({ entry, choice: entry.choice });
    if (!this.painting) this.drain();
  }

  drain() {
    this.painting = true;
    requestAnimationFrame(() => {
      const job = this.queue.shift();
      if (!job) { this.painting = false; return; }
      const { entry, choice } = job;
      // The random card may have been rerolled while this job waited.
      if (choiceKey(entry.choice) === choiceKey(choice)) {
        let canvas = this.thumbs.get(choiceKey(choice));
        if (!canvas) {
          canvas = thumbnailFor(choice, THUMB);
          this.thumbs.set(choiceKey(choice), canvas);
          if (this.thumbs.size > 16) this.thumbs.delete(this.thumbs.keys().next().value);
        }
        this.show(entry, canvas, choice);
      }
      this.drain();
    });
  }

  show(entry, canvas, choice) {
    const world = worldFor(choice);
    entry.thumb.replaceChildren(canvas);
    for (const [cls, p] of [['spawn', world.spawn], ['village', world.village], ['lookout', world.lookout]]) {
      if (!p) continue;
      const pin = el('span', `pin ${cls}`);
      pin.style.left = `${(p.x / WORLD) * 100}%`;
      pin.style.top = `${(p.y / WORLD) * 100}%`;
      entry.thumb.append(pin);
    }
  }
}
