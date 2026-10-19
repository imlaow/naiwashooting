// Builds the npm package `naiwa-server` (what `npx naiwa-server` and the Docker image run) from
// the repo, without a bundler: the server's files and the game code they import (src/sim/ and
// the map builders it uses) are copied in at the same relative paths, so every import works
// unchanged and a stack trace points at the same file and line as in the repo. Only the files
// reachable by imports from server/cli.js go in, so nothing else in src/ (the view, assets) and
// no tests are published. The Colyseus packages stay npm dependencies at their pinned versions,
// with an npm-shrinkwrap.json from server/package-lock.json so installs get the tested tree.
//
//   node tools/pack-server.mjs            build/naiwa-server/ and build/naiwa-server-<version>.tgz
//   node tools/pack-server.mjs --no-pack  only the directory (the Dockerfile packs it itself)
//
// Fails if the package would hold anything outside the allowlist below (tests, server.json,
// bans.json, .env, …).
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync, renameSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const build = join(root, 'build'), out = join(build, 'naiwa-server');
const pack = !process.argv.includes('--no-pack');
const npm = (args, cwd) => execFileSync('npm', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

// Every relative import (static or import()) from the entry, followed through.
const files = new Set();
const follow = (file) => {
  const rel = relative(root, file);
  if (files.has(rel)) return;
  files.add(rel);
  const src = readFileSync(file, 'utf8');
  for (const [, spec] of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) follow(resolve(dirname(file), spec));
};
follow(join(root, 'server/cli.js'));
files.add('server/server.example.json');

rmSync(out, { recursive: true, force: true });
for (const f of files) {
  mkdirSync(dirname(join(out, f)), { recursive: true });
  copyFileSync(join(root, f), join(out, f));
}
copyFileSync(join(root, 'docs/hosting.md'), join(out, 'README.md'));
if (existsSync(join(root, 'LICENSE'))) copyFileSync(join(root, 'LICENSE'), join(out, 'LICENSE'));

const own = JSON.parse(readFileSync(join(root, 'server/package.json'), 'utf8'));
const pkg = {
  name: own.name,
  version: own.version,
  description: own.description,
  license: own.license,
  keywords: ['naiwa', 'game server', 'colyseus', 'multiplayer'],
  type: 'module',
  bin: { 'naiwa-server': 'server/cli.js' },
  engines: own.engines,
  dependencies: own.dependencies,
};
writeFileSync(join(out, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
// The repo's lock, pruned to what the package installs (no devDependencies).
copyFileSync(join(root, 'server/package-lock.json'), join(out, 'package-lock.json'));
npm(['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], out);
renameSync(join(out, 'package-lock.json'), join(out, 'npm-shrinkwrap.json'));

// What npm would publish, against the allowlist.
const [listing] = JSON.parse(npm(['pack', '--dry-run', '--json'], out));
const allowed = /^(package\.json|README\.md|LICENSE|npm-shrinkwrap\.json|server\/server\.example\.json|server\/(?!test\/)[\w-]+\.js|src\/(sim\/)?[\w-]+\.js)$/;
const bad = listing.files.map((f) => f.path).filter((p) => !allowed.test(p));
if (bad.length) throw new Error(`not for publishing: ${bad.join(', ')}`);
console.log(`${pkg.name}@${pkg.version}: ${listing.files.length} files, ${(listing.size / 1024).toFixed(1)} kB packed, ${(listing.unpackedSize / 1024).toFixed(1)} kB unpacked`);
for (const f of listing.files) console.log(`  ${String(f.size).padStart(7)}  ${f.path}`);
if (!pkg.license) console.log('  (no "license" in server/package.json yet)');
if (pack) {
  const [made] = JSON.parse(npm(['pack', '--json', '--pack-destination', build], out));
  console.log(`-> ${join(build, made.filename)}`);
}
