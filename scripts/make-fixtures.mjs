#!/usr/bin/env node
// Generate the short (<1 s) audio fixtures in tests/fixtures/ used by the
// E2E tests (and available to any other test).
//
//   tone.wav   44.1 kHz stereo 16-bit, 0.5 s (440 Hz left / 660 Hz right) - written in JS
//   tone.aiff  48 kHz   stereo 16-bit  \
//   tone.aif   22.05 kHz mono  16-bit   |
//   tone.flac  44.1 kHz stereo 16-bit   |  encoded from tone.wav by the native engine
//   tone.mp3   44.1 kHz stereo 128 kbps |  (native/audio_napi.node, `npm run build:native`)
//   tone.ogg   44.1 kHz mono   VBR      /
//
// Usage: node scripts/make-fixtures.mjs [--force] [--out <dir>]
// Existing files are kept unless --force is given (they are committed).
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const force = args.includes('--force');
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? resolve(args[outIdx + 1]) : join(root, 'tests', 'fixtures');

export const FIXTURE_SECONDS = 0.5;

/** 16-bit PCM WAV bytes from planar float channels. */
export function wavBytes(channels, sampleRate) {
  const n = channels[0].length;
  const ch = channels.length;
  const data = n * ch * 2;
  const buf = Buffer.alloc(44 + data);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + data, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * ch * 2, 28);
  buf.writeUInt16LE(ch * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(data, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i]));
      buf.writeInt16LE(Math.round(v * 32767), o);
      o += 2;
    }
  }
  return buf;
}

/** Sine with 10 ms fades (no clicks). */
export function tone(freq, sampleRate, seconds, amp = 0.5) {
  const n = Math.round(sampleRate * seconds);
  const fade = Math.round(sampleRate * 0.01);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / fade, (n - 1 - i) / fade);
    out[i] = amp * env * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

const BASE = {
  format: 'wav',
  sampleRate: 0,
  channels: 'source',
  bitDepth: 16,
  bitrateMode: 'cbr',
  bitrateKbps: 192,
  vbrQuality: 0.7,
  resampleQuality: 'best',
  dither: false,
};

export const ENCODED = [
  { file: 'tone.aiff', options: { ...BASE, format: 'aiff', sampleRate: 48000 } },
  { file: 'tone.aif', options: { ...BASE, format: 'aiff', sampleRate: 22050, channels: 'mono' } },
  { file: 'tone.flac', options: { ...BASE, format: 'flac' } },
  { file: 'tone.mp3', options: { ...BASE, format: 'mp3', bitrateKbps: 128 } },
  { file: 'tone.ogg', options: { ...BASE, format: 'ogg', channels: 'mono', bitrateMode: 'vbr', vbrQuality: 0.3 } },
];

function track(sourceId) {
  return {
    id: 't1',
    sourceId,
    name: 'tone',
    offset: 0,
    clipStart: 0,
    clipEnd: null,
    gainDb: 0,
    pan: 0,
    mute: false,
    solo: false,
  };
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const wavPath = join(outDir, 'tone.wav');
  if (force || !existsSync(wavPath)) {
    const sr = 44100;
    writeFileSync(wavPath, wavBytes([tone(440, sr, FIXTURE_SECONDS), tone(660, sr, FIXTURE_SECONDS)], sr));
    console.log(`wrote ${wavPath}`);
  }

  const todo = ENCODED.filter((e) => force || !existsSync(join(outDir, e.file)));
  if (todo.length === 0) {
    console.log('fixtures up to date');
    return;
  }
  const addonPath = join(root, 'native', 'audio_napi.node');
  if (!existsSync(addonPath)) {
    console.error(`native addon missing (${addonPath}); run "npm run build:native" first`);
    process.exit(1);
  }
  const engine = createRequire(import.meta.url)(addonPath);
  const src = await engine.loadSource(wavPath);
  const project = JSON.stringify({ tracks: [track(src.id)] });
  const session = 'fixtures';
  await engine.render(session, project, null, 16, 16, 16);
  for (const { file, options } of todo) {
    const path = join(outDir, file);
    const bytes = await engine.export(session, project, JSON.stringify(options), path);
    console.log(`wrote ${path} (${bytes} bytes)`);
  }
  engine.releaseSession(session);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
