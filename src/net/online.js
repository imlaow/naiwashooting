// Joining a naiwa-server. This module (and @colyseus/sdk with it) is only loaded when the
// ONLINE panel opens (main.js imports it dynamically), so single-player downloads none of it.
import { Client } from '@colyseus/sdk';
import { ColorMatrixFilter } from 'pixi.js';
import { PROTOCOL } from '../sim/protocol.js';
export { NetSim } from './netsim.js';
export { PROTOCOL };

// How long a dropped connection keeps trying (the server holds the seat for as long).
export const RECONNECT_SECONDS = 60;

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

// Turns colours `deg` degrees round the hue circle: a teammate's laugh in their colour. Here, so
// single-player doesn't download the filter.
export function hueFilter(deg) {
  const f = new ColorMatrixFilter();
  f.hue(deg, false);
  return f;
}

// @colyseus/sdk/debug (drift telemetry, latency simulator): its own chunk, fetched only for
// ?debug, before the join so it sees the room from the start.
export const loadDebug = () => import('@colyseus/sdk/debug');

// Joins the room at `url` (ws:// or wss://) and resolves once its first state has arrived.
// A dropped connection reconnects by itself (the SDK, with the room's token) for up to
// RECONNECT_SECONDS: room.onDrop, then room.onReconnect or, once it gives up, room.onLeave.
export async function join(url, { name, password }) {
  let room;
  try {
    room = await new Client(url).join('naiwa', { protocol: PROTOCOL, name, password });
  } catch (err) {
    throw joinError(err);
  }
  // The SDK's backoff (doubling from 0.2 s) capped at 3 s, enough tries to cover the window.
  Object.assign(room.reconnection, { maxDelay: 3000, maxRetries: Math.ceil(RECONNECT_SECONDS / 3) + 6 });
  // Between runs (while a map loads) nothing listens to the tick messages; that's expected.
  for (const type of ['tick', 'chat', 'pong']) room.onMessage(type, () => {});
  if (!room.state?.map?.theme) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new JoinError('error', 'no state from the server')), 10000);
      room.onStateChange.once(() => { clearTimeout(timer); resolve(); });
    }).catch((err) => { room.leave(); throw err; });
  }
  return room;
}
