export default async ({ app, page, lib, opts }) => {
  await lib.importFiles(app, page, [lib.fx('music-chords.wav')]);
  await page.waitForTimeout(2000);
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: /^Zoom in/ }).click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Space');
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(1500);
    const ph = await page.getByTestId('playhead').boundingBox().catch(() => null);
    const ruler = await page.getByTestId('ruler').boundingBox();
    console.log('t', await page.getByTestId('time-position').textContent(), 'playhead x', ph ? Math.round(ph.x - ruler.x) : 'NOT VISIBLE', 'of', Math.round(ruler.width));
  }
  await lib.shot(page, 'follow');
  await page.keyboard.press('Space');
};
