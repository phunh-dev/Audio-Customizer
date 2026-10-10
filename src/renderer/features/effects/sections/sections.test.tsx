import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { EQ_FREQS } from '@shared/types';
import { getStore, resetAppStore, selectActiveTab } from '@renderer/store';
import { chooseOption, setEnglish } from '@renderer/components/ui/testUtils';
import { EffectsPanel } from '../EffectsPanel';
import { getEqPreset } from '../eqPresets';

beforeAll(setEnglish);
beforeEach(() => resetAppStore());

const master = () => selectActiveTab(getStore()).project.master;
const fx = () => master().effects;
const undoSteps = () => selectActiveTab(getStore()).history.past.length;

function typeInto(name: string, value: string) {
  const f = screen.getByRole('spinbutton', { name });
  fireEvent.focus(f);
  fireEvent.change(f, { target: { value } });
  fireEvent.keyDown(f, { key: 'Enter' });
}

describe('Volume section', () => {
  it('renders every volume parameter and writes through the store', () => {
    render(<EffectsPanel defaultTab="volume" />);
    expect(screen.getByRole('slider', { name: 'Gain' })).toHaveAttribute('aria-valuemin', '-60');
    expect(screen.getByRole('slider', { name: 'Gain' })).toHaveAttribute('aria-valuemax', '24');
    expect(screen.getByRole('radiogroup', { name: 'Normalize' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Limiter' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Ceiling' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Release' })).toBeInTheDocument();

    typeInto('Gain', '-6.5');
    expect(fx().volume.gainDb).toBe(-6.5);

    fireEvent.click(screen.getByRole('radio', { name: 'LUFS' }));
    expect(fx().volume.normalize).toBe('lufs');
    expect(fx().volume.normalizeTarget).toBe(-14);
    expect(screen.getByRole('slider', { name: 'Loudness target' })).toHaveAttribute('aria-valuenow', '-14');
    fireEvent.click(screen.getByRole('radio', { name: 'Peak' }));
    expect(fx().volume.normalizeTarget).toBe(-1);
    typeInto('Peak target', '-3');
    expect(fx().volume.normalizeTarget).toBe(-3);

    fireEvent.click(screen.getByRole('switch', { name: 'Limiter' }));
    expect(fx().volume.limiter).toBe(true);
    typeInto('Ceiling', '-0.3');
    typeInto('Release', '120');
    expect(fx().volume).toMatchObject({ limiterCeilingDb: -0.3, limiterReleaseMs: 120 });

    fireEvent.click(screen.getByRole('button', { name: 'Reset Volume to defaults' }));
    expect(fx().volume).toEqual({ gainDb: 0, normalize: 'off', normalizeTarget: -1, limiter: false, limiterCeilingDb: -1, limiterReleaseMs: 50 });
  });

  it('a slider gesture is one undo step', () => {
    render(<EffectsPanel defaultTab="volume" />);
    const before = undoSteps();
    typeInto('Gain', '3');
    expect(undoSteps()).toBe(before + 1);
    act(() => getStore().undo());
    expect(fx().volume.gainDb).toBe(0);
  });
});

describe('Pitch & Tempo section', () => {
  it('renders all parameters and updates the store', () => {
    render(<EffectsPanel defaultTab="pitchTempo" />);
    const semi = screen.getByRole('slider', { name: 'Semitones' });
    expect(semi).toHaveAttribute('aria-valuemin', '-24');
    expect(screen.getByRole('slider', { name: 'Cents' })).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByRole('slider', { name: 'Tempo' })).toHaveAttribute('aria-valuemin', '25');
    expect(screen.getByRole('slider', { name: 'Tempo' })).toHaveAttribute('aria-valuemax', '400');

    fireEvent.click(screen.getByRole('switch', { name: 'Enable Pitch & Tempo' }));
    expect(fx().pitchTempo.enabled).toBe(true);
    fireEvent.keyDown(semi, { key: 'ArrowUp' });
    fireEvent.keyDown(semi, { key: 'ArrowUp' });
    expect(fx().pitchTempo.semitones).toBe(2);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Cents' }), { key: 'ArrowDown' });
    expect(fx().pitchTempo.cents).toBe(-1);
    fireEvent.click(screen.getByRole('button', { name: '150%' }));
    expect(fx().pitchTempo.tempo).toBe(150);
    fireEvent.click(screen.getByRole('radio', { name: 'Varispeed' }));
    expect(fx().pitchTempo.mode).toBe('varispeed');
    expect(screen.getByText(/Tape-style/)).toBeInTheDocument();
    expect(screen.getByText(/Result: pitch ×/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset Pitch & Tempo to defaults' }));
    expect(fx().pitchTempo).toEqual({ enabled: true, semitones: 0, cents: 0, tempo: 100, mode: 'stretch' });
  });
});

describe('Filters section', () => {
  it('adds, edits and removes bands', () => {
    render(<EffectsPanel defaultTab="filters" />);
    expect(screen.getByText(/No filter yet/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Combined filter frequency response' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    expect(fx().filters.enabled).toBe(true);
    expect(fx().filters.items).toHaveLength(1);
    expect(fx().filters.items[0]).toMatchObject({ type: 'highpass', freq: 80, slope: 12, enabled: true });

    const band = screen.getByRole('listitem', { name: 'Filter 1 (High-pass)' });
    const freq = within(band).getByRole('slider', { name: 'Frequency' });
    expect(freq).toHaveAttribute('aria-valuemin', '20');
    expect(freq).toHaveAttribute('aria-valuemax', '20000');
    const freqField = within(band).getByRole('spinbutton', { name: 'Frequency' });
    fireEvent.focus(freqField);
    fireEvent.change(freqField, { target: { value: '1.2k' } });
    fireEvent.keyDown(freqField, { key: 'Enter' });
    expect(fx().filters.items[0]!.freq).toBe(1200);

    const q = within(band).getByRole('spinbutton', { name: 'Q' });
    fireEvent.focus(q);
    fireEvent.change(q, { target: { value: '30' } });
    fireEvent.keyDown(q, { key: 'Enter' });
    expect(fx().filters.items[0]!.q).toBe(18); // clamped

    fireEvent.click(within(band).getByRole('radio', { name: '24 dB/oct' }));
    expect(fx().filters.items[0]!.slope).toBe(24);
    expect(within(band).getByRole('slider', { name: 'Q' })).toHaveAttribute('data-disabled');

    chooseOption(within(band).getByRole('combobox', { name: 'Filter type' }), 'Low shelf');
    expect(fx().filters.items[0]!.type).toBe('lowshelf');
    const shelf = screen.getByRole('listitem', { name: 'Filter 1 (Low shelf)' });
    expect(within(shelf).queryByRole('radiogroup', { name: 'Slope' })).toBeNull();
    const gain = within(shelf).getByRole('spinbutton', { name: 'Gain' });
    fireEvent.focus(gain);
    fireEvent.change(gain, { target: { value: '4.5' } });
    fireEvent.keyDown(gain, { key: 'Enter' });
    expect(fx().filters.items[0]!.gainDb).toBe(4.5);

    fireEvent.click(within(shelf).getByRole('switch', { name: 'Enable Filter 1 (Low shelf)' }));
    expect(fx().filters.items[0]!.enabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    expect(fx().filters.items[1]!.type).toBe('highpass');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Filter 1 (Low shelf)' }));
    expect(fx().filters.items.map((b) => b.type)).toEqual(['highpass']);
    fireEvent.click(screen.getByRole('button', { name: 'Reset Filters to defaults' }));
    expect(fx().filters.items).toEqual([]);
  });
});

describe('EQ section', () => {
  it('renders 16 faders at the contract frequencies with ±18 dB', () => {
    render(<EffectsPanel defaultTab="eq" />);
    const group = screen.getByRole('group', { name: 'Equalizer bands' });
    const faders = within(group).getAllByRole('slider');
    expect(faders).toHaveLength(16);
    expect(EQ_FREQS).toHaveLength(16);
    for (const f of faders) {
      expect(f).toHaveAttribute('aria-valuemin', '-18');
      expect(f).toHaveAttribute('aria-valuemax', '18');
    }
    expect(screen.getByRole('img', { name: 'Equalizer frequency response' })).toBeInTheDocument();
  });

  it('fader, Q knob, presets, reset and bypass write through the store', () => {
    render(<EffectsPanel defaultTab="eq" />);
    const f1k = screen.getAllByRole('slider', { name: 'Gain at 1 kHz' })[0]!;
    fireEvent.keyDown(f1k, { key: 'End' });
    expect(fx().eq.bands[8]!.gainDb).toBe(18);

    // select the 63 Hz band and edit its Q
    fireEvent.focus(screen.getAllByRole('slider', { name: 'Gain at 63 Hz' })[0]!);
    expect(screen.getByRole('group', { name: 'Band 63 Hz' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Q at 63 Hz' }), { key: 'End' });
    expect(fx().eq.bands[2]!.q).toBe(18);
    fireEvent.click(screen.getByRole('button', { name: 'Reset band 63 Hz' }));
    expect(fx().eq.bands[2]).toEqual({ freq: 63, gainDb: 0, q: 1.4 });

    expect(screen.getByRole('combobox', { name: 'Preset' })).toHaveTextContent('Custom');
    chooseOption(screen.getByRole('combobox', { name: 'Preset' }), 'Vocal presence');
    expect(fx().eq.enabled).toBe(true);
    expect(fx().eq.bands.map((b) => b.gainDb)).toEqual([...getEqPreset('vocalPresence').gains]);
    expect(screen.getByRole('combobox', { name: 'Preset' })).toHaveTextContent('Vocal presence');

    fireEvent.click(screen.getByRole('switch', { name: 'Enable Equalizer (16 bands)' }));
    expect(fx().eq.enabled).toBe(false); // bypass

    fireEvent.click(screen.getByRole('button', { name: 'Reset Equalizer (16 bands) to defaults' }));
    expect(fx().eq.bands.every((b) => b.gainDb === 0 && b.q === 1.4)).toBe(true);
  });
});

describe('Denoise section', () => {
  it('renders all parameters, learns the profile from the selection and clears it', () => {
    render(<EffectsPanel defaultTab="denoise" />);
    expect(screen.getByRole('radiogroup', { name: 'Algorithm' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Reduction' })).toHaveAttribute('aria-valuemax', '48');
    expect(screen.getByRole('slider', { name: 'Sensitivity' })).toHaveAttribute('aria-valuemax', '24');
    expect(screen.getByRole('slider', { name: 'Frequency smoothing' })).toHaveAttribute('aria-valuemax', '1');
    expect(screen.getByRole('slider', { name: 'Attack' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Release' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: 'Enable Noise reduction' }));
    fireEvent.click(screen.getByRole('radio', { name: 'RNNoise (voice)' }));
    expect(fx().denoise).toMatchObject({ enabled: true, mode: 'rnnoise' });
    typeInto('Reduction', '24');
    typeInto('Sensitivity', '9');
    typeInto('Frequency smoothing', '0.8');
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Attack' }), { key: 'ArrowUp' });
    expect(fx().denoise).toMatchObject({ reductionDb: 24, sensitivityDb: 9, smoothing: 0.8, attackMs: 6 });
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Release' }), { key: 'End' });
    expect(fx().denoise.releaseMs).toBe(2000);

    const learn = screen.getByRole('button', { name: 'Learn from selection' });
    expect(learn).toBeDisabled();
    act(() => getStore().setSelection({ start: 0.25, end: 0.75 }));
    fireEvent.click(screen.getByRole('button', { name: 'Learn from selection' }));
    expect(fx().denoise).toMatchObject({ profileStart: 0.25, profileEnd: 0.75 });
    expect(screen.getByTestId('denoise-profile')).toHaveTextContent('0:00.250 – 0:00.750');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(fx().denoise).toMatchObject({ profileStart: null, profileEnd: null });
    expect(screen.getByTestId('denoise-profile')).toHaveTextContent('Automatic (estimated)');
  });
});

describe('Loop section', () => {
  it('renders all loop parameters and writes the master loop settings', () => {
    render(<EffectsPanel defaultTab="loop" />);
    fireEvent.click(screen.getByRole('switch', { name: 'Enable Seamless loop' }));
    expect(master().loop.enabled).toBe(true);
    expect(screen.getByRole('slider', { name: 'Crossfade' })).toHaveAttribute('aria-valuemax', '5000');
    typeInto('Crossfade', '250');
    expect(master().loop.crossfadeMs).toBe(250);
    chooseOption(screen.getByRole('combobox', { name: 'Crossfade curve' }), 'S-curve');
    expect(master().loop.curve).toBe('sCurve');

    expect(screen.getByTestId('loop-region')).toHaveTextContent('Whole output');
    expect(screen.getByRole('button', { name: 'Use selection' })).toBeDisabled();
    act(() => getStore().setSelection({ start: 1, end: 3.5 }));
    fireEvent.click(screen.getByRole('button', { name: 'Use selection' }));
    expect(master().loop).toMatchObject({ start: 1, end: 3.5 });
    expect(screen.getByTestId('loop-region')).toHaveTextContent('0:01.000 – 0:03.500');
    fireEvent.click(screen.getByRole('button', { name: 'Whole output' }));
    expect(master().loop).toMatchObject({ start: null, end: null });

    fireEvent.click(screen.getByRole('switch', { name: 'Snap to zero crossings' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Match loudness' }));
    expect(master().loop).toMatchObject({ zeroCrossing: false, matchLoudness: true });
    expect(screen.getByText(/Tip: enable Loop playback/)).toBeInTheDocument();
  });
});

describe('Optimize section', () => {
  it('applies quick presets, toggles export preview and edits trim silence', async () => {
    await act(async () => {
      await getStore().addTracksFromPaths(['C:/a/shot.wav']);
    });
    act(() => getStore().selectTrack(null));
    render(<EffectsPanel defaultTab="optimize" />);
    const tab = () => selectActiveTab(getStore());

    fireEvent.click(screen.getByRole('button', { name: /SFX mobile/ }));
    expect(tab().exportOptions).toMatchObject({ format: 'ogg', sampleRate: 22050, channels: 'mono', bitrateMode: 'vbr', vbrQuality: 0.4 });
    expect(master().trimSilence.enabled).toBe(true);
    expect(screen.getByRole('button', { name: /SFX mobile/ })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: /Voice \/ dialogue/ }));
    expect(tab().exportOptions).toMatchObject({ format: 'mp3', sampleRate: 22050, bitrateKbps: 64, bitrateMode: 'cbr' });

    fireEvent.click(screen.getByRole('switch', { name: 'Preview with export settings' }));
    expect(tab().previewExport).toMatchObject({ format: 'mp3', sampleRate: 22050 });
    // changing options while previewing updates the preview
    fireEvent.click(screen.getByRole('button', { name: /Lossless master/ }));
    expect(tab().previewExport).toMatchObject({ format: 'flac', sampleRate: 48000, bitDepth: 24 });
    fireEvent.click(screen.getByRole('switch', { name: 'Preview with export settings' }));
    expect(tab().previewExport).toBeNull();

    // sample-rate choices with hints
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Sample rate' }), { key: 'Enter' });
    const opts = screen.getAllByRole('option');
    expect(opts.find((o) => o.textContent?.startsWith('22.05 kHz'))).toHaveTextContent('Recommended for mobile SFX');
    expect(opts.find((o) => o.textContent?.startsWith('Keep'))).toBeDefined();
    fireEvent.click(screen.getByRole('option', { name: '16 kHz' }));
    expect(tab().exportOptions.sampleRate).toBe(16000);

    expect(screen.getByTestId('size-source')).not.toHaveTextContent('-');
    await waitFor(() => expect(screen.getByTestId('size-after')).not.toHaveTextContent('estimating'));

    expect(master().trimSilence.enabled).toBe(false); // lossless master preset turned it off
    fireEvent.click(screen.getByRole('switch', { name: 'Enable Trim silence' }));
    expect(master().trimSilence.enabled).toBe(true);
    typeInto('Threshold', '-50');
    typeInto('Padding', '25');
    expect(master().trimSilence).toMatchObject({ thresholdDb: -50, padMs: 25 });
  });
});
