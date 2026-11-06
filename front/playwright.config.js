import { defineConfig, devices } from '@playwright/test';

// End-to-end tests, with the API mocked in e2e/mockApi.js. Each test runs
// twice: against the production build (vite preview, what users get) and
// against the dev server, where React reports its warnings (unknown props,
// missing keys, ...) as console errors, which the tests treat as failures.
// `npm run e2e` builds first.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'build', use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4173' } },
    { name: 'dev', use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5173' } },
  ],
  webServer: [
    {
      command: 'npx vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npx vite --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
