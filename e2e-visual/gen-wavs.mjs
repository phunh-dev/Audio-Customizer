// Generates test WAV files into ./fixtures
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
mkdirSync(dir, { recursive: true });
function wav(name, sr, ch, secs, fn) {
  const n = Math.floor(sr * secs);
  const buf = Buffer.alloc(44 + n * ch * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * ch * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * ch * 2, 28); buf.writeUInt16LE(ch * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * ch * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) { const t = i / sr; for (let c = 0; c < ch; c++) { let v = Math.max(-1, Math.min(1, fn(t, c))); buf.writeInt16LE(Math.round(v * 32767), o); o += 2; } }
  writeFileSync(join(dir, name), buf);
}
let seed = 1; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
// music: chord progression + noise, 12 s stereo 44.1k
const chords = [[220, 277.18, 329.63], [196, 246.94, 293.66], [174.61, 220, 261.63], [196, 246.94, 329.63]];
wav('music-chords.wav', 44100, 2, 12, (t, c) => {
  const ch = chords[Math.floor(t / 3) % 4]; const env = 0.6 + 0.4 * Math.sin(t * Math.PI * 2);
  let v = 0; for (const f of ch) v += Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t);
  const beat = (t * 2) % 1; const kick = beat < 0.1 ? Math.sin(2 * Math.PI * 60 * t) * (1 - beat * 10) : 0;
  return 0.12 * v * env + 0.4 * kick + 0.03 * rnd() + (c ? 0.01 * Math.sin(2*Math.PI*880*t) : 0);
});
// voice-like: 3 s mono 22.05k, formant-ish pulses
wav('voice-sample.wav', 22050, 1, 3, (t) => {
  const f0 = 140 + 30 * Math.sin(t * 3); const syl = Math.max(0, Math.sin(t * Math.PI * 3)) ** 2;
  let v = 0; for (let h = 1; h < 20; h++) { const f = f0 * h; const g = Math.exp(-((f - 700) ** 2) / 2e5) + 0.6 * Math.exp(-((f - 1200) ** 2) / 3e5) + 0.3 * Math.exp(-((f - 2500) ** 2) / 5e5); v += g * Math.sin(2 * Math.PI * f * t) / h ** 0.3; }
  return 0.3 * v * syl + 0.02 * rnd();
});
// SFX: 0.8 s sweep with decay 48k stereo
wav('sfx-zap.wav', 48000, 2, 0.8, (t, c) => Math.exp(-t * 5) * Math.sin(2 * Math.PI * (2000 * t - 1100 * t * t) * (c ? 1.01 : 1)) * 0.8);
// many small tracks for list scrolling
for (let k = 1; k <= 8; k++) wav(`blip-${String(k).padStart(2, '0')}-with-a-rather-long-file-name.wav`, 44100, 1, 1 + k * 0.25, (t) => Math.exp(-t * 3) * Math.sin(2 * Math.PI * 220 * k * t) * 0.5);
console.log('ok', dir);
