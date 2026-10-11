#!/usr/bin/env node
// Build the Rust napi addon and copy it to native/audio_napi.node.
//
// Usage: node scripts/build-native.mjs [--debug] [--target <rust-triple>]
// Env:   CARGO_TARGET_DIR is honoured (defaults to <root>/target).
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const debug = args.includes('--debug');
const targetIdx = args.indexOf('--target');
const target = targetIdx >= 0 ? args[targetIdx + 1] : undefined;

export function libFileName(platform = process.platform) {
  if (platform === 'win32') return 'audio_napi.dll';
  if (platform === 'darwin') return 'libaudio_napi.dylib';
  return 'libaudio_napi.so';
}

const cargoArgs = ['build', '-p', 'audio-napi'];
if (!debug) cargoArgs.push('--release');
if (target) cargoArgs.push('--target', target);

console.log(`> cargo ${cargoArgs.join(' ')}`);
const res = spawnSync('cargo', cargoArgs, { cwd: root, stdio: 'inherit' });
if (res.status !== 0) {
  console.error('cargo build failed');
  process.exit(res.status ?? 1);
}

const targetDir = process.env.CARGO_TARGET_DIR ? resolve(root, process.env.CARGO_TARGET_DIR) : join(root, 'target');
const profileDir = join(targetDir, ...(target ? [target] : []), debug ? 'debug' : 'release');
const platform = target
  ? target.includes('windows')
    ? 'win32'
    : target.includes('apple')
      ? 'darwin'
      : 'linux'
  : process.platform;
const built = join(profileDir, libFileName(platform));
if (!existsSync(built)) {
  console.error(`built library not found: ${built}`);
  process.exit(1);
}
const outDir = join(root, 'native');
mkdirSync(outDir, { recursive: true });
const dest = join(outDir, 'audio_napi.node');
copyFileSync(built, dest);
console.log(`copied ${built} -> ${dest}`);
