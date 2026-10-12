// UI strings. Chinese is the default; the title screen can switch to English.
const STRINGS = {
  zh: {
    'doc.title': '奶蛙枪战',
    'loading.title': '奶蛙枪战',
    'loading.start': '启动中…',
    'loading.fonts': '加载字体和奶蛙…',
    'loading.palms': '绘制椰子树…',
    'loading.island': '生成小岛…',
    'loading.beaches': '绘制沙滩和泻湖…',
    'loading.ready': '准备就绪！',
    'loading.failed': '启动失败：{msg}',
    'title.name': '奶蛙枪战',
    'title.sub': '海岛大作战',
    'title.heroAlt': '主角奶蛙',
    'title.tag': '敌对奶蛙入侵了你的热带小岛。拿起武器，守卫海滩！',
    'title.play': '开始游戏',
    'title.best': '最高分：{n}',
    'ctl.move': '移动',
    'ctl.aim': '瞄准射击',
    'ctl.mouse': '鼠标',
    'ctl.dash': '冲刺',
    'ctl.space': '空格',
    'ctl.reload': '换弹',
    'ctl.weapons': '/ 滚轮 切换武器',
    'ctl.pause': '暂停',
    'ctl.mute': '静音',
    'title.touch': '触屏：左手拇指移动（轻点冲刺），右手拇指瞄准射击。点击右下角武器栏切换武器，点击弹药数换弹。',
    'pause.title': '已暂停',
    'pause.resume': '继续',
    'pause.quit': '返回主菜单',
    'over.title': '奶蛙阵亡',
    'over.score': '得分',
    'over.wave': '波次',
    'over.kills': '击杀',
    'over.best': '最高分',
    'over.again': '再来一局',
    'hud.boss': '奶蛙大王',
    'hud.hint': 'WASD 移动  ·  鼠标 瞄准射击  ·  空格 冲刺  ·  R 换弹  ·  1-4 / 滚轮 切换  ·  P 暂停  ·  M 静音',
    'hud.reloading': '换弹中',
    'hud.touchMove': '拖动移动 · 轻点冲刺',
    'hud.touchAim': '拖动瞄准射击',
    'hud.pause': '暂停',
    'hud.mute': '静音',
    'hud.wave': '第 {n} 波',
    'hud.getReady': '准备战斗',
    'hud.nextWave': '{n} 秒后下一波',
    'hud.starting': '{n} 秒后开始',
    'hud.left': '剩余敌人 {n}',
    'hud.combo': '{n} 连击  x{m}',
    'game.intro': '奶蛙枪战',
    'game.introSub': '击退敌对奶蛙的入侵！',
    'game.ammo': '弹药',
    'game.weaponAmmo': '{w}弹药',
    'game.pickedUp': '获得{w}  —  按 {n} 切换',
    'game.pickedUpTouch': '获得{w}  —  点击武器栏切换',
    'game.bossWave': '奶蛙大王来袭！',
    'game.firstWave': '敌人正在登陆海滩',
    'game.incoming': '{n} 个敌人来袭',
    'game.cleared': '本波已清空',
    'game.bonus': '奖励 +{n}',
    'game.laugh': '哈哈哈！',
    'game.laughToast': '奶蛙笑得停不下来  —  无敌隐身，笑完回满血！',
    'game.bossDown': '奶蛙大王被击败',
    'game.fell': '你倒下了',
    'game.soundOff': '声音关闭',
    'game.soundOn': '声音开启',
    'weapon.pistol': '手枪',
    'weapon.smg': '冲锋枪',
    'weapon.shotgun': '霰弹枪',
    'weapon.rifle': '狙击枪',
  },
  en: {
    'doc.title': 'Naiwa Shootout',
    'loading.title': 'Naiwa Shootout',
    'loading.start': 'Starting…',
    'loading.fonts': 'Loading fonts & hero…',
    'loading.palms': 'Painting palm trees…',
    'loading.island': 'Raising the island…',
    'loading.beaches': 'Painting beaches & lagoons…',
    'loading.ready': 'Ready!',
    'loading.failed': 'Failed to start: {msg}',
    'title.name': 'NAIWA',
    'title.sub': 'Island Showdown',
    'title.heroAlt': 'Naiwa, the hero',
    'title.tag': 'Rival Naiwas have invaded your tropical island. Grab a weapon and defend the beach!',
    'title.play': 'PLAY',
    'title.best': 'Best: {n}',
    'ctl.move': 'move',
    'ctl.aim': 'aim & shoot',
    'ctl.mouse': 'Mouse',
    'ctl.dash': 'dash',
    'ctl.space': 'Space',
    'ctl.reload': 'reload',
    'ctl.weapons': '/ wheel weapons',
    'ctl.pause': 'pause',
    'ctl.mute': 'mute',
    'title.touch': 'Touch: left thumb moves (tap to dash), right thumb aims & fires. Tap a weapon slot to switch, tap the ammo count to reload.',
    'pause.title': 'Paused',
    'pause.resume': 'RESUME',
    'pause.quit': 'QUIT TO TITLE',
    'over.title': 'Washed Ashore',
    'over.score': 'Score',
    'over.wave': 'Wave',
    'over.kills': 'Kills',
    'over.best': 'Best',
    'over.again': 'PLAY AGAIN',
    'hud.boss': 'KING NAIWA',
    'hud.hint': 'WASD move  ·  Mouse aim & shoot  ·  Space dash  ·  R reload  ·  1-4 / wheel switch  ·  P pause  ·  M mute',
    'hud.reloading': 'RELOADING',
    'hud.touchMove': 'Drag to move · tap to dash',
    'hud.touchAim': 'Drag to aim & fire',
    'hud.pause': 'Pause',
    'hud.mute': 'Mute',
    'hud.wave': 'WAVE {n}',
    'hud.getReady': 'GET READY',
    'hud.nextWave': 'Next wave in {n}',
    'hud.starting': 'Starting in {n}',
    'hud.left': '{n} hostiles left',
    'hud.combo': '{n} combo  x{m}',
    'game.intro': 'NAIWA SHOOTOUT',
    'game.introSub': 'Survive the rival invasion!',
    'game.ammo': 'AMMO',
    'game.weaponAmmo': '{w} AMMO',
    'game.pickedUp': 'Picked up {w}  —  press {n}',
    'game.pickedUpTouch': 'Picked up {w}  —  tap its slot',
    'game.bossWave': 'KING NAIWA approaches!',
    'game.firstWave': 'Rivals are landing on the beaches',
    'game.incoming': '{n} hostiles incoming',
    'game.cleared': 'WAVE CLEARED',
    'game.bonus': '+{n} bonus',
    'game.laugh': 'HA HA HA!',
    'game.laughToast': 'Naiwa is laughing his head off  —  invincible, unseen, full heal after!',
    'game.bossDown': 'KING NAIWA DEFEATED',
    'game.fell': 'YOU FELL',
    'game.soundOff': 'Sound off',
    'game.soundOn': 'Sound on',
    'weapon.pistol': 'Pistol',
    'weapon.smg': 'SMG',
    'weapon.shotgun': 'Shotgun',
    'weapon.rifle': 'Rifle',
  },
};

export const LANGS = { zh: '中文', en: 'EN' };

function readLang() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    const v = q || localStorage.getItem('naiwa-lang');
    return v in STRINGS ? v : 'zh';
  } catch { return 'zh'; }
}

export let lang = readLang();

export function setLang(v) {
  if (!(v in STRINGS)) return;
  lang = v;
  try { localStorage.setItem('naiwa-lang', v); } catch { /* storage unavailable */ }
  applyDom();
}

export function t(key, params) {
  let s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? '');
  return s;
}

// Every CJK character the UI can show, so the web font can fetch just those glyphs up front.
export const CJK_TEXT = [...new Set(Object.values(STRINGS.zh).join('').replace(/[\x00-\x7f]/g, ''))].join('');

// Fills elements tagged with data-i18n (text) / data-i18n-alt (alt attribute).
export function applyDom() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.documentElement.dataset.lang = lang;
  document.title = t('doc.title');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-alt]')) el.alt = t(el.dataset.i18nAlt);
  for (const el of document.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));
  for (const el of document.querySelectorAll('[data-lang-btn]')) el.classList.toggle('on', el.dataset.langBtn === lang);
}
