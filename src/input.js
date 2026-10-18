// Keyboard, mouse and twin-stick touch input.

// Phones held upright get the game rotated a quarter turn (see main.js), so map screen points into game space.
export function toGame(cx, cy) {
  return document.body.classList.contains('rotated') ? { x: cy, y: innerWidth - cx } : { x: cx, y: cy };
}

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed since last frame
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2, down: false };
    this.wheel = 0;
    // Phones and tablets start in touch mode; any mouse use switches back.
    this.touch = matchMedia('(pointer: coarse)').matches;
    document.body.classList.toggle('touch', this.touch);
    this.uiTap = null; // (x, y) => true when an on-screen control took the touch
    this.move = { x: 0, y: 0 };
    this.lastMove = { x: 0, y: 0 };
    this.lastMoveT = -Infinity;
    this.aimStick = { x: 0, y: 0, active: false };
    this.sticks = new Map(); // pointerId -> stick
    this.stickR = 60;
    this.stickCenters = [{ x: 0, y: 0 }, { x: 0, y: 0 }]; // fixed move / aim stick centres, set by the HUD
    this.dashTap = false;

    addEventListener('keydown', (e) => {
      // Typing in a form field (the ONLINE panel) isn't playing.
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab'].includes(k)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; });

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return this.touchStart(e);
      this.setTouch(false);
      this.mouse.down = true;
      Object.assign(this.mouse, toGame(e.clientX, e.clientY));
    });
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return this.touchMove(e);
      if (e.pointerType === 'mouse') this.setTouch(false);
      Object.assign(this.mouse, toGame(e.clientX, e.clientY));
    });
    addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') return this.touchEnd(e);
      this.mouse.down = false;
    });
    addEventListener('pointercancel', (e) => this.touchEnd(e));
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setTouch(on) {
    if (this.touch === on) return;
    this.touch = on;
    document.body.classList.toggle('touch', on);
  }

  touchStart(e) {
    this.setTouch(true);
    const p = toGame(e.clientX, e.clientY);
    if (this.uiTap && this.uiTap(p.x, p.y)) return;
    // Each half of the screen drives the stick fixed on that side, measured from the stick's centre.
    const c = this.stickCenters;
    const left = p.x < (c[0].x + c[1].x) / 2;
    const stick = { id: e.pointerId, left, ox: p.x, oy: p.y, x: p.x, y: p.y, t: performance.now() };
    this.sticks.set(e.pointerId, stick);
  }

  touchMove(e) {
    const s = this.sticks.get(e.pointerId);
    if (!s) return;
    const p = toGame(e.clientX, e.clientY);
    s.x = p.x; s.y = p.y;
  }

  touchEnd(e) {
    const s = this.sticks.get(e.pointerId);
    if (!s) return;
    // A quick tap on the left side dashes, towards the tap from the stick centre (via recentMove).
    if (s.left && performance.now() - s.t < 180 && Math.hypot(s.x - s.ox, s.y - s.oy) < 12) this.dashTap = true;
    this.sticks.delete(e.pointerId);
  }

  // Thumb offset from the fixed centre of its stick.
  stickVec(s) {
    const c = this.stickCenters[s.left ? 0 : 1];
    return { dx: s.x - c.x, dy: s.y - c.y };
  }

  // Called once per frame before game logic.
  update() {
    let mx = 0, my = 0;
    const k = this.keys;
    if (k.has('a') || k.has('arrowleft')) mx -= 1;
    if (k.has('d') || k.has('arrowright')) mx += 1;
    if (k.has('w') || k.has('arrowup')) my -= 1;
    if (k.has('s') || k.has('arrowdown')) my += 1;
    this.aimStick.active = false;
    for (const s of this.sticks.values()) {
      const { dx, dy } = this.stickVec(s);
      const d = Math.hypot(dx, dy);
      const R = this.stickR;
      if (s.left) {
        if (d > 8) { mx = dx / Math.max(R, d); my = dy / Math.max(R, d); }
      } else if (d > 12) {
        this.aimStick = { x: dx / d, y: dy / d, active: true };
      }
    }
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    this.move.x = mx; this.move.y = my;
    if (mx || my) { this.lastMove.x = mx; this.lastMove.y = my; this.lastMoveT = performance.now(); }
  }

  // Tap-to-dash lifts the thumb before the dash fires, so the dash goes the way it was just moving.
  get recentMove() {
    return performance.now() - this.lastMoveT < 500 ? this.lastMove : null;
  }

  endFrame() {
    this.pressed.clear();
    this.wheel = 0;
    this.dashTap = false;
  }

  wasPressed(key) {
    return this.pressed.has(key);
  }
}
