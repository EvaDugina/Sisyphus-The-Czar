const { defineConfig } = require("@playwright/test");
const os = require("node:os");
const path = require("node:path");

const smokeRunId = `${process.pid}-${Date.now()}`;
const smokePath = (name) =>
  path.join(os.tmpdir(), `sisyphus-scene-pages-${name}-${smokeRunId}.json`);

module.exports = defineConfig({
  testDir: "./tests/smoke",
  testMatch: /scene-pages\.spec\.js/,
  timeout: 35_000,
  expect: { timeout: 10_000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:8080",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:8080/healthz",
    timeout: 45_000,
    reuseExistingServer: true,
    env: {
      ALLOWED_ORIGIN: "http://127.0.0.1:8080",
      SESSION_TTL_SECONDS: "86400",
      EMPTY_SESSION_GRACE_SECONDS: "2",
      SESSION_CREATE_RATE_LIMIT: "50",
      SESSION_STORE_PATH: smokePath("sessions"),
      PRODUCTION_PRESET_PATH: smokePath("preset"),
      SETTINGS_TEMPLATE_STORE_PATH: smokePath("settings"),
      SESSION_PERSIST_INTERVAL_MS: "50",
    },
  },
});
