import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { resetAppStore, useAppStore, type Tab } from '../store';
import { TrackList } from './tracks/TrackList';
import { TrackInspector } from './tracks/TrackInspector';
import { Ruler } from './editor/Ruler';
import { TransportBar } from './transport/TransportBar';
import { TabBar, tabLabel } from './shell/TabBar';
import { TitleBar, isMac } from './shell/TitleBar';
import { Toolbar } from './shell/Toolbar';
import { DropOverlay, DropZone, useWindowDrop } from './import/DropZone';
import { LanguageSwitch } from './shell/LanguageSwitch';
import { Toasts } from './feedback/Toasts';
import { EditorView, spectrumHeightFor, timelineTotal } from './editor/EditorView';
import { useDevicePixelRatio } from '../hooks/useCanvas';
import { buildSpectrogramImage, MasterView, visibleSlice } from './editor/MasterView';
import { dragOffset, snapCandidates } from './editor/TrackLanes';
import { HScrollbar, thumbGeometry } from './editor/HScrollbar';
import { App } from '../App';
import { isEditableTarget, isTextTarget, shortcutFor } from '../hooks/useKeyboardShortcuts';
import { createDefaultTrack } from '@shared/types';
import type { RenderResult } from '@shared/api';

const DUR: Record<string, number> = { '/a.wav': 10, '/b.wav': 4, '/c.wav': 6 };

const state = () => useAppStore.getState();
const active = (): Tab => state().tabs.find((t) => t.id === state().activeTabId)!;

function fakeRender(duration = 10): RenderResult {
  return {
    duration,
    sampleRate: 44100,
    channels: 2,
    peaks: new Float32Array(64).map((_, i) => (i % 2 ? 0.5 : -0.5)),
    spectrogram: { width: 8, height: 4, data: new Uint8Array(32).fill(128), minFreq: 20, maxFreq: 22050, dbFloor: -100 },
    peakDb: -1,
    lufs: -14,
    averageSpectrum: new Float32Array(64),
  };
}

async function addTracks(paths = ['/a.wav', '/b.wav', '/c.wav']): Promise<void> {
  await act(async () => {
    await state().addTracksFromPaths(paths);
  });
}

beforeEach(async () => {
  globalThis.mockApi = (await import('../testing/mockApi')).installMockApi({ durationOf: (p) => DUR[p] ?? 2 });
  resetAppStore();
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function mockLayout(width = 1000, height = 400): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
    toJSON: () => ({}),
  } as DOMRect);
}

describe('TrackList', () => {
  it('shows the empty state', () => {
    render(<TrackList />);
    expect(screen.getByText(/No tracks yet/)).toBeInTheDocument();
  });

  it('lists tracks with info in a vertically scrollable list', async () => {
    await addTracks();
    render(<TrackList />);
    const list = screen.getByTestId('track-list');
    expect(list.className).toContain('overflow-y-auto');
    const items = within(list).getAllByTestId('track-item');
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByText('a.wav')).toBeInTheDocument();
    expect(within(items[0]!).getByText('44100 Hz')).toBeInTheDocument();
    expect(within(items[0]!).getByText('Stereo')).toBeInTheDocument();
    expect(within(items[0]!).getByText('0:10.0')).toBeInTheDocument();
    expect(within(items[0]!).getByText('16-bit')).toBeInTheDocument();
  });

  it('removes a track with X and undo restores it', async () => {
    await addTracks();
    const user = userEvent.setup();
    render(<TrackList />);
    await user.click(screen.getByRole('button', { name: 'Remove b.wav' }));
    expect(screen.getAllByTestId('track-item')).toHaveLength(2);
    expect(screen.queryByText('b.wav')).not.toBeInTheDocument();
    act(() => state().undo());
    expect(screen.getAllByTestId('track-item')).toHaveLength(3);
    expect(screen.getByText('b.wav')).toBeInTheDocument();
  });

  it('toggles mute / solo and selection', async () => {
    await addTracks(['/a.wav', '/b.wav']);
    const user = userEvent.setup();
    render(<TrackList />);
    const [first, second] = screen.getAllByTestId('track-item');
    await user.click(within(first!).getByRole('button', { name: 'Mute' }));
    expect(active().project.tracks[0]!.mute).toBe(true);
    expect(within(first!).getByRole('button', { name: 'Unmute' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(first!).getByRole('button', { name: 'Solo' }));
    expect(active().project.tracks[0]!.solo).toBe(true);
    await user.click(second!);
    expect(active().selectedTrackId).toBe(active().project.tracks[1]!.id);
    await user.click(second!);
    expect(active().selectedTrackId).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open files' }));
    expect(globalThis.mockApi.callsTo('openFilesDialog')).toHaveLength(1);
  });

  it('shows mono / multichannel labels', async () => {
    await addTracks(['/a.wav']);
    const id = active().project.tracks[0]!.sourceId;
    act(() => useAppStore.setState((s) => ({ sources: { ...s.sources, [id]: { ...s.sources[id]!, channels: 1, bitDepth: null } } })));
    const { rerender } = render(<TrackList />);
    expect(screen.getByText('Mono')).toBeInTheDocument();
    act(() => useAppStore.setState((s) => ({ sources: { ...s.sources, [id]: { ...s.sources[id]!, channels: 6 } } })));
    rerender(<TrackList />);
    expect(screen.getByText('6 ch')).toBeInTheDocument();
  });
});

describe('TrackInspector', () => {
  it('renders nothing without a selected track and edits the selected track', async () => {
    const { container } = render(<TrackInspector />);
    expect(container).toBeEmptyDOMElement();
    await addTracks(['/a.wav']);
    expect(screen.getByText('Clip')).toBeInTheDocument();
    const gain = screen.getAllByRole('slider')[0]!;
    fireEvent.keyDown(gain, { key: 'ArrowRight' });
    expect(active().project.tracks[0]!.gainDb).toBeGreaterThan(0);
  });

  it('collapses and remembers the collapsed state', async () => {
    await addTracks(['/a.wav']);
    const { unmount } = render(<TrackInspector />);
    const header = screen.getByRole('button', { name: /Clip/ });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryAllByRole('slider')).toHaveLength(0);
    unmount();
    render(<TrackInspector />);
    expect(screen.getByRole('button', { name: /Clip/ })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: /Clip/ }));
    expect(screen.getAllByRole('slider').length).toBeGreaterThan(0);
  });

  it('edits pan, position, clip bounds and fades', async () => {
    await addTracks(['/a.wav']);
    render(<TrackInspector />);
    const sliders = screen.getAllByRole('slider');
    // [gain, pan, fadeIn, fadeOut]
    fireEvent.keyDown(sliders[1]!, { key: 'ArrowLeft' });
    expect(active().project.tracks[0]!.pan).toBeLessThan(0);
    fireEvent.keyDown(sliders[2]!, { key: 'ArrowRight' });
    expect(active().project.tracks[0]!.fadeIn.duration).toBeGreaterThan(0);
    fireEvent.keyDown(sliders[3]!, { key: 'ArrowRight' });
    expect(active().project.tracks[0]!.fadeOut.duration).toBeGreaterThan(0);
    const setField = (name: string, value: string) => {
      const input = screen.getByRole('spinbutton', { name }) as HTMLInputElement;
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.blur(input);
    };
    setField('Position', '1.5');
    expect(active().project.tracks[0]!.offset).toBe(1.5);
    setField('Clip start', '2');
    expect(active().project.tracks[0]!.clipStart).toBe(2);
    setField('Clip end', '8');
    expect(active().project.tracks[0]!.clipEnd).toBe(8);
    setField('Clip end', '10');
    expect(active().project.tracks[0]!.clipEnd).toBeNull();
    const curves = screen.getAllByRole('combobox', { name: 'Fade curve' });
    expect(curves).toHaveLength(2);
    fireEvent.keyDown(curves[0]!, { key: 'Enter' });
    const option = await screen.findByRole('option', { name: 'S-curve' });
    fireEvent.click(option);
    await waitFor(() => expect(active().project.tracks[0]!.fadeIn.curve).toBe('sCurve'));
  });
});

describe('api accessor', () => {
  it('returns window.api or throws a coded error', async () => {
    const { getApi, hasApi } = await import('../api');
    expect(getApi()).toBe(window.api);
    expect(hasApi()).toBe(true);
    const saved = window.api;
    (window as unknown as { api?: unknown }).api = undefined;
    expect(hasApi()).toBe(false);
    expect(() => getApi()).toThrow(/^ERR_UNKNOWN/);
    window.api = saved;
  });
});

describe('Ruler (timeline seek)', () => {
  beforeEach(async () => {
    await addTracks(['/a.wav']);
    act(() => state().setRenderResult(active().id, fakeRender(10)));
  });

  it('click seeks; drag keeps seeking; release seeks to the final position', () => {
    mockLayout();
    render(<Ruler vp={{ pxPerSec: 100, scroll: 0 }} width={1000} duration={10} playhead={0} />);
    const ruler = screen.getByTestId('ruler');
    fireEvent.pointerDown(ruler, { button: 0, clientX: 150, pointerId: 1 });
    expect(globalThis.mockApi.callsTo('seek').at(-1)).toEqual([1.5]);
    fireEvent.pointerMove(ruler, { clientX: 300, pointerId: 1 });
    fireEvent.pointerUp(ruler, { clientX: 450, pointerId: 1 });
    expect(globalThis.mockApi.callsTo('seek').at(-1)).toEqual([4.5]);
    expect(active().playhead).toBe(4.5);
    fireEvent.pointerUp(ruler, { clientX: 999, pointerId: 1 }); // not dragging: ignored
    fireEvent.pointerDown(ruler, { button: 2, clientX: 900 });
    expect(active().playhead).toBe(4.5);
  });

  it('seeking while playing continues playback from the new position', async () => {
    mockLayout();
    await act(() => state().play());
    render(<Ruler vp={{ pxPerSec: 100, scroll: 0 }} width={1000} duration={10} playhead={0} />);
    fireEvent.pointerDown(screen.getByTestId('ruler'), { button: 0, clientX: 700, pointerId: 1 });
    await waitFor(() => expect(globalThis.mockApi.callsTo('seek').at(-1)).toEqual([7]));
    expect(state().transport.state).toBe('playing');
    expect(globalThis.mockApi.callsTo('stop')).toHaveLength(0);
  });

  it('keyboard arrows step and Home/End jump', async () => {
    act(() => state().setStepUnit('s1'));
    render(<Ruler vp={{ pxPerSec: 100, scroll: 0 }} width={1000} duration={10} playhead={0} />);
    const ruler = screen.getByRole('slider', { name: /Timeline/ });
    fireEvent.keyDown(ruler, { key: 'ArrowRight' });
    await waitFor(() => expect(active().playhead).toBe(1));
    fireEvent.keyDown(ruler, { key: 'End' });
    await waitFor(() => expect(active().playhead).toBe(10));
    fireEvent.keyDown(ruler, { key: 'ArrowLeft' });
    await waitFor(() => expect(active().playhead).toBe(9));
    fireEvent.keyDown(ruler, { key: 'Home' });
    await waitFor(() => expect(active().playhead).toBe(0));
    fireEvent.keyDown(ruler, { key: 'x' });
  });

  it('renders labels with milliseconds when zoomed in', () => {
    render(<Ruler vp={{ pxPerSec: 1000, scroll: 0 }} width={500} duration={10} playhead={0.2} />);
    expect(screen.getByText('0:00.100')).toBeInTheDocument();
  });
});

describe('TransportBar', () => {
  it('disables play without a render and shows times', async () => {
    render(<TransportBar />);
    expect(screen.getByRole('button', { name: /^Play/ })).toBeDisabled();
    expect(screen.getByTestId('time-position')).toHaveTextContent('00:00.000');
  });

  it('play / pause, stop, step buttons and loop toggle', async () => {
    await addTracks(['/a.wav']);
    act(() => state().setRenderResult(active().id, fakeRender(10)));
    const user = userEvent.setup();
    render(<TransportBar />);
    expect(screen.getByTestId('time-duration')).toHaveTextContent('00:10.000');
    await user.click(screen.getByRole('button', { name: /^Play/ }));
    expect(globalThis.mockApi.callsTo('play')).toEqual([[active().id]]);
    expect(screen.getByRole('button', { name: /^Pause/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Pause/ }));
    expect(globalThis.mockApi.callsTo('pause')).toHaveLength(1);
    act(() => state().setStepUnit('s1'));
    await user.click(screen.getByRole('button', { name: /Step forward/ }));
    await user.click(screen.getByRole('button', { name: /Step forward/ }));
    expect(active().playhead).toBe(2);
    expect(screen.getByTestId('time-position')).toHaveTextContent('00:02.000');
    await user.click(screen.getByRole('button', { name: /Step back/ }));
    expect(active().playhead).toBe(1);
    act(() => state().setStepUnit('ms100'));
    await user.click(screen.getByRole('button', { name: /Step back/ }));
    expect(active().playhead).toBeCloseTo(0.9);
    await user.click(screen.getByRole('button', { name: 'Loop playback' }));
    expect(globalThis.mockApi.callsTo('setLoop')).toEqual([[true]]);
    expect(screen.getByRole('button', { name: 'Loop playback' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(active().playhead).toBe(0);
    expect(screen.getByText('44100 Hz')).toBeInTheDocument();
  });

  it('follows engine transport updates', async () => {
    await addTracks(['/a.wav']);
    act(() => state().setRenderResult(active().id, fakeRender(10)));
    render(<TransportBar />);
    act(() => state().handleTransport({ state: 'playing', position: 65.25, duration: 100, sessionId: active().id, loop: false }));
    expect(screen.getByTestId('time-position')).toHaveTextContent('01:05.250');
  });
});

describe('TabBar', () => {
  it('creates, activates, renames and closes tabs', async () => {
    const user = userEvent.setup();
    render(<TabBar />);
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByText('Session 1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New tab' }));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByText('Session 1'));
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');

    await user.dblClick(screen.getByText('Session 2'));
    const input = screen.getByRole('textbox', { name: 'Rename tab' });
    await user.clear(input);
    await user.type(input, 'Footsteps{Enter}');
    expect(screen.getByText('Footsteps')).toBeInTheDocument();
    await user.dblClick(screen.getByText('Footsteps'));
    await user.type(screen.getByRole('textbox', { name: 'Rename tab' }), 'zzz{Escape}');
    expect(screen.getByText('Footsteps')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close Footsteps' }));
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    fireEvent.mouseDown(screen.getAllByRole('tab')[0]!, { button: 1 });
    await waitFor(() => expect(state().tabs[0]!.number).toBe(1));
  });

  it('shows sleeping and loading indicators', async () => {
    const t1 = active().id;
    act(() => {
      state().newTab();
    });
    await act(() => state().sleepTab(t1));
    render(<TabBar />);
    expect(screen.getByLabelText('Sleeping')).toBeInTheDocument();
    act(() => useAppStore.setState((s) => ({ tabs: s.tabs.map((t) => (t.id === t1 ? { ...t, loading: true } : t)) })));
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });

  it('labels tabs', () => {
    const t = (k: string, o?: Record<string, unknown>) => `${k}:${String(o?.n)}`;
    expect(tabLabel({ title: null, number: 4 }, t)).toBe('app.tabs.defaultName:4');
    expect(tabLabel({ title: 'X', number: 4 }, t)).toBe('X');
  });
});

describe('Import (DropZone + window drop)', () => {
  function Harness() {
    const active = useWindowDrop();
    return <DropOverlay active={active} />;
  }

  function dragEvent(type: string, files: File[] = [], types = ['Files']): Event {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'dataTransfer', { value: { types, files, dropEffect: 'none' } });
    return e;
  }

  it('shows instructions and opens dialogs', async () => {
    globalThis.mockApi.dialogFiles = ['/a.wav'];
    globalThis.mockApi.folderFiles['/f'] = ['/b.wav'];
    const user = userEvent.setup();
    render(<DropZone />);
    expect(screen.getByText('Drop audio files or folders here')).toBeInTheDocument();
    expect(screen.getByText(/\.mp3 \.wav \.aiff \.aif \.ogg \.flac/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open files' }));
    await user.click(screen.getByRole('button', { name: 'Open folder' }));
    await waitFor(() => expect(active().project.tracks).toHaveLength(2));
    const zone = screen.getByTestId('drop-zone');
    fireEvent.dragEnter(zone);
    expect(zone.className).toContain('border-accent');
    fireEvent.dragLeave(zone);
    fireEvent.dragEnter(zone);
    fireEvent.drop(zone);
    expect(zone.className).not.toContain('bg-accent-soft');
  });

  it('accepts files and folders dropped anywhere on the window', async () => {
    globalThis.mockApi.folderFiles['/sfx'] = ['/sfx/b.wav', '/sfx/c.wav'];
    render(<Harness />);
    const folder = new File([], 'sfx');
    Object.defineProperty(folder, 'path', { value: '/sfx' });
    const file = new File([], 'a.wav');
    Object.defineProperty(file, 'path', { value: '/a.wav' });
    act(() => void window.dispatchEvent(dragEvent('dragenter')));
    expect(screen.getByTestId('drop-overlay')).toBeInTheDocument();
    const over = dragEvent('dragover');
    act(() => void window.dispatchEvent(over));
    expect(over.defaultPrevented).toBe(true);
    act(() => void window.dispatchEvent(dragEvent('drop', [folder, file])));
    expect(screen.queryByTestId('drop-overlay')).not.toBeInTheDocument();
    await waitFor(() => expect(active().project.tracks.map((t) => t.name)).toEqual(['a.wav', 'b.wav', 'c.wav']));
    expect(globalThis.mockApi.callsTo('getPathForFile')).toHaveLength(2);
  });

  it('ignores non-file drags and handles leave', () => {
    render(<Harness />);
    act(() => void window.dispatchEvent(dragEvent('dragenter', [], ['text/plain'])));
    expect(screen.queryByTestId('drop-overlay')).not.toBeInTheDocument();
    act(() => void window.dispatchEvent(dragEvent('dragover', [], ['text/plain'])));
    act(() => void window.dispatchEvent(dragEvent('dragleave', [], ['text/plain'])));
    act(() => void window.dispatchEvent(dragEvent('drop', [], ['text/plain'])));
    act(() => void window.dispatchEvent(dragEvent('dragenter')));
    act(() => void window.dispatchEvent(dragEvent('dragenter')));
    act(() => void window.dispatchEvent(dragEvent('dragleave')));
    expect(screen.getByTestId('drop-overlay')).toBeInTheDocument();
    act(() => void window.dispatchEvent(dragEvent('dragleave')));
    expect(screen.queryByTestId('drop-overlay')).not.toBeInTheDocument();
    act(() => void window.dispatchEvent(dragEvent('drop', [])));
    expect(globalThis.mockApi.callsTo('expandPaths')).toHaveLength(0);
  });
});

describe('LanguageSwitch', () => {
  it('switches EN/VI, updates text by ID and persists the choice', async () => {
    const user = userEvent.setup();
    render(
      <>
        <LanguageSwitch />
        <TabBar />
      </>,
    );
    expect(screen.getByRole('radio', { name: 'EN' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Session 1')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'VI' }));
    await waitFor(() => expect(screen.getByText('Phiên 1')).toBeInTheDocument());
    expect(i18n.language).toBe('vi');
    expect(JSON.parse(localStorage.getItem('audio-customizer.settings')!).language).toBe('vi');
    expect(screen.getByRole('radio', { name: 'VI' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('radio', { name: 'EN' }));
    await waitFor(() => expect(screen.getByText('Session 1')).toBeInTheDocument());
  });
});

describe('Toasts', () => {
  it('maps error codes to translated messages and dismisses', async () => {
    const user = userEvent.setup();
    render(<Toasts />);
    act(() => state().pushError(new Error('ERR_DECODE_FAILED: bad.wav')));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not decode the audio file');
    expect(screen.getByText('bad.wav')).toBeInTheDocument();
    act(() => state().pushInfo('import.noSupportedFiles'));
    expect(screen.getByRole('status')).toHaveTextContent('No supported audio files were found');
    await user.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]!);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('auto-dismisses after a timeout', () => {
    vi.useFakeTimers();
    render(<Toasts />);
    act(() => state().pushError(new Error('ERR_IO: x')));
    expect(state().toasts).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(7000));
    expect(state().toasts).toHaveLength(0);
  });
});

describe('EditorView', () => {
  beforeEach(async () => {
    mockLayout(1000, 400);
    await addTracks(['/a.wav', '/b.wav']);
    act(() => state().setRenderResult(active().id, fakeRender(10)));
  });

  it('fits the project, draws lanes and the playhead', async () => {
    render(<EditorView />);
    await waitFor(() => expect(active().pxPerSec).toBeCloseTo(1000 / 10.5));
    expect(screen.getAllByTestId('lane')).toHaveLength(2);
    expect(screen.getByTestId('playhead')).toBeInTheDocument();
    expect(screen.getByTestId('master-view')).toBeInTheDocument();
    expect(screen.getByText('-1.0', { exact: false })).toBeInTheDocument();
    expect(screen.getByTestId('lanes-hint')).toHaveTextContent(/Drag a clip/);
  });

  it('drags a clip horizontally as one undo step (with snapping)', async () => {
    act(() => state().setViewport({ pxPerSec: 100, scroll: 0 }));
    render(<EditorView />);
    const b = active().project.tracks[1]!;
    const clip = screen.getByTestId(`clip-${b.id}`);
    const past = active().history.past.length;
    fireEvent.pointerDown(clip, { button: 0, clientX: 10, pointerId: 1 });
    fireEvent.pointerMove(clip, { clientX: 11, pointerId: 1 }); // below threshold
    fireEvent.pointerMove(clip, { clientX: 110, pointerId: 1 });
    fireEvent.pointerMove(clip, { clientX: 260, pointerId: 1 });
    fireEvent.pointerUp(clip, { clientX: 260, pointerId: 1 });
    expect(active().project.tracks[1]!.offset).toBeCloseTo(2.5);
    expect(active().history.past.length).toBe(past + 1);
    expect(active().selectedTrackId).toBe(b.id);
    // snapping to the end of a.wav (10 s): drag start to 9.95 s -> 10 s
    fireEvent.pointerDown(clip, { button: 0, clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(clip, { clientX: 745, pointerId: 1 });
    fireEvent.pointerUp(clip, { pointerId: 1 });
    expect(active().project.tracks[1]!.offset).toBeCloseTo(10);
    // Alt disables snapping
    act(() => state().setTrackOffset(b.id, 0));
    fireEvent.pointerDown(clip, { button: 0, clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(clip, { clientX: 995, altKey: true, pointerId: 1 });
    fireEvent.pointerUp(clip, { pointerId: 1 });
    expect(active().project.tracks[1]!.offset).toBeCloseTo(9.95);
    act(() => state().undo());
    expect(active().project.tracks[1]!.offset).toBe(0);
  });

  it('selects a region by dragging, seeks on click', () => {
    act(() => state().setViewport({ pxPerSec: 100, scroll: 0 }));
    render(<EditorView />);
    const lanes = screen.getByTestId('lanes-scroll');
    fireEvent.pointerDown(lanes, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(lanes, { clientX: 101, pointerId: 1 });
    fireEvent.pointerMove(lanes, { clientX: 300, pointerId: 1 });
    fireEvent.pointerUp(lanes, { clientX: 300, pointerId: 1 });
    expect(active().selection).toEqual({ start: 1, end: 3 });
    expect(screen.getByTestId('selection-overlay')).toBeInTheDocument();
    fireEvent.pointerDown(lanes, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerUp(lanes, { clientX: 500, pointerId: 1 });
    expect(active().selection).toBeNull();
    expect(active().playhead).toBe(5);
    expect(active().selectedTrackId).toBeNull();
    fireEvent.pointerMove(lanes, { clientX: 600 });
    fireEvent.pointerUp(lanes, { clientX: 600 });
    fireEvent.pointerDown(lanes, { button: 1, clientX: 600 });
    expect(active().playhead).toBe(5);
  });

  it('zooms with buttons and Ctrl+wheel, scrolls with shift+wheel', () => {
    act(() => state().setViewport({ pxPerSec: 100, scroll: 0 }));
    render(<EditorView />);
    fireEvent.click(screen.getByRole('button', { name: /Zoom in/ }));
    expect(active().pxPerSec).toBeCloseTo(125);
    fireEvent.click(screen.getByRole('button', { name: /Zoom out/ }));
    expect(active().pxPerSec).toBeCloseTo(100);
    const area = screen.getByTestId('master-view').closest('section')!.firstElementChild!;
    fireEvent.wheel(area, { deltaY: -100, ctrlKey: true, clientX: 0 });
    expect(active().pxPerSec).toBeCloseTo(125);
    fireEvent.wheel(area, { deltaY: 100, metaKey: true, clientX: 0 });
    expect(active().pxPerSec).toBeCloseTo(100);
    act(() => state().setViewport({ pxPerSec: 400 }));
    fireEvent.wheel(area, { deltaY: 200, shiftKey: true });
    expect(active().scroll).toBeCloseTo(0.5);
    fireEvent.wheel(area, { deltaY: 10 });
    expect(active().scroll).toBeCloseTo(0.5);
    fireEvent.click(screen.getByRole('button', { name: /Fit whole project/ }));
    expect(active().scroll).toBe(0);
    expect(active().pxPerSec).toBeCloseTo(1000 / 10.5);
  });

  it('keeps the playhead in view while playing', async () => {
    act(() => state().setViewport({ pxPerSec: 100, scroll: 0 }));
    render(<EditorView />);
    act(() => state().handleTransport({ state: 'playing', position: 9.99, duration: 10, sessionId: active().id, loop: false }));
    act(() => useAppStore.setState((s) => ({ tabs: s.tabs.map((t) => ({ ...t, pxPerSec: 400 })) })));
    act(() => state().handleTransport({ state: 'playing', position: 9.5, duration: 10, sessionId: active().id, loop: false }));
    await waitFor(() => expect(active().scroll).toBeGreaterThan(0));
  });
});

describe('editor helpers', () => {
  it('computes the visible spectrogram slice', () => {
    expect(visibleSlice(1000, 10, { pxPerSec: 100, scroll: 2 }, 500)).toEqual({ sx: 200, sw: 500, dx: 0, dw: 500 });
    expect(visibleSlice(1000, 10, { pxPerSec: 100, scroll: 8 }, 500)).toEqual({ sx: 800, sw: 200, dx: 0, dw: 200 });
    expect(visibleSlice(1000, 10, { pxPerSec: 100, scroll: 20 }, 500)).toBeNull();
    expect(visibleSlice(0, 10, { pxPerSec: 100, scroll: 0 }, 500)).toBeNull();
  });

  it('builds the colour-mapped spectrogram image', () => {
    const img = buildSpectrogramImage(fakeRender().spectrogram, 'magma')!;
    expect(img.width).toBe(8);
    expect(img.height).toBe(4);
    expect(buildSpectrogramImage({ ...fakeRender().spectrogram, width: 0 }, 'magma')).toBeNull();
  });

  it('renders the master view without a render', () => {
    render(<MasterView render={null} vp={{ pxPerSec: 100, scroll: 0 }} width={500} spectrumHeight={100} waveHeight={40} />);
    expect(screen.getByText('The spectrum appears here after rendering')).toBeInTheDocument();
  });

  it('flags a clipping output and shows the frequency axis', () => {
    const r = { ...fakeRender(), peakDb: 2.5 };
    const { rerender } = render(<MasterView render={r} vp={{ pxPerSec: 100, scroll: 0 }} width={500} spectrumHeight={100} waveHeight={40} />);
    const peak = screen.getByText('Peak 2.5 dB');
    expect(peak).toHaveAttribute('data-clipping', 'true');
    expect(peak).toHaveAttribute('title', expect.stringMatching(/clip/));
    expect(screen.getByTestId('freq-axis')).toBeInTheDocument();
    rerender(<MasterView render={fakeRender()} vp={{ pxPerSec: 100, scroll: 0 }} width={500} spectrumHeight={100} waveHeight={40} />);
    expect(screen.getByText('Peak -1.0 dB')).not.toHaveAttribute('data-clipping');
  });

  it('sizes the spectrogram with the editor height', () => {
    expect(spectrumHeightFor(0)).toBe(196);
    expect(spectrumHeightFor(300)).toBe(150);
    expect(spectrumHeightFor(700)).toBe(238);
    expect(spectrumHeightFor(2000)).toBe(360);
  });

  it('tracks the device pixel ratio', () => {
    let listener: (() => void) | null = null;
    const spy = vi.spyOn(window, 'matchMedia').mockImplementation(
      (q: string) =>
        ({
          media: q,
          matches: true,
          addEventListener: (_: string, cb: () => void) => {
            listener = cb;
          },
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
    const seen: number[] = [];
    function Probe() {
      seen.push(useDevicePixelRatio());
      return null;
    }
    render(<Probe />);
    expect(seen.at(-1)).toBe(window.devicePixelRatio || 1);
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    act(() => listener?.());
    expect(seen.at(-1)).toBe(2);
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
    spy.mockRestore();
  });

  it('computes clip drag offsets with snapping', () => {
    expect(dragOffset(1, 100, 100, 2, null)).toBe(2);
    expect(dragOffset(1, -500, 100, 2, null)).toBe(0);
    expect(dragOffset(1, 96, 100, 2, [2])).toBe(2); // start snaps
    expect(dragOffset(0, 296, 100, 2, [5])).toBe(3); // end snaps to 5
    expect(dragOffset(0, 150, 100, 2, [5])).toBe(1.5);
    const tracks = [createDefaultTrack('a', 's1', 'a', 1), createDefaultTrack('b', 's2', 'b', 3)];
    const sources = { s1: { duration: 2 }, s2: { duration: 4 } } as never;
    expect(snapCandidates(tracks, 'b', sources, 7)).toEqual([0, 7, 1, 3]);
  });

  it('computes timeline totals and scrollbar geometry', () => {
    expect(timelineTotal(10, 5)).toBeCloseTo(11);
    expect(timelineTotal(1, 50)).toBe(50);
    expect(thumbGeometry(100, 100, 0)).toEqual({ left: 0, width: 100 });
    expect(thumbGeometry(100, 25, 75)).toEqual({ left: 75, width: 25 });
    expect(thumbGeometry(100, 1, 0).width).toBe(4);
  });

  it('scrollbar drag and track click scroll the timeline', () => {
    mockLayout(400, 10);
    const onScroll = vi.fn();
    render(<HScrollbar total={100} view={25} scroll={0} onScroll={onScroll} />);
    const thumb = screen.getByTestId('hscroll-thumb');
    fireEvent.pointerDown(thumb, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(thumb, { clientX: 100, pointerId: 1 });
    expect(onScroll).toHaveBeenLastCalledWith(25);
    fireEvent.pointerUp(thumb, { pointerId: 1 });
    fireEvent.pointerMove(thumb, { clientX: 300, pointerId: 1 });
    expect(onScroll).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(screen.getByRole('scrollbar'), { clientX: 200 });
    expect(onScroll).toHaveBeenLastCalledWith(37.5);
  });
});

describe('keyboard shortcuts', () => {
  const ev = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}, target: EventTarget | null = document.body) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    target,
    ...mods,
  });

  it('maps keys to actions', () => {
    expect(shortcutFor(ev(' '))).toBe('togglePlay');
    expect(shortcutFor(ev('z', { ctrlKey: true }))).toBe('undo');
    expect(shortcutFor(ev('Z', { metaKey: true, shiftKey: true }))).toBe('redo');
    expect(shortcutFor(ev('y', { ctrlKey: true }))).toBe('redo');
    expect(shortcutFor(ev('a', { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(ev('ArrowLeft'))).toBe('stepBack');
    expect(shortcutFor(ev('ArrowRight'))).toBe('stepForward');
    expect(shortcutFor(ev('Delete'))).toBe('deleteSelection');
    expect(shortcutFor(ev('s'))).toBe('split');
    expect(shortcutFor(ev('s', { altKey: true }))).toBeNull();
    expect(shortcutFor(ev('q'))).toBeNull();
    const input = document.createElement('input');
    expect(shortcutFor(ev(' ', {}, input))).toBeNull();
    expect(shortcutFor(ev('z', { ctrlKey: true }, input))).toBe('undo');
  });

  it('Space still plays/pauses on sliders and the ruler, arrows stay with the slider', () => {
    const slider = document.createElement('div');
    slider.setAttribute('role', 'slider');
    expect(shortcutFor(ev(' ', {}, slider))).toBe('togglePlay');
    expect(shortcutFor(ev('ArrowLeft', {}, slider))).toBeNull();
    const spin = document.createElement('div');
    spin.setAttribute('role', 'spinbutton');
    expect(isTextTarget(spin)).toBe(false);
    const ta = document.createElement('textarea');
    expect(isTextTarget(ta)).toBe(true);
    expect(shortcutFor(ev(' ', {}, ta))).toBeNull();
    const combo = document.createElement('button');
    combo.setAttribute('role', 'combobox');
    expect(shortcutFor(ev(' ', {}, combo))).toBeNull();
  });

  it('detects editable targets', () => {
    const mk = (tag: string, attrs: Record<string, string> = {}) => {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      return el;
    };
    expect(isEditableTarget(mk('textarea'))).toBe(true);
    expect(isEditableTarget(mk('input', { type: 'number' }))).toBe(true);
    expect(isEditableTarget(mk('input', { type: 'checkbox' }))).toBe(false);
    expect(isEditableTarget(mk('div', { role: 'slider' }))).toBe(true);
    expect(isEditableTarget(mk('button'))).toBe(false);
    const ce = mk('div');
    Object.defineProperty(ce, 'isContentEditable', { value: true });
    expect(isEditableTarget(ce)).toBe(true);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('App shell', () => {
  it('shows the empty state, then the editor; global shortcuts work', async () => {
    mockLayout();
    const user = userEvent.setup();
    render(<App engine={false} />);
    expect(screen.getByTestId('drop-zone')).toBeInTheDocument();
    expect(screen.getByText('Audio Customizer')).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('dark');
    await addTracks(['/a.wav', '/b.wav']);
    expect(screen.queryByTestId('drop-zone')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('lane')).toHaveLength(2);
    act(() => state().setRenderResult(active().id, fakeRender(10)));

    await user.keyboard(' ');
    expect(globalThis.mockApi.callsTo('play')).toHaveLength(1);
    act(() => state().setStepUnit('s1'));
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(active().playhead).toBe(1));
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(active().playhead).toBe(0));

    act(() => state().removeTrack(active().project.tracks[0]!.id));
    expect(active().project.tracks).toHaveLength(1);
    await user.keyboard('{Control>}z{/Control}');
    expect(active().project.tracks).toHaveLength(2);
    await user.keyboard('{Control>}y{/Control}');
    expect(active().project.tracks).toHaveLength(1);
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    await user.keyboard('{Control>}z{/Control}');
    expect(active().project.tracks).toHaveLength(2);

    act(() => state().setPlayhead(2));
    await user.keyboard('s');
    expect(active().project.tracks.length).toBe(4);
    act(() => state().setSelection({ start: 0, end: 1 }));
    await user.keyboard('{Delete}');
    expect(active().selection).toBeNull();
  });

  it('toolbar buttons drive the store', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    expect(screen.getByRole('button', { name: /^Undo/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Open folder' }));
    expect(globalThis.mockApi.callsTo('openFolderDialog')).toHaveLength(1);
    await addTracks(['/a.wav', '/b.wav']);
    expect(screen.getByRole('button', { name: /^Undo/ })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /^Undo/ }));
    expect(active().project.tracks).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: /^Redo/ }));
    expect(active().project.tracks).toHaveLength(2);
    act(() => state().setPlayhead(1));
    await user.click(screen.getByRole('button', { name: /Split at playhead/ }));
    expect(active().project.tracks).toHaveLength(4);
    act(() => state().setSelection({ start: 0, end: 0.5 }));
    await user.click(screen.getByRole('button', { name: 'Trim to selection' }));
    act(() => state().setSelection({ start: 0, end: 0.25 }));
    await user.click(screen.getByRole('button', { name: /Delete selected region/ }));
    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(state().settings.theme).toBe('light');
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(state().settings.theme).toBe('dark');
  });

  it('arrange popover joins tracks', async () => {
    await addTracks(['/a.wav', '/b.wav']);
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Join' }));
    const gap = await screen.findByRole('spinbutton', { name: 'Silence between' }).catch(() => screen.getByLabelText('Silence between'));
    expect(gap).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Join tracks' }));
    expect(active().project.tracks[1]!.offset).toBe(10);
  });

  it('settings popover changes sleep minutes and snapping', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByText('Sleep inactive tabs after')).toBeInTheDocument();
    await user.click(screen.getByRole('switch'));
    expect(state().settings.snap).toBe(false);
  });

  it('shows the waking state of a tab', () => {
    act(() => useAppStore.setState((s) => ({ tabs: s.tabs.map((t) => ({ ...t, loading: true })) })));
    render(<App engine={false} />);
    expect(screen.getByText(/Waking the tab up/)).toBeInTheDocument();
  });

  it('title bar reserves space for window controls', () => {
    render(<TitleBar />);
    expect(screen.getByRole('banner').className).toContain(isMac() ? 'pl-[78px]' : 'pr-[140px]');
    // app logo next to the name, dark bar matching the native window controls
    expect(screen.getByTestId('title-bar').querySelector('img')).toHaveAttribute('src', expect.stringMatching(/logo|svg/));
    expect(screen.getByRole('banner').className).toContain('bg-[var(--color-titlebar)]');
  });

  it('starts the engine bindings', async () => {
    render(<App />);
    await waitFor(() => expect(globalThis.mockApi.listenerCount()).toBe(1));
  });
});
