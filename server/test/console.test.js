// The owner's console in a real naiwa-server process (server/index.js) on 127.0.0.1:2571: commands
// read from stdin, and a server that keeps running when stdin is closed, empty, ends, or is the
// terminal of a shell that put the server in the background (which would stop a process reading
// it, SIGTTIN). The commands themselves are tested in room.test.js.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from '../../src/net/online.js';

const PORT = 2571;
const INDEX = fileURLToPath(new URL('../index.js', import.meta.url));
const dir = mkdtempSync(`${tmpdir()}/naiwa-console-`);
const CFG = `${dir}/server.json`;
writeFileSync(CFG, JSON.stringify({ port: PORT, maps: ['factory/dairy'], log: false }));
const running = new Set();
after(() => { for (const p of running) p.kill('SIGKILL'); });

// Starts `cmd args` and resolves once the server says it is up; `out` collects its output.
function start(cmd, args, stdin) {
  const p = spawn(cmd, args, { stdio: [stdin, 'pipe', 'pipe'] });
  running.add(p);
  p.out = '';
  p.on('exit', () => running.delete(p));
  for (const s of [p.stdout, p.stderr]) s.on('data', (d) => { p.out += d; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no start within 30 s:\n${p.out}`)), 30000);
    p.on('exit', (code) => { clearTimeout(timer); reject(new Error(`exited (${code}):\n${p.out}`)); });
    const check = () => { if (p.out.includes('type "help" here')) { clearTimeout(timer); resolve(p); } };
    p.stdout.on('data', check);
  });
}
const waitFor = async (p, text, what) => {
  const t0 = Date.now();
  while (!p.out.includes(text)) {
    if (Date.now() - t0 > 10000) throw new Error(`timed out waiting for ${what}:\n${p.out}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};
// Still up 1 s on, and a player can join.
async function stillServing(p) {
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(p.exitCode, null, `the server stopped:\n${p.out}`);
  const room = await join(`ws://127.0.0.1:${PORT}`, { name: 'Probe' });
  await room.leave();
}
async function stop(p) {
  const gone = new Promise((r) => p.once('exit', r));
  p.kill('SIGINT');
  await gone;
}

test('commands from a pipe; at the end of it the server runs on', async () => {
  const p = await start(process.execPath, [INDEX, CFG], 'pipe');
  p.stdin.write('players\nfrobnicate\n');
  await waitFor(p, '0/4 players, co-op on factory/dairy', 'the players answer');
  await waitFor(p, 'unknown command "frobnicate"', 'the unknown command');
  p.stdin.end();
  await stillServing(p);
  await stop(p);
});

test('stdin empty (Docker without -i) or closed: the server runs on', async () => {
  const empty = await start(process.execPath, [INDEX, CFG], 'ignore');
  await stillServing(empty);
  await stop(empty);
  const closed = await start('bash', ['-c', `exec "${process.execPath}" "${INDEX}" "${CFG}" 0<&-`], 'ignore');
  await stillServing(closed);
  await stop(closed);
});

// `script` gives the shell a terminal, so `&` puts the server in a background job as an owner's
// shell would. Without the SIGTTIN guard, the job shows as "Stopped (tty input)".
const hasScript = spawnSync('script', ['--version']).status === 0;
test('started in the background of a terminal: not stopped by it', { skip: !hasScript && 'no `script` here' }, async () => {
  const shell = `"${process.execPath}" "${INDEX}" "${CFG}" & sleep 6; jobs -l; kill -9 %1`; // -9: also ends a job the terminal stopped
  const r = spawnSync('script', ['-qec', `bash -ic '${shell}'`, '/dev/null'], { encoding: 'utf8', timeout: 60000 });
  assert.ok(r.stdout.includes('type "help" here'), `didn't start:\n${r.stdout}`);
  assert.ok(!/Stopped/.test(r.stdout), `stopped by the terminal:\n${r.stdout}`);
  assert.match(r.stdout, /Running/);
});
