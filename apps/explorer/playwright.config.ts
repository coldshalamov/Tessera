import { defineConfig } from '@playwright/test';

/**
 * Browser smoke for the built app (packet T06). Runs against `vite preview`
 * of the production bundle — NOT vitest's jsdom — so the ARIA tree, file
 * input, download path and responsive layout are exercised for real.
 *
 * Requires a cached browser (`pnpm exec playwright install chromium` once);
 * deliberately not part of `pnpm -r test` so CI without browsers stays green.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4817',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'pnpm exec vite preview --port 4817 --strictPort',
    url: 'http://localhost:4817',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
