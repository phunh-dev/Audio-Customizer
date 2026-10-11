import { defineConfig } from '@playwright/test';

/**
 * Playwright E2E for the Electron app (e2e/**). Run with `npm run test:e2e`
 * (builds the native addon if missing + the app bundles first).
 * Env:
 *   AUDIO_CUSTOMIZER_E2E_EXECUTABLE  run against a packaged app binary instead of
 *                                    `electron out/main/index.js` (packaging smoke test)
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // one Electron app at a time: the audio device and CPU are shared
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
