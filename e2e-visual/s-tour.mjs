const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('STEP FAIL', name, e.message.split('\n')[0]); } };
export default async ({ app, page, lib, opts }) => {
  const tag = opts.tag || 'tour';
  const S = (n) => lib.shot(page, `${tag}-${n}`);
  await lib.importFiles(app, page, [lib.fx('music-chords.wav'), lib.fx('voice-sample.wav'), lib.fx('sfx-zap.wav')]);
  await page.waitForTimeout(2500);
  // deselect -> master
  await step('master', async () => { await page.getByTestId('track-item').first().click(); await page.waitForTimeout(300); });
  const tabs = opts.tabs || ['Volume', 'Pitch', 'Filters', 'EQ', 'Denoise', 'Loop', 'Optimize'];
  for (const name of tabs) {
    await step('tab ' + name, async () => { await page.getByTestId('effects-panel').getByRole('tab').nth(['Volume', 'Pitch', 'Filters', 'EQ', 'Denoise', 'Loop', 'Optimize'].indexOf(name)).click(); await page.waitForTimeout(400); await S('fx-' + name.toLowerCase()); });
  }
  if (opts.only) return;
  await step('export', async () => { await page.getByRole('button', { name: /^Export|^Xuất/ }).last().click(); await page.waitForTimeout(1200); await S('export'); await page.getByRole('button', { name: /^Cancel$|^Hủy$/ }).click(); await page.waitForTimeout(300); });
  await step('settings', async () => { await page.getByRole('button', { name: /settings|cài đặt/i }).first().click(); await page.waitForTimeout(400); await S('settings'); await page.keyboard.press('Escape'); });
  await step('arrange', async () => { await page.getByRole('button', { name: /join|ghép/i }).first().click(); await page.waitForTimeout(400); await S('arrange'); await page.keyboard.press('Escape'); });
  await step('stepunit', async () => { await page.locator('footer').getByRole('combobox').click(); await page.waitForTimeout(400); await S('stepunit'); await page.keyboard.press('Escape'); });
  // play
  await step('play', async () => {
    await page.locator('body').click({ position: { x: 600, y: 760 } }).catch(() => {});
    await page.keyboard.press('Space'); await page.waitForTimeout(1500);
    console.log('pos after 1.5s play', await page.getByTestId('time-position').textContent());
    await S('playing');
    const r = await page.getByTestId('ruler').boundingBox();
    await page.mouse.click(r.x + r.width * 0.6, r.y + 10); await page.waitForTimeout(800);
    console.log('pos after seek+0.8s', await page.getByTestId('time-position').textContent());
    await page.waitForTimeout(500);
    console.log('pos after +0.5s', await page.getByTestId('time-position').textContent());
    await S('playing-seek');
    await page.keyboard.press('Space'); await page.waitForTimeout(300);
    const a = await page.getByTestId('time-position').textContent();
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200);
    console.log('step right', a, '->', await page.getByTestId('time-position').textContent());
  });
  await step('space-on-button', async () => {
    const play = page.locator('footer').getByRole('button').nth(2);
    await play.click(); await page.waitForTimeout(600);
    const a = await page.getByTestId('time-position').textContent();
    await page.keyboard.press('Space'); await page.waitForTimeout(600);
    const b = await page.getByTestId('time-position').textContent();
    await page.waitForTimeout(400);
    const c = await page.getByTestId('time-position').textContent();
    console.log('space after clicking play button: playing at', a, '-> after space', b, c, b === c ? '(paused OK)' : '(STILL PLAYING)');
  });
  // selection drag on master view
  await step('select', async () => {
    const m = await page.getByTestId('master-view').boundingBox();
    await page.mouse.move(m.x + 100, m.y + 50); await page.mouse.down(); await page.mouse.move(m.x + 250, m.y + 60, { steps: 5 }); await page.mouse.up();
    await page.waitForTimeout(400); await S('selection');
  });
  // drag clip
  await step('drag', async () => {
    const clips = page.locator('[data-testid^="clip-"]');
    const b = await clips.nth(2).boundingBox();
    await page.mouse.move(b.x + 20, b.y + 30); await page.mouse.down(); await page.mouse.move(b.x + 220, b.y + 30, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(1200); await S('dragged');
    await page.keyboard.press('Control+z'); await page.waitForTimeout(800); await S('undo');
  });
  await step('many', async () => {
    await lib.importFiles(app, page, lib.allFixtures().filter((p) => p.includes('blip')));
    await page.waitForTimeout(2500); await S('many');
  });
  await step('broken', async () => { await lib.importFiles(app, page, [lib.fx('broken.wav')]); await page.waitForTimeout(800); await S('toast'); });
  await step('newtab', async () => { await page.getByRole('button', { name: /new session|phiên mới|new tab|tab mới/i }).click(); await page.waitForTimeout(600); await S('newtab'); });
};
