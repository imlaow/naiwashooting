// Keyboard, mouse and twin-stick touch input.

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
    this.dashTap = false;

    addEventListener('keydown', (e) => {
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
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    });
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return this.touchMove(e);
      if (e.pointerType === 'mouse') this.setTouch(false);
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
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
    if (this.uiTap && this.uiTap(e.clientX, e.clientY)) return;
    const left = e.clientX < innerWidth / 2;
    const stick = { id: e.pointerId, left, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY, t: performance.now() };
    this.sticks.set(e.pointerId, stick);
  }

  touchMove(e) {
    const s = this.sticks.get(e.pointerId);
    if (!s) return;
    s.x = e.clientX; s.y = e.clientY;
  }

  touchEnd(e) {
    const s = this.sticks.get(e.pointerId);
    if (!s) return;
    // A quick tap on the left side triggers a dash.
    if (s.left && performance.now() - s.t < 180 && Math.hypot(s.x - s.ox, s.y - s.oy) < 12) this.dashTap = true;
    this.sticks.delete(e.pointerId);
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
      const dx = s.x - s.ox, dy = s.y - s.oy;
      const d = Math.hypot(dx, dy);
      const R = 60;
      if (s.left) {
        if (d > 6) { mx = dx / Math.max(R, d) ; my = dy / Math.max(R, d); }
      } else if (d > 10) {
        this.aimStick = { x: dx / d, y: dy / d, active: true };
      }
    }
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    this.move.x = mx; this.move.y = my;
    if (mx || my) { this.lastMove.x = mx; this.lastMove.y = my; this.lastMoveT = performance.now(); }
  }

  // Tap-to-dash lifts the move thumb first, so the dash goes the way it was just moving.
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
