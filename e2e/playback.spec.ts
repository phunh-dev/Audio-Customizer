import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import {
  activeTabId,
  expect,
  importFiles,
  playButton,
  playhead,
  test,
  transport,
  waitForRender,
  writeToneWav,
} from './fixtures';

const SECONDS = 3;

async function importLongTone(app: ElectronApplication, page: Page, tmp: string): Promise<void> {
  await importFiles(app, page, [writeToneWav(join(tmp, 'long-tone.wav'), SECONDS)]);
  await waitForRender(page);
  await expect(page.getByTestId('time-duration')).toHaveText('00:03.000');
}

/** Spectrogram canvas pixels (data URL) of the master (final result) view. */
async function spectrogramImage(page: Page): Promise<string> {
  return page.getByTestId('master-view').locator('canvas').first().evaluate((c) => (c as HTMLCanvasElement).toDataURL());
}

/** Peak / loudness read-out drawn over the master view. */
async function masterReadout(page: Page): Promise<string> {
  return (await page.getByTestId('master-view').innerText()).replace(/\s+/g, ' ');
}

test.describe('editing', () => {
  test('changing master gain re-renders: level read-out and spectrogram update', async ({ app, page, tmp }) => {
    await importLongTone(app, page, tmp);
    const panel = page.getByTestId('effects-panel');
    await expect(panel).toBeVisible();
    await expect.poll(() => masterReadout(page)).toMatch(/-?\d/);
    const readout0 = await masterReadout(page);
    const image0 = await spectrogramImage(page);

    const gain = panel.getByRole('spinbutton', { name: 'Gain' }).first();
    await gain.click();
    await gain.fill('-18');
    await gain.press('Enter');
    await expect(gain).toHaveAttribute('aria-valuenow', '-18');

    await expect.poll(() => masterReadout(page), { timeout: 15_000 }).not.toBe(readout0);
    await expect.poll(() => spectrogramImage(page), { timeout: 15_000 }).not.toBe(image0);
    // the change is one undo step and restores the original render
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(gain).toHaveAttribute('aria-valuenow', '0');
    await expect.poll(() => masterReadout(page), { timeout: 15_000 }).toBe(readout0);
  });
});

/**
 * Click Play and wait for the engine to play. Returns false (and logs) only
 * when there is no audio output device (headless CI); any other failure fails.
 */
async function startPlayback(page: Page): Promise<boolean> {
  const session = await activeTabId(page);
  await playButton(page).click();
  const started = await expect
    .poll(async () => (await transport(page)).state, { timeout: 3_000 })
    .toBe('playing')
    .then(() => true)
    .catch(() => false);
  if (started) return true;
  const err = await page.evaluate(
    (id) =>
      (window as unknown as { api: { play(id: string): Promise<void> } }).api.play(id).then(
        () => '',
        (e: Error) => e.message,
      ),
    session,
  );
  if (err.startsWith('ERR_NO_AUDIO_DEVICE')) {
    console.warn(`[e2e] ${test.info().title}: playback assertions skipped: ${err}`);
    test.info().annotations.push({ type: 'skipped-playback', description: err });
    return false;
  }
  expect((await transport(page)).state, `play failed: ${err}`).toBe('playing');
  return true;
}

test.describe('transport', () => {
  test('play advances the position, pause holds it, stop rewinds', async ({ app, page, tmp }) => {
    await importLongTone(app, page, tmp);
    const session = await activeTabId(page);
    if (!(await startPlayback(page))) return;

    expect((await transport(page)).sessionId).toBe(session);
    await expect.poll(async () => (await transport(page)).position, { timeout: 5_000 }).toBeGreaterThan(0.3);
    // the UI follows the engine
    await expect(page.getByTestId('time-position')).not.toHaveText('00:00.000');
    await expect(playButton(page)).toHaveAccessibleName(/^Pause/);

    await playButton(page).click();
    await expect.poll(async () => (await transport(page)).state).toBe('paused');
    const p1 = (await transport(page)).position;
    await page.waitForTimeout(400);
    expect((await transport(page)).position).toBeCloseTo(p1, 3);
    await expect(playButton(page)).toHaveAccessibleName(/^Play/);

    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect.poll(async () => (await transport(page)).state).toBe('stopped');
    await expect.poll(async () => (await transport(page)).position).toBe(0);
  });

  test('seek by clicking the timeline ruler; playback continues from there', async ({ app, page, tmp }) => {
    await importLongTone(app, page, tmp);
    const ruler = page.getByTestId('ruler');
    const box = (await ruler.boundingBox())!;
    expect(box.width).toBeGreaterThan(100);
    expect(Number(await ruler.getAttribute('aria-valuemax'))).toBeCloseTo(SECONDS, 1);
    const at = (fraction: number) => ({ position: { x: box.width * fraction, y: box.height / 2 } });

    // seek while stopped: UI playhead moves, Play starts from there
    await ruler.click(at(0.5));
    await expect.poll(() => playhead(page)).toBeGreaterThan(0.2);
    const ph = await playhead(page);
    expect(ph).toBeLessThan(SECONDS - 0.5);
    await expect(page.getByTestId('time-position')).not.toHaveText('00:00.000');
    if (!(await startPlayback(page))) return;
    const p0 = (await transport(page)).position;
    expect(p0).toBeGreaterThanOrEqual(ph - 0.01);
    expect(p0).toBeLessThan(ph + 0.5);

    // seek while paused moves the engine cursor
    await playButton(page).click();
    await expect.poll(async () => (await transport(page)).state).toBe('paused');
    await ruler.click(at(0.1));
    const back = await playhead(page);
    expect(back).toBeLessThan(ph);
    await expect.poll(async () => (await transport(page)).position).toBeCloseTo(back, 2);

    // seek while playing: continues playing from the new position
    await playButton(page).click();
    await expect.poll(async () => (await transport(page)).state).toBe('playing');
    await ruler.click(at(0.7));
    await expect.poll(async () => (await transport(page)).position).toBeGreaterThan(back + 0.5);
    expect((await transport(page)).state).toBe('playing');
  });

  test('step buttons move by the selected unit', async ({ app, page, tmp }) => {
    await importLongTone(app, page, tmp);
    const fwd = page.getByRole('button', { name: /^Step forward/ });
    const back = page.getByRole('button', { name: /^Step back/ });

    // default unit: 100 ms
    await fwd.click();
    await expect.poll(() => playhead(page)).toBeCloseTo(0.1, 3);
    await fwd.click();
    await expect.poll(() => playhead(page)).toBeCloseTo(0.2, 3);
    await expect(page.getByTestId('time-position')).toHaveText('00:00.200');
    await back.click();
    await expect.poll(() => playhead(page)).toBeCloseTo(0.1, 3);

    // switch to 1 second steps (positions snap to the unit grid)
    await page.locator('footer').getByRole('combobox').first().click();
    await page.getByRole('option', { name: '1 second' }).click();
    await fwd.click();
    await expect.poll(() => playhead(page)).toBeCloseTo(1, 3);
    await fwd.click();
    await fwd.click();
    await fwd.click();
    // clamped at the end
    await expect.poll(() => playhead(page)).toBeCloseTo(SECONDS, 3);
    await back.click();
    await expect.poll(() => playhead(page)).toBeCloseTo(SECONDS - 1, 3);
    await expect(page.getByTestId('time-position')).toHaveText('00:02.000');

    // the engine cursor follows the steps once the session is loaded
    await back.click();
    if (!(await startPlayback(page))) return;
    await playButton(page).click();
    await expect.poll(async () => (await transport(page)).state).toBe('paused');
    await back.click();
    await expect.poll(() => playhead(page)).toBeLessThan(SECONDS - 0.5);
    const ph = await playhead(page);
    await expect.poll(async () => (await transport(page)).position).toBeCloseTo(ph, 2);
  });
});
