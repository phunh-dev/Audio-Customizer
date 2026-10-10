import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { getStore, resetAppStore, selectActiveTab } from '@renderer/store';
import { setEnglish } from '@renderer/components/ui/testUtils';
import EffectsPanelDefault, { EffectsPanel } from './EffectsPanel';

beforeAll(setEnglish);
beforeEach(() => resetAppStore());

const tab = () => selectActiveTab(getStore());

describe('EffectsPanel', () => {
  it('has default and named exports and renders all effect tabs', () => {
    expect(EffectsPanelDefault).toBe(EffectsPanel);
    render(<EffectsPanel />);
    const panel = screen.getByTestId('effects-panel');
    const tabs = within(panel).getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Volume', 'Pitch & Tempo', 'Filters', 'EQ', 'Denoise', 'Loop', 'Optimize']);
    expect(screen.getByRole('combobox', { name: 'Target' })).toHaveTextContent('Master (mixed output)');
    expect(screen.getByRole('region', { name: 'Volume' })).toBeInTheDocument();
  });

  it('switches sections with the tabs', () => {
    render(<EffectsPanel />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /EQ/ }));
    expect(screen.getByRole('region', { name: 'Equalizer (16 bands)' })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Denoise/ }));
    expect(screen.getByRole('region', { name: 'Noise reduction' })).toBeInTheDocument();
  });

  it('edits the selected track; loop/optimize are master only', async () => {
    await act(async () => {
      await getStore().addTracksFromPaths(['C:/a/voice.wav']);
    });
    const track = tab().project.tracks[0]!;
    render(<EffectsPanel defaultTab="loop" />);
    expect(screen.getByRole('combobox', { name: 'Target' })).toHaveTextContent('Track: voice.wav');
    expect(screen.getByRole('tab', { name: /Loop/ })).toBeDisabled();
    expect(screen.getByRole('tab', { name: /Optimize/ })).toBeDisabled();
    // falls back to Volume for a track
    expect(screen.getByRole('region', { name: 'Volume' })).toBeInTheDocument();
    expect(screen.getByText(/Editing track "voice.wav"/)).toBeInTheDocument();

    const gain = screen.getByRole('slider', { name: 'Gain' });
    fireEvent.keyDown(gain, { key: 'ArrowRight' });
    expect(tab().project.tracks[0]!.effects.volume.gainDb).toBeCloseTo(0.1);
    expect(tab().project.master.effects.volume.gainDb).toBe(0);
    expect(track.id).toBe(tab().selectedTrackId);

    // switch target to master
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Target' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('option', { name: 'Master (mixed output)' }));
    expect(screen.getByRole('combobox', { name: 'Target' })).toHaveTextContent('Master (mixed output)');
    expect(screen.getByRole('tab', { name: /Loop/ })).toBeEnabled();
    // the remembered Loop tab is available again on the master
    expect(screen.getByRole('region', { name: 'Seamless loop' })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Volume/ }));
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Gain' }), { key: 'ArrowLeft' });
    expect(tab().project.master.effects.volume.gainDb).toBeCloseTo(-0.1);
  });

  it('marks tabs whose effect is active', () => {
    render(<EffectsPanel />);
    expect(screen.queryByTestId('tab-active-pitchTempo')).toBeNull();
    act(() => getStore().updateEffects('master', (c) => void (c.pitchTempo.enabled = true)));
    expect(screen.getByTestId('tab-active-pitchTempo')).toBeInTheDocument();
  });
});
