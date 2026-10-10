import { describe, expect, it } from 'vitest';
import { createDefaultExportOptions, MP3_BITRATES, MP3_SAMPLE_RATES, type ExportOptions } from '@shared/types';
import {
  bitDepthsFor,
  bitratesFor,
  effectiveSampleRate,
  fileNameForFormat,
  isLossy,
  isValidExport,
  nearest,
  outputChannels,
  projectFormat,
  sampleRatesFor,
  sanitizeExportOptions,
  sourceBytes,
  suggestedFileName,
  validateExportOptions,
  withFormat,
} from './exportOptions';

const opts = (p: Partial<ExportOptions>): ExportOptions => ({ ...createDefaultExportOptions(), ...p });
const codes = (o: ExportOptions, sr = 44100, ch = 2) => validateExportOptions(o, sr, ch).map((i) => i.code);

describe('validateExportOptions (mirrors Rust encode::validate)', () => {
  it('defaults are valid', () => {
    expect(codes(createDefaultExportOptions())).toEqual([]);
    expect(isValidExport(createDefaultExportOptions(), 44100, 2)).toBe(true);
  });

  it('bit depth must be 16/24/32', () => {
    for (const d of [16, 24, 32]) expect(codes(opts({ bitDepth: d as 16 }))).toEqual([]);
    expect(codes(opts({ bitDepth: 8 as unknown as 16 }))).toEqual(['bitDepth']);
  });

  it('vbr quality must be within 0..1', () => {
    expect(codes(opts({ vbrQuality: 0 }))).toEqual([]);
    expect(codes(opts({ vbrQuality: 1 }))).toEqual([]);
    expect(codes(opts({ vbrQuality: 1.01 }))).toEqual(['vbrQuality']);
    expect(codes(opts({ vbrQuality: -0.1 }))).toEqual(['vbrQuality']);
    expect(codes(opts({ vbrQuality: Number.NaN }))).toEqual(['vbrQuality']);
  });

  it('sample rate 4000..384000 (0 = project rate)', () => {
    expect(codes(opts({ sampleRate: 3999 }))).toEqual(['sampleRate']);
    expect(codes(opts({ sampleRate: 4000 }))).toEqual([]);
    expect(codes(opts({ sampleRate: 384000 }))).toEqual([]);
    expect(codes(opts({ sampleRate: 384001 }))).toEqual(['sampleRate']);
    expect(codes(opts({ sampleRate: 0 }), 500000)).toEqual(['sampleRate']);
  });

  it('mp3: only MP3_SAMPLE_RATES (also when keeping the project rate)', () => {
    for (const sr of MP3_SAMPLE_RATES) expect(codes(opts({ format: 'mp3', sampleRate: sr }))).toEqual([]);
    for (const sr of [11000, 44000, 88200, 96000]) expect(codes(opts({ format: 'mp3', sampleRate: sr }))).toContain('mp3SampleRate');
    expect(codes(opts({ format: 'mp3', sampleRate: 0 }), 96000)).toEqual(['mp3SampleRate']);
    expect(codes(opts({ format: 'mp3', sampleRate: 0 }), 48000)).toEqual([]);
  });

  it('mp3 CBR: only the standard bitrates; VBR ignores the bitrate', () => {
    for (const b of MP3_BITRATES) expect(codes(opts({ format: 'mp3', sampleRate: 44100, bitrateKbps: b }))).toEqual([]);
    for (const b of [0, 7, 100, 192.5, 330]) expect(codes(opts({ format: 'mp3', sampleRate: 44100, bitrateKbps: b }))).toEqual(['mp3Bitrate']);
    expect(codes(opts({ format: 'mp3', sampleRate: 44100, bitrateMode: 'vbr', bitrateKbps: 100 }))).toEqual([]);
  });

  it('mp3 supports at most 2 channels', () => {
    expect(codes(opts({ format: 'mp3', sampleRate: 44100, channels: 'source' }), 44100, 6)).toEqual(['mp3Channels']);
    expect(codes(opts({ format: 'mp3', sampleRate: 44100, channels: 'stereo' }), 44100, 6)).toEqual([]);
  });

  it('ogg CBR bitrate 32..500, VBR ignores it', () => {
    for (const b of [32, 128, 320, 500]) expect(codes(opts({ format: 'ogg', bitrateKbps: b }))).toEqual([]);
    for (const b of [31, 501, 8]) expect(codes(opts({ format: 'ogg', bitrateKbps: b }))).toEqual(['oggBitrate']);
    expect(codes(opts({ format: 'ogg', bitrateMode: 'vbr', bitrateKbps: 8 }))).toEqual([]);
  });

  it('lossless formats ignore bitrates', () => {
    for (const format of ['wav', 'aiff', 'flac'] as const) expect(codes(opts({ format, bitrateKbps: 1 }))).toEqual([]);
  });

  it('reports several issues at once with params', () => {
    const issues = validateExportOptions(opts({ format: 'mp3', sampleRate: 96000, bitrateKbps: 100, vbrQuality: 2 }), 44100, 2);
    expect(issues.map((i) => i.code)).toEqual(['vbrQuality', 'mp3SampleRate', 'mp3Bitrate']);
    expect(issues[1]!.params).toEqual({ value: 96000 });
  });
});

describe('choices per format', () => {
  it('bit depths: 16/24/32 for wav/aiff, 16/24 for flac, none for lossy', () => {
    expect(bitDepthsFor('wav')).toEqual([16, 24, 32]);
    expect(bitDepthsFor('aiff')).toEqual([16, 24, 32]);
    expect(bitDepthsFor('flac')).toEqual([16, 24]);
    expect(bitDepthsFor('mp3')).toEqual([]);
    expect(bitDepthsFor('ogg')).toEqual([]);
  });

  it('sample rates and bitrates', () => {
    expect(sampleRatesFor('mp3')).toEqual([...MP3_SAMPLE_RATES]);
    expect(sampleRatesFor('wav')).toEqual([8000, 11025, 16000, 22050, 32000, 44100, 48000, 96000]);
    expect(bitratesFor('mp3')).toEqual([...MP3_BITRATES]);
    expect(Math.min(...bitratesFor('ogg'))).toBe(32);
    expect(Math.max(...bitratesFor('ogg'))).toBe(320);
    expect(bitratesFor('flac')).toEqual([]);
    expect(isLossy('ogg')).toBe(true);
    expect(isLossy('flac')).toBe(false);
  });

  it('channels and effective sample rate', () => {
    expect(outputChannels('source', 1)).toBe(1);
    expect(outputChannels('source', 0)).toBe(1);
    expect(outputChannels('mono', 2)).toBe(1);
    expect(outputChannels('stereo', 1)).toBe(2);
    expect(effectiveSampleRate({ sampleRate: 0 }, 48000)).toBe(48000);
    expect(effectiveSampleRate({ sampleRate: 22050 }, 48000)).toBe(22050);
  });

  it('nearest prefers the closest, ties go up', () => {
    expect(nearest([8, 16, 32], 20)).toBe(16);
    expect(nearest([8, 16, 32], 24)).toBe(32);
    expect(nearest([], 5)).toBe(5);
  });
});

describe('sanitizeExportOptions / withFormat', () => {
  it('switching to mp3 snaps sample rate, bitrate and channels to valid values', () => {
    const o = withFormat(opts({ sampleRate: 96000, bitrateKbps: 100, channels: 'source' }), 'mp3', 44100, 6);
    expect(o.format).toBe('mp3');
    expect(o.sampleRate).toBe(48000);
    expect(o.bitrateKbps).toBe(96);
    expect(o.channels).toBe('stereo');
    expect(isValidExport(o, 44100, 6)).toBe(true);
  });

  it('mp3 with "keep" and an unsupported project rate picks the nearest MP3 rate', () => {
    expect(withFormat(opts({ sampleRate: 0 }), 'mp3', 88200, 2).sampleRate).toBe(48000);
    expect(withFormat(opts({ sampleRate: 0 }), 'mp3', 44100, 2).sampleRate).toBe(0);
  });

  it('flac turns 32-bit into 24-bit, ogg clamps the bitrate into 32..320', () => {
    expect(withFormat(opts({ bitDepth: 32 }), 'flac', 44100, 2).bitDepth).toBe(24);
    expect(withFormat(opts({ bitrateKbps: 8 }), 'ogg', 44100, 2).bitrateKbps).toBe(32);
    expect(withFormat(opts({ bitrateKbps: 499 }), 'ogg', 44100, 2).bitrateKbps).toBe(320);
  });

  it('repairs invalid generic values', () => {
    const o = sanitizeExportOptions(opts({ bitDepth: 12 as unknown as 16, vbrQuality: 3, sampleRate: 100 }), 44100, 2);
    expect(o.bitDepth).toBe(16);
    expect(o.vbrQuality).toBe(1);
    expect(o.sampleRate).toBe(4000);
    expect(sanitizeExportOptions(opts({ vbrQuality: Number.NaN }), 44100, 2).vbrQuality).toBe(0.7);
  });

  it('every format x rate x channel combination is valid after sanitising', () => {
    for (const format of ['wav', 'aiff', 'flac', 'mp3', 'ogg'] as const) {
      for (const sampleRate of [0, 8000, 11025, 22050, 44100, 48000, 96000]) {
        for (const projectRate of [22050, 44100, 96000]) {
          const o = sanitizeExportOptions(opts({ format, sampleRate, bitrateKbps: 100 }), projectRate, 2);
          expect(validateExportOptions(o, projectRate, 2)).toEqual([]);
        }
      }
    }
  });
});

describe('file names', () => {
  it('suggests "<base>.<ext>" without invalid characters', () => {
    expect(suggestedFileName('kick.wav', 'ogg')).toBe('kick.ogg');
    expect(suggestedFileName('a/b:c*?', 'mp3')).toBe('a_b_c__.mp3');
    expect(suggestedFileName('  ', 'flac')).toBe('export.flac');
    expect(suggestedFileName(null, 'wav')).toBe('export.wav');
    expect(suggestedFileName('Track 1. ', 'aiff')).toBe('Track 1.aiff');
    expect(fileNameForFormat('loop.mp3', 'wav')).toBe('loop.wav');
    expect(fileNameForFormat('loop.v2', 'wav')).toBe('loop.v2.wav');
  });
});

describe('project format + source size', () => {
  const sources = {
    a: { sampleRate: 22050, channels: 1, fileSize: 100 },
    b: { sampleRate: 48000, channels: 2, fileSize: 1000 },
  };
  const tr = (sourceId: string, mute = false, solo = false) => ({ sourceId, mute, solo });

  it('uses the max rate and stereo if any audible track is stereo', () => {
    expect(projectFormat([tr('a'), tr('b')], sources)).toEqual({ sampleRate: 48000, channels: 2 });
    expect(projectFormat([tr('a'), tr('b', true)], sources)).toEqual({ sampleRate: 22050, channels: 1 });
    expect(projectFormat([tr('a', false, true), tr('b')], sources)).toEqual({ sampleRate: 22050, channels: 1 });
    expect(projectFormat([], sources)).toEqual({ sampleRate: 44100, channels: 2 });
    expect(projectFormat([tr('zz')], sources)).toEqual({ sampleRate: 44100, channels: 2 });
  });

  it('sums distinct source files', () => {
    expect(sourceBytes([tr('a'), tr('a'), tr('b'), tr('missing')], sources)).toBe(1100);
  });
});
