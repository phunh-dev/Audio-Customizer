import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { getStore, resetAppStore, selectActiveTab } from '@renderer/store';
import { setEnglish } from '@renderer/components/ui/testUtils';
import { ExportDialog } from './ExportDialog';

beforeAll(setEnglish);

async function withTrack(): Promise<void> {
  await act(async () => {
    await getStore().addTracksFromPaths(['C:/sfx/kick.wav']);
  });
}

function exportButton() {
  return screen.getByRole('button', { name: 'Export…' });
}

describe('ExportDialog', () => {
  beforeEach(() => {
    resetAppStore();
  });

  it('renders every export option for a lossless format', async () => {
    await withTrack();
    render(<ExportDialog open onOpenChange={() => undefined} />);
    const dialog = screen.getByRole('dialog', { name: 'Export audio' });
    expect(within(dialog).getByRole('radiogroup', { name: 'Format' })).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Sample rate' })).toHaveTextContent('Keep (44.1 kHz)');
    expect(within(dialog).getByRole('radiogroup', { name: 'Channels' })).toBeInTheDocument();
    expect(within(dialog).getByRole('radiogroup', { name: 'Bit depth' })).toBeInTheDocument();
    expect(within(dialog).getByRole('switch', { name: 'Dither' })).toBeChecked();
    expect(within(dialog).getByRole('radiogroup', { name: 'Resample quality' })).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('kick.wav')).toBeInTheDocument();
    expect(within(dialog).queryByRole('radiogroup', { name: 'Bitrate mode' })).toBeNull();
  });

  it('opens with the Export button focused (not the close button and its tooltip)', async () => {
    await withTrack();
    render(<ExportDialog open onOpenChange={() => undefined} />);
    await waitFor(() => expect(exportButton()).toHaveFocus());
    expect(screen.getByTestId('export-confirm')).toBe(exportButton());
  });

  it('switching to MP3 hides bit depth, shows bitrate list and restricts sample rates', async () => {
    await withTrack();
    render(<ExportDialog open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole('radio', { name: 'MP3' }));
    expect(selectActiveTab(getStore()).exportOptions.format).toBe('mp3');
    expect(screen.queryByRole('radiogroup', { name: 'Bit depth' })).toBeNull();
    expect(screen.getByRole('radiogroup', { name: 'Bitrate mode' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Bitrate' })).toHaveTextContent('192 kbps');
    expect(screen.getByDisplayValue('kick.mp3')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Sample rate' }), { key: 'Enter' });
    const labels = screen.getAllByRole('option').map((o) => o.textContent ?? '');
    expect(labels.some((l) => l.startsWith('96 kHz'))).toBe(false);
    expect(labels.some((l) => l.startsWith('24 kHz'))).toBe(true);
    fireEvent.click(screen.getAllByRole('option').find((o) => (o.textContent ?? '').startsWith('22.05 kHz'))!);
    await waitFor(() => expect(selectActiveTab(getStore()).exportOptions.sampleRate).toBe(22050));
  });

  it('VBR shows the quality slider; OGG CBR shows a 32–320 kbps slider', async () => {
    await withTrack();
    render(<ExportDialog open onOpenChange={() => undefined} />);
    fireEvent.click(screen.getByRole('radio', { name: 'OGG' }));
    const br = screen.getByRole('slider', { name: 'Bitrate' });
    expect(br).toHaveAttribute('aria-valuemin', '32');
    expect(br).toHaveAttribute('aria-valuemax', '320');
    fireEvent.click(screen.getByRole('radio', { name: 'VBR' }));
    expect(screen.getByRole('slider', { name: 'VBR quality' })).toHaveAttribute('aria-valuenow', '0.7');
  });

  it('cancel in the save dialog -> no success state, nothing reported as saved', async () => {
    await withTrack();
    const spy = vi.spyOn(globalThis.mockApi, 'exportAudio').mockResolvedValue({ canceled: true });
    render(<ExportDialog open onOpenChange={() => undefined} />);
    fireEvent.click(exportButton());
    await screen.findByText('Export canceled: nothing was saved.');
    expect(spy).toHaveBeenCalledTimes(1);
    const [sessionId, project, options, name] = spy.mock.calls[0]!;
    expect(sessionId).toBe(getStore().activeTabId);
    expect(project.tracks).toHaveLength(1);
    expect(options.format).toBe('wav');
    expect(name).toBe('kick.wav');
    expect(screen.queryByText('Export complete')).toBeNull();
    expect(screen.queryByTestId('export-path')).toBeNull();
  });

  it('ok -> shows the saved path and size', async () => {
    await withTrack();
    vi.spyOn(globalThis.mockApi, 'exportAudio').mockResolvedValue({ canceled: false, path: 'D:/out/kick.wav', bytes: 2048 });
    const onOpenChange = vi.fn();
    render(<ExportDialog open onOpenChange={onOpenChange} />);
    fireEvent.click(exportButton());
    expect(await screen.findByText('Export complete')).toBeInTheDocument();
    expect(screen.getByTestId('export-path')).toHaveTextContent('D:/out/kick.wav');
    expect(screen.getByText('2 KB (2048 bytes)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows progress while exporting', async () => {
    await withTrack();
    let resolve!: (v: { canceled: boolean }) => void;
    vi.spyOn(globalThis.mockApi, 'exportAudio').mockReturnValue(new Promise((r) => (resolve = r)));
    render(<ExportDialog open onOpenChange={() => undefined} />);
    fireEvent.click(exportButton());
    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
    expect(exportButton()).toBeDisabled();
    await act(async () => resolve({ canceled: true }));
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('error -> shows the translated error code and detail', async () => {
    await withTrack();
    vi.spyOn(globalThis.mockApi, 'exportAudio').mockRejectedValue(new Error('ERR_ENCODE_FAILED: lame exploded'));
    render(<ExportDialog open onOpenChange={() => undefined} />);
    fireEvent.click(exportButton());
    const alert = await screen.findByText('Export failed');
    const box = alert.closest('[role="alert"]') as HTMLElement;
    expect(box).toHaveTextContent('lame exploded');
    expect(within(box).getAllByText(/./).length).toBeGreaterThan(1);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('never exports an empty project', async () => {
    const spy = vi.spyOn(globalThis.mockApi, 'exportAudio');
    render(<ExportDialog open onOpenChange={() => undefined} />);
    expect(screen.getByText('There is no audio to export yet. Add a file first.')).toBeInTheDocument();
    expect(exportButton()).toBeDisabled();
    fireEvent.click(exportButton());
    expect(spy).not.toHaveBeenCalled();
  });

  it('blocks invalid options with an i18n validation message', async () => {
    await withTrack();
    const tab = selectActiveTab(getStore());
    act(() => getStore().setExportOptions({ ...tab.exportOptions, format: 'mp3', sampleRate: 96000 }));
    render(<ExportDialog open onOpenChange={() => undefined} />);
    expect(screen.getByText('MP3 does not support 96000 Hz. Choose 8–48 kHz from the list.')).toBeInTheDocument();
    expect(exportButton()).toBeDisabled();
  });

  it('shows the live size estimate from api.estimateSize', async () => {
    await withTrack();
    const spy = vi.spyOn(globalThis.mockApi, 'estimateSize').mockResolvedValue(3 * 1024 * 1024);
    render(<ExportDialog open onOpenChange={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId('export-estimate')).toHaveTextContent('3 MB'));
    expect(spy).toHaveBeenCalled();
  });

  it('uncontrolled mode renders its own Export trigger', async () => {
    render(<ExportDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(await screen.findByRole('dialog', { name: 'Export audio' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
