import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
