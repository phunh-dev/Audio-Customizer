import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultEq, createDefaultExportOptions, createDefaultMaster, EQ_DEFAULT_Q, EQ_FREQS } from '@shared/types';
import { getStore, resetAppStore, selectActiveTab } from '@renderer/store';
import { eqResponseDb } from '@renderer/lib/dsp/response';
import { applyEqPreset, EQ_PRESETS, getEqPreset, matchEqPreset, resetEqBands } from './eqPresets';
import {
  applyOptimizePreset,
  applyOptimizePresetToMaster,
  getOptimizePreset,
  matchOptimizePreset,
  OPTIMIZE_PRESETS,
} from './optimizePresets';
import { selectionToLoopRegion, selectionToProfile } from './regions';
import { autoEnable, coalesceKeyFor, effectsBinder, getPath, masterBinder, moduleSwitchPath, setPath } from './binding';
import { normalizeTargetSpec, PARAMS, rangeProps } from './params';
import { pitchTempoSummary } from './sections/PitchTempoSection';
import { isTabActive } from './EffectsPanel';
import { validateExportOptions } from '@renderer/features/export/exportOptions';

describe('EQ presets', () => {
  it('every preset has 16 gains within ±18 dB', () => {
    expect(EQ_PRESETS.map((p) => p.id)).toEqual(['flat', 'bassBoost', 'trebleBoost', 'vocalPresence', 'loFi', 'telephone']);
    for (const p of EQ_PRESETS) {
      expect(p.gains).toHaveLength(16);
      for (const g of p.gains) expect(Math.abs(g)).toBeLessThanOrEqual(18);
    }
  });

  it('applying a preset sets contract frequencies, default Q, gains and enables the EQ', () => {
    const eq = createDefaultEq();
    eq.bands[3]!.q = 5;
    applyEqPreset(eq, 'bassBoost');
    expect(eq.enabled).toBe(true);
    expect(eq.bands.map((b) => b.freq)).toEqual([...EQ_FREQS]);
    expect(eq.bands.every((b) => b.q === EQ_DEFAULT_Q)).toBe(true);
    expect(eq.bands.map((b) => b.gainDb)).toEqual([...getEqPreset('bassBoost').gains]);
    expect(matchEqPreset(eq)).toBe('bassBoost');
    // bass boost actually boosts lows and leaves highs alone
    const [low, high] = eqResponseDb(eq, [40, 10000]);
    expect(low!).toBeGreaterThan(5);
    expect(Math.abs(high!)).toBeLessThan(0.5);
  });

  it('telephone cuts lows and highs, boosts mids', () => {
    const eq = createDefaultEq();
    applyEqPreset(eq, 'telephone');
    const [lo, mid, hi] = eqResponseDb(eq, [40, 1200, 12000]);
    expect(lo!).toBeLessThan(-15);
    expect(mid!).toBeGreaterThan(3);
    expect(hi!).toBeLessThan(-15);
  });

  it('flat keeps the enabled flag, matching and reset', () => {
    const eq = createDefaultEq();
    applyEqPreset(eq, 'flat');
    expect(eq.enabled).toBe(false);
    expect(matchEqPreset(eq)).toBe('flat');
    eq.bands[0]!.gainDb = 1;
    expect(matchEqPreset(eq)).toBeNull();
    eq.enabled = true;
    resetEqBands(eq);
    expect(eq.enabled).toBe(true);
    expect(matchEqPreset(eq)).toBe('flat');
    expect(matchEqPreset({ enabled: true, bands: [] })).toBeNull();
    expect(() => getEqPreset('nope' as never)).toThrow();
  });
});

describe('optimize presets', () => {
  it('match the documented settings and produce valid export options', () => {
    const map = Object.fromEntries(OPTIMIZE_PRESETS.map((p) => [p.id, p.options]));
    expect(map.sfxMobile).toMatchObject({ format: 'ogg', sampleRate: 22050, channels: 'mono', bitrateMode: 'vbr', vbrQuality: 0.4 });
    expect(map.bgm).toMatchObject({ format: 'ogg', sampleRate: 44100, channels: 'stereo', vbrQuality: 0.6 });
    expect(map.voice).toMatchObject({ format: 'mp3', sampleRate: 22050, channels: 'mono', bitrateMode: 'cbr', bitrateKbps: 64 });
    expect(map.losslessMaster).toMatchObject({ format: 'flac', sampleRate: 48000, bitDepth: 24 });
    for (const p of OPTIMIZE_PRESETS) {
      const o = applyOptimizePreset(createDefaultExportOptions(), p.id);
      expect(validateExportOptions(o, 44100, 2)).toEqual([]);
      expect(matchOptimizePreset(o)).toBe(p.id);
    }
    expect(matchOptimizePreset(createDefaultExportOptions())).toBeNull();
    expect(applyOptimizePreset(null, 'voice').format).toBe('mp3');
    expect(() => getOptimizePreset('x' as never)).toThrow();
  });

  it('sets trim silence on the master', () => {
    const m = createDefaultMaster();
    applyOptimizePresetToMaster(m, 'sfxMobile');
    expect(m.trimSilence.enabled).toBe(true);
    applyOptimizePresetToMaster(m, 'bgm');
    expect(m.trimSilence.enabled).toBe(false);
  });
});

describe('regions', () => {
  it('master profile/loop region = ordered timeline selection', () => {
    expect(selectionToProfile({ start: 2, end: 1 }, null)).toEqual({ start: 1, end: 2 });
    expect(selectionToLoopRegion({ start: 0.5, end: 3.25 })).toEqual({ start: 0.5, end: 3.25 });
    expect(selectionToProfile(null, null)).toBeNull();
    expect(selectionToProfile({ start: 1, end: 1 }, null)).toBeNull();
  });

  it('track profile is relative to the clip placement and clipped to its length', () => {
    const track = { offset: 2, clipStart: 1, clipEnd: 3 };
    expect(selectionToProfile({ start: 2.5, end: 3 }, track)).toEqual({ start: 0.5, end: 1 });
    expect(selectionToProfile({ start: 1, end: 10 }, track)).toEqual({ start: 0, end: 2 });
    expect(selectionToProfile({ start: 0, end: 1.5 }, track)).toBeNull();
    expect(selectionToProfile({ start: 3, end: 50 }, { offset: 2, clipStart: 0, clipEnd: null })).toEqual({ start: 1, end: 48 });
  });
});

describe('params', () => {
  it('ranges follow the plan and defaults the contract', () => {
    expect(PARAMS.volume.gainDb).toMatchObject({ min: -60, max: 24, default: 0 });
    expect(PARAMS.pitchTempo.semitones).toMatchObject({ min: -24, max: 24 });
    expect(PARAMS.pitchTempo.cents).toMatchObject({ min: -100, max: 100 });
    expect(PARAMS.pitchTempo.tempo).toMatchObject({ min: 25, max: 400, default: 100 });
    expect(PARAMS.filter.freq).toMatchObject({ min: 20, max: 20000, scale: 'log' });
    expect(PARAMS.filter.q).toMatchObject({ min: 0.1, max: 18 });
    expect(PARAMS.eq.gainDb).toMatchObject({ min: -18, max: 18 });
    expect(PARAMS.denoise.reductionDb).toMatchObject({ min: 0, max: 48, default: 12 });
    expect(PARAMS.denoise.sensitivityDb).toMatchObject({ min: 0, max: 24, default: 6 });
    expect(PARAMS.denoise.smoothing).toMatchObject({ min: 0, max: 1, default: 0.5 });
    expect(PARAMS.loop.crossfadeMs).toMatchObject({ min: 0, max: 5000, default: 100 });
    expect(PARAMS.trimSilence.thresholdDb.default).toBe(-60);
    expect(normalizeTargetSpec('lufs').default).toBe(-14);
    expect(normalizeTargetSpec('peak').default).toBe(-1);
    expect(rangeProps(PARAMS.filter.freq)).toEqual({ min: 20, max: 20000, step: 1, scale: 'log', defaultValue: 100 });
    expect(rangeProps(PARAMS.volume.gainDb)).not.toHaveProperty('scale');
  });

  it('pitch/tempo summary follows the contract formula', () => {
    expect(pitchTempoSummary(12, 0, 100, 'stretch')).toEqual({ pitchRatio: 2, lengthFactor: 1 });
    const v = pitchTempoSummary(0, 0, 200, 'varispeed');
    expect(v.pitchRatio).toBeCloseTo(2);
    expect(v.lengthFactor).toBeCloseTo(0.5);
    expect(pitchTempoSummary(0, 0, 50, 'stretch').pitchRatio).toBe(1);
  });
});

describe('binding', () => {
  beforeEach(() => resetAppStore());

  it('getPath / setPath walk dotted paths', () => {
    const o = { a: { b: [{ c: 1 }] } };
    expect(getPath(o, 'a.b.0.c')).toBe(1);
    expect(getPath(o, 'a.x.y')).toBeUndefined();
    setPath(o, 'a.b.0.c', 5);
    expect(o.a.b[0]!.c).toBe(5);
    setPath(o, 'a.x.y', 1); // missing parent: ignored
    expect(o).toEqual({ a: { b: [{ c: 5 }] } });
    expect(coalesceKeyFor('master', 'eq.bands.1.gainDb')).toBe('fx:master:eq.bands.1.gainDb');
  });

  const history = () => selectActiveTab(getStore()).history.past.length;
  const master = () => selectActiveTab(getStore()).project.master;

  it('one drag (many onChange + one onCommit) = one undo step', () => {
    const before = history();
    for (const v of [1, 2, 3, 4]) {
      const fx = effectsBinder('master', master().effects);
      fx.num('volume.gainDb').onChange(v);
    }
    effectsBinder('master', master().effects).num('volume.gainDb').onCommit(4);
    expect(master().effects.volume.gainDb).toBe(4);
    expect(history()).toBe(before + 1);
    // second drag of the same parameter is a new step
    effectsBinder('master', master().effects).num('volume.gainDb').onChange(5);
    expect(history()).toBe(before + 2);
    getStore().undo();
    expect(master().effects.volume.gainDb).toBe(4);
    getStore().undo();
    expect(master().effects.volume.gainDb).toBe(0);
  });

  it('discrete sets are separate undo steps; master binder edits loop/trim', () => {
    const before = history();
    masterBinder(master()).set('loop.enabled', true);
    masterBinder(master()).set('loop.zeroCrossing', false);
    expect(master().loop).toMatchObject({ enabled: true, zeroCrossing: false });
    expect(history()).toBe(before + 2);
    const mx = masterBinder(master());
    mx.change('trimSilence.padMs', (m) => void (m.trimSilence.padMs = 20));
    mx.commit();
    expect(master().trimSilence.padMs).toBe(20);
    expect(mx.num('trimSilence.padMs').value).toBe(10); // binder reads the snapshot it was created with
  });

  it('finds the on/off switch of the module owning a path', () => {
    expect(moduleSwitchPath('eq.bands.3.gainDb', 'chain')).toBe('eq.enabled');
    expect(moduleSwitchPath('filters.items.0.freq', 'chain')).toBe('filters.enabled');
    expect(moduleSwitchPath('eq.enabled', 'chain')).toBeNull();
    expect(moduleSwitchPath('volume.gainDb', 'chain')).toBeNull(); // volume has no switch
    expect(moduleSwitchPath('eq', 'chain')).toBeNull();
    expect(moduleSwitchPath('loop.crossfadeMs', 'master')).toBe('loop.enabled');
    expect(moduleSwitchPath('effects.denoise.reductionDb', 'master')).toBe('effects.denoise.enabled');
    expect(moduleSwitchPath('effects.volume.gainDb', 'master')).toBeNull();
    expect(moduleSwitchPath('trimSilence.enabled', 'master')).toBeNull();
    const d = { eq: { enabled: false }, denoise: { enabled: true } };
    autoEnable(d, 'eq.bands.0.q', 'chain');
    expect(d.eq.enabled).toBe(true);
    autoEnable(d, 'volume.gainDb', 'chain');
    expect(d).toEqual({ eq: { enabled: true }, denoise: { enabled: true } });
  });

  it('editing a value of a switched-off module turns it on (same undo step)', () => {
    const before = history();
    expect(master().effects.eq.enabled).toBe(false);
    effectsBinder('master', master().effects).num('eq.bands.4.gainDb').onChange(6);
    expect(master().effects.eq).toMatchObject({ enabled: true });
    expect(master().effects.eq.bands[4]!.gainDb).toBe(6);
    expect(history()).toBe(before + 1);
    getStore().undo();
    expect(master().effects.eq.enabled).toBe(false);
    expect(master().effects.eq.bands[4]!.gainDb).toBe(0);
    // discrete sets (modes, sub-switches) do not switch the module on
    masterBinder(master()).set('loop.zeroCrossing', false);
    expect(master().loop.enabled).toBe(false);
    masterBinder(master()).num('loop.crossfadeMs').onChange(250);
    expect(master().loop.enabled).toBe(true);
  });

  it('track binder edits the track chain only', async () => {
    await getStore().addTracksFromPaths(['C:/a/voice.wav']);
    const tr = selectActiveTab(getStore()).project.tracks[0]!;
    effectsBinder(tr.id, tr.effects).set('denoise.enabled', true);
    expect(selectActiveTab(getStore()).project.tracks[0]!.effects.denoise.enabled).toBe(true);
    expect(master().effects.denoise.enabled).toBe(false);
  });
});

describe('isTabActive', () => {
  it('reflects effect state', () => {
    const m = createDefaultMaster();
    const flags = { loop: false, trim: false, preview: false };
    for (const tab of ['volume', 'pitchTempo', 'filters', 'eq', 'denoise', 'loop', 'optimize'] as const) {
      expect(isTabActive(tab, m.effects, flags)).toBe(false);
    }
    m.effects.volume.gainDb = 3;
    m.effects.pitchTempo.enabled = true;
    m.effects.denoise.enabled = true;
    m.effects.eq.enabled = true;
    m.effects.eq.bands[0]!.gainDb = 2;
    m.effects.filters.enabled = true;
    m.effects.filters.items.push({ id: 'f', type: 'highpass', freq: 80, q: 0.7, slope: 12, gainDb: 0, enabled: true });
    for (const tab of ['volume', 'pitchTempo', 'filters', 'eq', 'denoise'] as const) expect(isTabActive(tab, m.effects, flags)).toBe(true);
    expect(isTabActive('loop', m.effects, { ...flags, loop: true })).toBe(true);
    expect(isTabActive('optimize', m.effects, { ...flags, preview: true })).toBe(true);
  });
});
