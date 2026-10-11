import {
  activeTabId,
  expect,
  FIXTURE_FILES,
  fixture,
  importFiles,
  sessionTabs,
  stubOpenDialog,
  test,
  trackItems,
  waitForRender,
} from './fixtures';

const EXPECTED: Record<(typeof FIXTURE_FILES)[number], { format: RegExp; rate: string; channels: string }> = {
  'tone.wav': { format: /wav/i, rate: '44100 Hz', channels: 'Stereo' },
  'tone.aiff': { format: /aiff/i, rate: '48000 Hz', channels: 'Stereo' },
  'tone.aif': { format: /aiff/i, rate: '22050 Hz', channels: 'Mono' },
  'tone.flac': { format: /flac/i, rate: '44100 Hz', channels: 'Stereo' },
  'tone.mp3': { format: /mp3/i, rate: '44100 Hz', channels: 'Stereo' },
  'tone.ogg': { format: /ogg/i, rate: '44100 Hz', channels: 'Mono' },
};

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('import & track list', () => {
  test('imports every supported format via "Open files" and shows format / rate / duration', async ({ app, page }) => {
    await importFiles(
      app,
      page,
      FIXTURE_FILES.map((f) => fixture(f)),
    );
    for (const name of FIXTURE_FILES) {
      const exp = EXPECTED[name];
      const item = trackItems(page).filter({ hasText: new RegExp(`${name.replace('.', '\\.')}(?![a-z])`) });
      await expect(item).toHaveCount(1);
      await expect(item).toContainText(exp.format);
      await expect(item).toContainText(exp.rate);
      await expect(item).toContainText(exp.channels);
      await expect(item).toContainText(/0:00\.5/);
    }
    // the editor replaces the drop zone and the mix renders
    await expect(page.getByTestId('drop-zone')).toHaveCount(0);
    await waitForRender(page);
    await expect(page.getByTestId('lane')).toHaveCount(FIXTURE_FILES.length);
  });

  test('imports a folder via "Open folder" (recursive, filtered)', async ({ app, page }) => {
    await stubOpenDialog(app, [fixture('')]);
    await page.getByRole('button', { name: 'Open folder', exact: true }).first().click();
    await expect(trackItems(page)).toHaveCount(FIXTURE_FILES.length, { timeout: 20_000 });
  });

  test('canceling the open dialog imports nothing', async ({ app, page }) => {
    await stubOpenDialog(app, null);
    await page.getByRole('button', { name: 'Open files', exact: true }).first().click();
    await page.waitForTimeout(500);
    await expect(trackItems(page)).toHaveCount(0);
    await expect(page.getByTestId('drop-zone')).toBeVisible();
  });

  test('X removes a track, Ctrl+Z restores it, Ctrl+Y removes it again', async ({ app, page }) => {
    await importFiles(app, page, [fixture('tone.wav'), fixture('tone.flac')]);
    // files are imported in sorted order: tone.flac, tone.wav
    await expect(trackItems(page).first()).toContainText('tone.flac');
    await page.getByRole('button', { name: /^Remove tone\.flac/ }).click();
    await expect(trackItems(page)).toHaveCount(1);
    await expect(trackItems(page).first()).toContainText('tone.wav');

    await page.locator('body').click({ position: { x: 5, y: 300 } }).catch(() => undefined);
    await page.keyboard.press(`${mod}+z`);
    await expect(trackItems(page)).toHaveCount(2);
    // restored at its original position
    await expect(trackItems(page).first()).toContainText('tone.flac');

    await page.keyboard.press(`${mod}+y`);
    await expect(trackItems(page)).toHaveCount(1);
    // toolbar undo button does the same
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(trackItems(page)).toHaveCount(2);
  });
});

test.describe('session tabs', () => {
  test('new tab, switch, close: each tab is its own session', async ({ app, page }) => {
    await importFiles(app, page, [fixture('tone.wav')]);
    const first = await activeTabId(page);
    await expect(sessionTabs(page)).toHaveCount(1);

    await page.getByRole('button', { name: 'New tab' }).click();
    await expect(sessionTabs(page)).toHaveCount(2);
    const second = await activeTabId(page);
    expect(second).not.toBe(first);
    await expect(trackItems(page)).toHaveCount(0);
    await expect(page.getByTestId('drop-zone')).toBeVisible();
    await importFiles(app, page, [fixture('tone.mp3'), fixture('tone.ogg')]);

    // switch back: first session keeps its single track
    await page.getByTestId(`tab-${first}`).click();
    expect(await activeTabId(page)).toBe(first);
    await expect(trackItems(page)).toHaveCount(1);
    await expect(trackItems(page).first()).toContainText('tone.wav');

    await page.getByTestId(`tab-${second}`).click();
    await expect(trackItems(page)).toHaveCount(2);

    // close the second tab -> back to the first
    await page.getByTestId(`tab-${second}`).getByRole('button', { name: /^Close / }).click();
    await expect(sessionTabs(page)).toHaveCount(1);
    expect(await activeTabId(page)).toBe(first);
    await expect(trackItems(page)).toHaveCount(1);
  });
});
