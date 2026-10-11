#!/usr/bin/env node
// npm run test:e2e [-- <playwright args>]
//   1. build the native addon if missing   (scripts/ensure-native.mjs)
//   2. generate missing audio fixtures       (scripts/make-fixtures.mjs)
//   3. bundle the app                        (electron-vite build -> out/)
//   4. run Playwright (playwright.config.ts, e2e/**)
// Set E2E_SKIP_BUILD=1 to reuse an existing out/ (step 3).
//
// --packaged: run the same suite against the unpacked packaged app in release/
// (after `npm run dist`), i.e. resources/native/audio_napi.node + app.asar.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureNative } from './ensure-native.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON_VITE = join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js');
const PLAYWRIGHT = join(root, 'node_modules', '@playwright', 'test', 'cli.js');

function run(cmd, args, env = process.env) {
  console.log(`> ${[cmd, ...args].join(' ')}`);
  const res = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

/** Executable of the unpacked packaged app (electron-builder output). */
export function packagedExecutable(platform = process.platform) {
  const release = join(root, 'release');
  if (platform === 'win32') return join(release, 'win-unpacked', 'Audio Customizer.exe');
  if (platform === 'darwin') {
    const dir = existsSync(release) ? readdirSync(release).find((d) => /^mac/.test(d)) : undefined;
    return join(release, dir ?? 'mac', 'Audio Customizer.app', 'Contents', 'MacOS', 'Audio Customizer');
  }
  return join(release, 'linux-unpacked', 'audio-customizer');
}

const args = process.argv.slice(2);
const packaged = args.includes('--packaged');
const pwArgs = args.filter((a) => a !== '--packaged');
// VS Code terminals export ELECTRON_RUN_AS_NODE=1, which would start Electron as plain Node
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

ensureNative();
run(process.execPath, [join(root, 'scripts', 'make-fixtures.mjs')]);
if (packaged) {
  const exe = packagedExecutable();
  if (!existsSync(exe)) {
    console.error(`packaged app not found: ${exe} (run "npm run dist" first)`);
    process.exit(1);
  }
  env.AUDIO_CUSTOMIZER_E2E_EXECUTABLE = exe;
} else if (!process.env.E2E_SKIP_BUILD) {
  run(process.execPath, [ELECTRON_VITE, 'build']);
}
run(process.execPath, [PLAYWRIGHT, 'test', ...pwArgs], env);
