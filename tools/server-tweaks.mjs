// Test-only settings for a naiwa-server started by tools/bot-clients.mjs (node --import this file):
// BOT_WAVE=8 starts every run at wave 8 (a busy fight to measure), BOT_PATCH_MS=33 sends state
// patches every 33 ms instead of 50 (to see what a faster rate would cost).
import { NaiwaRoom } from '../server/room.js';

const wave = Number(process.env.BOT_WAVE) || 0, patchMs = Number(process.env.BOT_PATCH_MS) || 0;
if (wave > 1) {
  const newRun = NaiwaRoom.prototype.newRun;
  NaiwaRoom.prototype.newRun = function () { newRun.call(this); this.sim.wave = wave - 1; };
}
if (patchMs) {
  const onCreate = NaiwaRoom.prototype.onCreate;
  NaiwaRoom.prototype.onCreate = function (opts) { onCreate.call(this, opts); this.patchRate = patchMs; };
}
