// Tiny WebAudio synth for sound effects and the surf ambience.

class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.last = {};
  }

  unlock() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startSurf();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  // Rate-limit identical sounds so rapid fire doesn't clip.
  gate(name, ms) {
    const now = performance.now();
    if (this.last[name] && now - this.last[name] < ms) return false;
    this.last[name] = now;
    return true;
  }

  noiseBurst({ dur = 0.1, freq = 1000, q = 1, type = 'bandpass', vol = 0.5, sweep = 0, delay = 0 }) {
    const c = this.ctx, t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  tone({ dur = 0.1, f0 = 440, f1 = f0, type = 'square', vol = 0.2, delay = 0 }) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  play(name, vol = 1) {
    if (!this.ctx || this.muted) return;
    const v = Math.min(1, vol);
    if (v < 0.03) return;
    switch (name) {
      case 'pistol':
        this.noiseBurst({ dur: 0.12, freq: 1800, q: 0.8, vol: 0.5 * v, sweep: 0.3 });
        this.tone({ dur: 0.08, f0: 320, f1: 80, vol: 0.2 * v });
        break;
      case 'smg':
        if (!this.gate('smg', 40)) return;
        this.noiseBurst({ dur: 0.07, freq: 2200, q: 0.9, vol: 0.38 * v, sweep: 0.4 });
        this.tone({ dur: 0.05, f0: 260, f1: 90, vol: 0.12 * v });
        break;
      case 'shotgun':
        this.noiseBurst({ dur: 0.35, freq: 900, q: 0.6, vol: 0.75 * v, sweep: 0.2, type: 'lowpass' });
        this.tone({ dur: 0.18, f0: 160, f1: 40, vol: 0.35 * v, type: 'sawtooth' });
        this.noiseBurst({ dur: 0.05, freq: 3000, q: 3, vol: 0.15 * v, delay: 0.35 });
        this.noiseBurst({ dur: 0.05, freq: 2400, q: 3, vol: 0.15 * v, delay: 0.45 });
        break;
      case 'rifle':
        this.noiseBurst({ dur: 0.4, freq: 2600, q: 0.5, vol: 0.6 * v, sweep: 0.15 });
        this.tone({ dur: 0.22, f0: 520, f1: 60, vol: 0.25 * v, type: 'sawtooth' });
        break;
      case 'enemyShot':
        if (!this.gate('enemyShot', 50)) return;
        this.noiseBurst({ dur: 0.1, freq: 1200, q: 1, vol: 0.3 * v, sweep: 0.4 });
        this.tone({ dur: 0.08, f0: 220, f1: 70, vol: 0.1 * v, type: 'triangle' });
        break;
      case 'hit':
        if (!this.gate('hit', 30)) return;
        this.tone({ dur: 0.06, f0: 900, f1: 300, vol: 0.12 * v, type: 'square' });
        break;
      case 'impact':
        if (!this.gate('impact', 35)) return;
        this.noiseBurst({ dur: 0.05, freq: 3500, q: 2, vol: 0.15 * v });
        break;
      case 'wood':
        this.noiseBurst({ dur: 0.08, freq: 600, q: 4, vol: 0.3 * v });
        break;
      case 'crateBreak':
        this.noiseBurst({ dur: 0.3, freq: 500, q: 1.2, vol: 0.5 * v, sweep: 0.5 });
        this.tone({ dur: 0.12, f0: 180, f1: 60, vol: 0.2 * v, type: 'triangle' });
        break;
      case 'die':
        this.tone({ dur: 0.3, f0: 600, f1: 90, vol: 0.2 * v, type: 'triangle' });
        this.noiseBurst({ dur: 0.15, freq: 800, q: 1, vol: 0.2 * v });
        break;
      case 'egg':
        this.tone({ dur: 0.16, f0: 420, f1: 160, vol: 0.22 * v, type: 'sine' });
        this.tone({ dur: 0.12, f0: 700, f1: 300, vol: 0.08 * v, type: 'triangle', delay: 0.05 });
        break;
      case 'explosion':
        this.noiseBurst({ dur: 1.1, freq: 700, q: 0.5, vol: 1 * v, sweep: 0.08, type: 'lowpass' });
        this.tone({ dur: 0.6, f0: 120, f1: 25, vol: 0.6 * v, type: 'sine' });
        break;
      case 'hurt':
        this.tone({ dur: 0.18, f0: 300, f1: 110, vol: 0.3, type: 'sawtooth' });
        this.noiseBurst({ dur: 0.12, freq: 400, q: 1, vol: 0.3 });
        break;
      case 'pickup':
        [523, 659, 784, 1046].forEach((f, i) => this.tone({ dur: 0.09, f0: f, vol: 0.13, type: 'triangle', delay: i * 0.05 }));
        break;
      case 'heal':
        [392, 523, 659].forEach((f, i) => this.tone({ dur: 0.15, f0: f, f1: f * 1.02, vol: 0.14, type: 'sine', delay: i * 0.07 }));
        break;
      case 'reload':
        this.noiseBurst({ dur: 0.04, freq: 2500, q: 5, vol: 0.25 });
        this.noiseBurst({ dur: 0.05, freq: 1800, q: 5, vol: 0.25, delay: 0.18 });
        break;
      case 'empty':
        if (!this.gate('empty', 200)) return;
        this.tone({ dur: 0.03, f0: 1800, f1: 1500, vol: 0.1 });
        break;
      case 'dash':
        this.noiseBurst({ dur: 0.22, freq: 600, q: 1.5, vol: 0.25, sweep: 4 });
        break;
      case 'splash':
        if (!this.gate('splash', 120)) return;
        this.noiseBurst({ dur: 0.25, freq: 1400, q: 0.7, vol: 0.18 * v, sweep: 0.5 });
        break;
      case 'wave':
        [196, 262, 330, 392].forEach((f, i) => this.tone({ dur: 0.35, f0: f, vol: 0.12, type: 'triangle', delay: i * 0.11 }));
        break;
      case 'boss':
        [110, 104, 98, 92].forEach((f, i) => this.tone({ dur: 0.45, f0: f, f1: f * 0.97, vol: 0.25, type: 'sawtooth', delay: i * 0.3 }));
        break;
      case 'gameover':
        [392, 330, 262, 196].forEach((f, i) => this.tone({ dur: 0.4, f0: f, f1: f * 0.98, vol: 0.18, type: 'triangle', delay: i * 0.22 }));
        break;
    }
  }

  // Looping surf: filtered noise swelling slowly.
  startSurf() {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 500;
    const g = c.createGain();
    g.gain.value = 0.05;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.12;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 0.04;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(f).connect(g).connect(this.master);
    src.start(); lfo.start();
  }
}

export const sfx = new Sfx();
