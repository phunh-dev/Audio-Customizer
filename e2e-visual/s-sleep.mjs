export default async ({ app, page, lib, opts }) => {
  const tag = opts.tag || 'sleep';
  await lib.importFiles(app, page, [lib.fx('music-chords.wav')]);
  await page.getByRole('button', { name: /new tab|tab mới/i }).click();
  await lib.importFiles(app, page, [lib.fx('voice-sample.wav'), lib.fx('sfx-zap.wav')]);
  await page.waitForTimeout(1500);
  // set sleep to 1 minute
  await page.getByRole('button', { name: /^Settings$|^Cài đặt$/ }).click();
  const f = page.getByRole('spinbutton', { name: /sleep|ngủ/i });
  await f.fill('1'); await f.press('Enter'); await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await lib.shot(page, tag + '-twotabs');
  console.log('waiting 100s for sleep');
  await page.waitForTimeout(100000);
  await lib.shot(page, tag + '-asleep');
  await page.locator('[role=tab]').first().hover();
  await page.waitForTimeout(900);
  await lib.shot(page, tag + '-asleep-hover');
  await page.locator('[role=tab]').first().click();
  await page.waitForTimeout(150);
  await lib.shot(page, tag + '-waking');
  await page.waitForTimeout(2500);
  await lib.shot(page, tag + '-woken');
};
