import { defineConfig, devices } from '@playwright/test';

// The browser is pre-installed in some environments; honour its path if set.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3100);
const SUPABASE_PORT = 54321;

// Matches fakeAnonKey() in tests/stack/fake-supabase.ts for the default secret.
const ANON_KEY = process.env.E2E_ANON_KEY!;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'], browserName: 'chromium' } }],
  webServer: [
    {
      command: 'node tests/stack/serve.ts',
      url: `http://127.0.0.1:${SUPABASE_PORT}/auth/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
    },
    {
      command: `npx next start -p ${APP_PORT}`,
      url: `http://127.0.0.1:${APP_PORT}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${SUPABASE_PORT}`,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ANON_KEY,
      },
    },
  ],
});
