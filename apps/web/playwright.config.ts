import { defineConfig, devices } from "@playwright/test";

/**
 * Task 22 — one e2e flow against the docker compose stack (web :3000 →
 * api → fixture-seeded db). There is deliberately NO `next dev`/`next start`
 * webServer here: the system under test is the whole compose stack, not the
 * web app alone, so the webServer below brings that stack up when it is not
 * already running (CI's e2e job starts it explicitly first and greps the
 * `02-seed: restored` log; `reuseExistingServer` then makes this a no-op).
 *
 * `sudo -n` matches this repo's hosts (docker group membership not assumed;
 * GitHub's ubuntu runners allow passwordless sudo too). On a host where
 * sudo needs a password, start the stack yourself first — see the CI
 * workflow or the repo README run section — and Playwright will reuse it.
 */
export default defineConfig({
  testDir: "./e2e",
  // One spec, one flow — parallel workers would only fight over one stack.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  // The cold encoder/model load inside the api container makes the first
  // search slower than a unit-test budget; 20s keeps failures honest but
  // not twitchy (the heavy waits inside the spec pass explicit timeouts).
  expect: { timeout: 20_000 },
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  outputDir: "test-results",
  webServer: {
    // `up -d` exits once containers start (Playwright would report
    // "exited early"), and an attached `up` runs as root under sudo, which
    // Playwright cannot kill at teardown — so: detached up, then a
    // user-owned keep-alive process for Playwright to monitor and kill.
    // The containers are daemon-owned and stay up afterwards.
    command: "sudo -n docker compose up -d --build && tail -f /dev/null",
    cwd: "../..",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 5 * 60_000,
  },
});
