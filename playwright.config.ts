import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:3174',
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 3174 --strictPort',
    url: 'http://127.0.0.1:3174',
    reuseExistingServer: false,
  },
});
