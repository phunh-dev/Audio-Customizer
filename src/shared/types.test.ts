import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPORT_OPTIONS,
  EQ_FREQS,
  createDefaultEffectChain,
  createDefaultExportOptions,
  createDefaultFilterBand,
  createDefaultProject,
  createDefaultTrack,
} from './types';
import { ERROR_CODES, errorCodeOf, errorDetailOf } from './api';

describe('shared defaults (contract)', () => {
  it('effect chain defaults match the contract', () => {
    const c = createDefaultEffectChain();
    expect(c.denoise).toEqual({
      enabled: false,
      mode: 'spectral',
      reductionDb: 12,
      sensitivityDb: 6,
      smoothing: 0.5,
      attackMs: 5,
      releaseMs: 50,
      profileStart: null,
      profileEnd: null,
    });
    expect(c.pitchTempo).toEqual({ enabled: false, semitones: 0, cents: 0, tempo: 100, mode: 'stretch' });
    expect(c.filters).toEqual({ enabled: false, items: [] });
    expect(c.eq.enabled).toBe(false);
    expect(c.eq.bands).toHaveLength(16);
    expect(c.eq.bands.map((b) => b.freq)).toEqual([...EQ_FREQS]);
    expect(c.eq.bands.every((b) => b.gainDb === 0 && b.q === 1.4)).toBe(true);
    expect(c.volume).toEqual({
      gainDb: 0,
      normalize: 'off',
      normalizeTarget: -1,
      limiter: false,
      limiterCeilingDb: -1,
      limiterReleaseMs: 50,
    });
  });

  it('factories return fresh objects', () => {
    const a = createDefaultEffectChain();
    const b = createDefaultEffectChain();
    expect(a).toEqual(b);
    expect(a.eq.bands).not.toBe(b.eq.bands);
  });

  it('filter band defaults', () => {
    expect(createDefaultFilterBand('f1')).toEqual({
      id: 'f1',
      type: 'highpass',
      freq: 100,
      q: 0.7071,
      slope: 12,
      gainDb: 0,
      enabled: true,
    });
    expect(createDefaultFilterBand('f2', 'lowshelf').type).toBe('lowshelf');
  });

  it('track and project defaults', () => {
    const t = createDefaultTrack('t1', 'src', 'a.wav', 2);
    expect(t).toMatchObject({
      id: 't1',
      sourceId: 'src',
      name: 'a.wav',
      offset: 2,
      clipStart: 0,
      clipEnd: null,
      gainDb: 0,
      pan: 0,
      mute: false,
      solo: false,
      fadeIn: { duration: 0, curve: 'linear' },
      fadeOut: { duration: 0, curve: 'linear' },
    });
    expect(createDefaultTrack('x', 's', 'n').offset).toBe(0);
    const p = createDefaultProject();
    expect(p.tracks).toEqual([]);
    expect(p.master.loop).toEqual({
      enabled: false,
      crossfadeMs: 100,
      curve: 'equalPower',
      start: null,
      end: null,
      zeroCrossing: true,
      matchLoudness: false,
    });
    expect(p.master.trimSilence).toEqual({ enabled: false, thresholdDb: -60, padMs: 10 });
  });

  it('export option defaults', () => {
    expect(DEFAULT_EXPORT_OPTIONS).toEqual({
      format: 'wav',
      sampleRate: 0,
      channels: 'source',
      bitDepth: 16,
      bitrateMode: 'cbr',
      bitrateKbps: 192,
      vbrQuality: 0.7,
      resampleQuality: 'best',
      dither: true,
    });
    expect(Object.isFrozen(DEFAULT_EXPORT_OPTIONS)).toBe(true);
    const copy = createDefaultExportOptions();
    copy.format = 'mp3';
    expect(DEFAULT_EXPORT_OPTIONS.format).toBe('wav');
  });
});

describe('error code parsing', () => {
  it('extracts known codes', () => {
    expect(errorCodeOf(new Error('ERR_DECODE_FAILED: bad header'))).toBe('ERR_DECODE_FAILED');
    expect(errorCodeOf('ERR_EMPTY_PROJECT')).toBe('ERR_EMPTY_PROJECT');
    expect(errorCodeOf(new Error('ERR_NOPE: x'))).toBe('ERR_UNKNOWN');
    expect(errorCodeOf(new Error('boom'))).toBe('ERR_UNKNOWN');
    expect(errorCodeOf(42)).toBe('ERR_UNKNOWN');
  });

  it('extracts details', () => {
    expect(errorDetailOf(new Error('ERR_IO: disk full'))).toBe('disk full');
    expect(errorDetailOf(new Error('ERR_EMPTY_PROJECT'))).toBe('');
    expect(errorDetailOf(new Error('plain'))).toBe('plain');
    expect(errorDetailOf(null)).toBe('');
  });

  it('covers every Rust error code', () => {
    for (const c of [
      'ERR_FILE_NOT_FOUND',
      'ERR_UNSUPPORTED_FORMAT',
      'ERR_DECODE_FAILED',
      'ERR_ENCODE_FAILED',
      'ERR_INVALID_PARAM',
      'ERR_IO',
      'ERR_NO_AUDIO_DEVICE',
      'ERR_SOURCE_NOT_LOADED',
      'ERR_SESSION_NOT_FOUND',
      'ERR_EMPTY_PROJECT',
    ]) {
      expect(ERROR_CODES).toContain(c);
    }
  });
});
