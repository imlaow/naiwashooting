// Joining a naiwa-server. This module (and @colyseus/sdk with it) is only loaded when the
// ONLINE panel opens (main.js imports it dynamically), so single-player downloads none of it.
import { Client } from '@colyseus/sdk';
import { PROTOCOL } from '../sim/protocol.js';
export { NetSim } from './netsim.js';
export { PROTOCOL };

// A refused or failed join. `reason`: 'version' (`server` has the server's protocol),
// 'full', 'password', 'origin', 'unreachable' or 'error' (`message` says more).
export class JoinError extends Error {
  constructor(reason, message, server) {
    super(message || reason);
    this.reason = reason;
    this.server = server;
  }
}

// The JoinError for whatever join() threw.
export function joinError(err) {
  const msg = String(err?.message ?? err);
  const m = /^version:(\d+)$/.exec(msg);
  if (m) return new JoinError('version', msg, Number(m[1]));
  if (msg === 'full' || /already full|no rooms found/.test(msg)) return new JoinError('full', msg);
  if (msg === 'password' || msg === 'origin') return new JoinError(msg, msg);
  // fetch() failing outright: nothing answered at that address.
  if (err instanceof TypeError || /fetch|ECONNREFUSED|network/i.test(msg)) return new JoinError('unreachable', msg);
  return new JoinError('error', msg);
}

// Joins the room at `url` (ws:// or wss://) and resolves once its first state has arrived.
export async function join(url, { name, password }) {
  let room;
  try {
    room = await new Client(url).join('naiwa', { protocol: PROTOCOL, name, password });
  } catch (err) {
    throw joinError(err);
  }
  // Between runs (while a map loads) nothing listens to the tick messages; that's expected.
  for (const type of ['events', 'bullet', 'bulletEnd']) room.onMessage(type, () => {});
  if (!room.state?.map?.theme) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new JoinError('error', 'no state from the server')), 10000);
      room.onStateChange.once(() => { clearTimeout(timer); resolve(); });
    }).catch((err) => { room.leave(); throw err; });
  }
  return room;
}
