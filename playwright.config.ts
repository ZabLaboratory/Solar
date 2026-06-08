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
  // follow-up — acceptance (b)/(c)/(e).
  //
  // ADR 001 (dual-build) adds the served-host-bundle smoke test
  // (tests/e2e/host-bundle.spec.ts). That spec serves the BUILT
  // dist/host/ over its own static HTTP server (no Vite, no import map) to
  // reproduce the Pulsar CEF / Orion static-serve conditions, so it does
  // NOT need the Vite dev webServer. The dev `webServer` is therefore
  // wired only when a spec opts into `baseURL` — left off by default so
  // the host smoke test stays self-contained and CI-stable.
  use: {
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

// VITE_PORT is retained for a future dev-server-backed harness; reference
// it so the unused-var lint stays green until that harness lands.
void VITE_PORT;
