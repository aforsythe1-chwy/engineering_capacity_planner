import { defineConfig, devices } from '@playwright/test';

/**
 * Drives the app on the bundled synthetic data (no backend required). The Vite
 * dev server is started automatically.
 *
 * By default Playwright uses its own downloaded browser. Set
 * `PW_CHROMIUM_PATH` to use a preinstalled Chromium instead (e.g. in sandboxes
 * where the matching browser build isn't downloaded).
 */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
const testPort = Number(process.env.VITE_PORT) || 5173;
const testBaseUrl = `http://localhost:${testPort}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: testBaseUrl,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: testBaseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
