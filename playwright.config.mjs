import { defineConfig } from '@playwright/test';

// BASE_URL=https://bowen1314.github.io/whencode/ npx playwright test   -> runs against the live site
const live = !!process.env.BASE_URL;
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:8766/whencode/',
    locale: 'en-US',
    browserName: 'chromium',
    acceptDownloads: true,
  },
  webServer: live ? undefined : {
    command: 'node scripts/serve.mjs 8766',
    url: 'http://127.0.0.1:8766/whencode/',
    reuseExistingServer: true,
  },
});
