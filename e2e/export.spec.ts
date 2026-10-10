import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import {
  decode,
  expect,
  fixture,
  importFiles,
  saveDialogCalls,
  setSavePathEnv,
  stubSaveDialog,
  test,
  waitForRender,
} from './fixtures';

type Format = 'wav' | 'aiff' | 'flac' | 'mp3' | 'ogg';

interface Case {
  format: Format;
  label: string;
  /** sample-rate option label prefix ("" = keep) */
  rate: string;
  channels: 'Source' | 'Mono' | 'Stereo';
  expectRate: number;
  expectChannels: number;
}

// project: tone.wav (44.1 kHz stereo) + tone.ogg (44.1 kHz mono) -> 44.1 kHz stereo
const CASES: Case[] = [
  { format: 'wav', label: 'WAV', rate: '', channels: 'Source', expectRate: 44100, expectChannels: 2 },
  { format: 'aiff', label: 'AIFF', rate: '48 kHz', channels: 'Mono', expectRate: 48000, expectChannels: 1 },
  { format: 'flac', label: 'FLAC', rate: '22.05 kHz', channels: 'Stereo', expectRate: 22050, expectChannels: 2 },
  { format: 'mp3', label: 'MP3', rate: '32 kHz', channels: 'Mono', expectRate: 32000, expectChannels: 1 },
  { format: 'ogg', label: 'OGG', rate: '16 kHz', channels: 'Source', expectRate: 16000, expectChannels: 2 },
];

async function openExportDialog(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export audio' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function chooseOptions(page: Page, dialog: Locator, c: Case): Promise<void> {
  await dialog.getByRole('radiogroup', { name: 'Format' }).getByRole('radio', { name: c.label, exact: true }).click();
  if (c.rate) {
    await dialog.getByRole('combobox', { name: 'Sample rate' }).click();
    await page.getByRole('option', { name: new RegExp(`^${c.rate.replace('.', '\\.')}`) }).click();
  }
  await dialog.getByRole('radiogroup', { name: 'Channels' }).getByRole('radio', { name: c.channels, exact: true }).click();
  await expect(dialog.getByTestId('export-estimate')).toHaveText(/\d/, { timeout: 15_000 });
}

test.describe('export', () => {
  test('exports every format to AUDIO_CUSTOMIZER_E2E_SAVE_PATH with the chosen options', async ({ app, page, tmp }) => {
    await importFiles(app, page, [fixture('tone.wav'), fixture('tone.ogg')]);
    await waitForRender(page);
    // the save dialog must not be used when the E2E path is set
    await stubSaveDialog(app, null);

    for (const c of CASES) {
      await test.step(c.format, async () => {
        const out = join(tmp, `export-${c.format}.${c.format}`);
        await setSavePathEnv(app, out);
        const dialog = await openExportDialog(page);
        await chooseOptions(page, dialog, c);
        await dialog.getByRole('button', { name: 'Export…' }).click();
        await expect(dialog.getByTestId('export-path')).toHaveText(out, { timeout: 30_000 });

        expect(existsSync(out)).toBe(true);
        const size = statSync(out).size;
        await expect(dialog).toContainText(`(${size} bytes)`);
        const info = await decode(out);
        expect(info.format).toBe(c.format);
        expect(info.sampleRate).toBe(c.expectRate);
        expect(info.channels).toBe(c.expectChannels);
        // ~0.5 s of audio (lossy codecs pad a little)
        expect(info.duration).toBeGreaterThan(0.4);
        expect(info.duration).toBeLessThan(0.7);

        await dialog.getByRole('button', { name: 'Done' }).click();
        await expect(dialog).toBeHidden();
      });
    }
    expect(await saveDialogCalls(app)).toBe(0);
  });

  test('asks for the location first; canceling the save dialog writes nothing', async ({ app, page, tmp }) => {
    await importFiles(app, page, [fixture('tone.flac')]);
    await waitForRender(page);
    await setSavePathEnv(app, null);
    await stubSaveDialog(app, null);
    const before = readdirSync(tmp);

    const dialog = await openExportDialog(page);
    await chooseOptions(page, dialog, CASES[0]!);
    await dialog.getByRole('button', { name: 'Export…' }).click();
    await expect(dialog.getByText('Export canceled: nothing was saved.')).toBeVisible();
    expect(await saveDialogCalls(app)).toBe(1);
    expect(readdirSync(tmp)).toEqual(before);

    // then a chosen location is used (extension added when missing)
    const chosen = join(tmp, 'picked-name');
    await stubSaveDialog(app, chosen);
    await dialog.getByRole('button', { name: 'Export…' }).click();
    await expect(dialog.getByTestId('export-path')).toHaveText(`${chosen}.wav`, { timeout: 30_000 });
    expect(await saveDialogCalls(app)).toBe(1);
    const info = await decode(`${chosen}.wav`);
    expect(info.sampleRate).toBe(44100);
    expect(info.channels).toBe(2);
  });
});
