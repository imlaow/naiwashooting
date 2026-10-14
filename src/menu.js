// Menu antics: egg buttons whose pupils follow the pointer, and poking Naiwa on the title
// screen. All of it is decoration; the menus work without it.
const HERO_FRAMES = ['assets/hero_1.png', 'assets/hero_2.png', 'assets/hero_3.png', 'assets/hero_0.png'];

export function initMenu() {
  const eggs = [...document.querySelectorAll('button.egg')];
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    for (const egg of eggs) {
      const r = egg.getBoundingClientRect();
      if (!r.width) continue;
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + 18);
      const k = Math.min(4, Math.hypot(dx, dy) / 30) / (Math.hypot(dx, dy) || 1);
      egg.style.setProperty('--ex', `${(dx * k).toFixed(1)}px`);
      egg.style.setProperty('--ey', `${(dy * k).toFixed(1)}px`);
    }
  });

  // Each poke shows the next frame (two of them laugh) and squashes him.
  const hero = document.querySelector('#title .hero');
  let frame = 0;
  hero?.addEventListener('click', () => {
    frame = (frame + 1) % HERO_FRAMES.length;
    hero.src = HERO_FRAMES[frame];
    hero.classList.remove('poked');
    void hero.offsetWidth;
    hero.classList.add('poked');
  });
  hero?.addEventListener('animationend', (e) => { if (e.animationName === 'poked') hero.classList.remove('poked'); });
}
