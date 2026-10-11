#!/usr/bin/env node
// Build native/audio_napi.node only when it is missing (`--force` always rebuilds).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ADDON = join(root, 'native', 'audio_napi.node');

export function ensureNative(force = false) {
  if (!force && existsSync(ADDON)) {
    console.log(`native addon present: ${ADDON}`);
    return;
  }
  const res = spawnSync(process.execPath, [join(root, 'scripts', 'build-native.mjs')], { cwd: root, stdio: 'inherit' });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureNative(process.argv.includes('--force'));
}
