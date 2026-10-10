export default async ({ app, page, lib, opts }) => {
  const tag = 'final-' + (opts.tag || 'x');
  await lib.shot(page, tag + '-empty');
  await lib.importFiles(app, page, [lib.fx('music-chords.wav'), lib.fx('voice-sample.wav'), lib.fx('sfx-zap.wav')]);
  await page.waitForTimeout(2500);
  // move the voice clip a bit to show mixing
  const b = await page.locator('[data-testid^="clip-"]').nth(1).boundingBox();
  await page.mouse.move(b.x + 20, b.y + 30); await page.mouse.down(); await page.mouse.move(b.x + 180, b.y + 30, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(1500);
  await lib.shot(page, tag + '-main');
  if (opts.full) {
    await page.getByTestId('track-item').nth(1).click(); // deselect -> master
    await page.waitForTimeout(200);
    await page.getByTestId('effects-panel').getByRole('tab').nth(3).click();
    await page.getByTestId('effects-panel').getByRole('combobox').nth(1).click();
    await page.getByRole('option').nth(2).click();
    await page.waitForTimeout(1800);
    await lib.shot(page, tag + '-eq');
    await page.getByRole('button', { name: /^Export|^Xuất/ }).last().click();
    await page.waitForTimeout(1500);
    await lib.shot(page, tag + '-export');
  }
};
