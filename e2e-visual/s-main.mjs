export default async ({ app, page, lib, opts }) => {
  const tag = opts.tag || 'main';
  await lib.shot(page, tag + '-empty');
  await lib.importFiles(app, page, [lib.fx('music-chords.wav'), lib.fx('voice-sample.wav'), lib.fx('sfx-zap.wav')]);
  await page.waitForTimeout(2500);
  await lib.shot(page, tag + '-loaded');
};
