import { defineConfig, devices } from "@playwright/test";

const VITE_PORT = Number(process.env.SOLAR_DEV_PORT ?? 5173);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // ADR 007 sub-chantier B : the bespoke mock-orion global setup was
  // removed with Solar's home-grown protocol. The LSDP/1.1 E2E harness
  // (a stub Lumencast server + the runtime's server kit) is Probe's
  // follow-up — acceptance (b)/(c)/(e). Until then `test:e2e` has no
  // specs and is a no-op (E2E is not in the push gate).
  use: {
    baseURL: `http://localhost:${VITE_PORT}`,
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${VITE_PORT} --strictPort`,
    url: `http://localhost:${VITE_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
