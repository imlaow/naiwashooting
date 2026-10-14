// Menu antics: poking Naiwa on the title screen. It is decoration; the menus work without it.
const HERO_FRAMES = ['assets/hero_1.png', 'assets/hero_2.png', 'assets/hero_3.png', 'assets/hero_0.png'];

export function initMenu() {
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
