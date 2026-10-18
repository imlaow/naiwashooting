// The ONLINE panel's pieces that load with the page: server address rules, the recently joined
// servers and the player's name (both kept in the browser). Joining itself is in net/online.js,
// loaded on demand with the Colyseus SDK.

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

// What the player typed → { url } to connect to, or { error } ('empty' or 'badAddress').
// The site is served over HTTPS, so browsers only allow wss://, plus ws:// to this machine.
// https:// becomes wss://; a bare host name gets wss:// (ws:// for localhost).
export function serverUrl(text) {
  let s = String(text ?? '').trim();
  if (!s) return { error: 'empty' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `${LOCAL.has(s.split(/[:/]/)[0].toLowerCase()) ? 'ws' : 'wss'}://${s}`;
  let u;
  try { u = new URL(s); } catch { return { error: 'badAddress' }; }
  const local = LOCAL.has(u.hostname);
  if (u.protocol === 'https:') u.protocol = 'wss:';
  else if (u.protocol === 'http:' && local) u.protocol = 'ws:';
  if (!(u.protocol === 'wss:' || (u.protocol === 'ws:' && local))) return { error: 'badAddress' };
  return { url: `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}${u.search}` };
}

const RECENT_KEY = 'naiwa-servers';
const NAME_KEY = 'naiwa-name';

export function readRecent() {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY));
    return Array.isArray(v) ? v.filter((s) => typeof s === 'string').slice(0, 5) : [];
  } catch { return []; }
}

export function rememberServer(url) {
  const list = [url, ...readRecent().filter((s) => s !== url)].slice(0, 5);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

export function readName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}

export function writeName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* storage unavailable */ }
}
