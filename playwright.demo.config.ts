import {defineConfig, devices} from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  testDir: './demo',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  outputDir: 'test-results/demo',
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: {width: 1440, height: 1000},
    // Trace screenshots share Chromium's screencast and can cap frames at 800px.
    trace: {mode: 'retain-on-failure', screenshots: false, snapshots: true, sources: true},
    screenshot: 'only-on-failure',
  },
  projects: [{name: 'chromium', use: {browserName: devices['Desktop Chrome'].defaultBrowserType}}],
  webServer: base.webServer,
});
