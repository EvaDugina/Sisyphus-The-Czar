const { defineConfig } = require("@playwright/test");

const smokeRunId = `${process.pid}-${Date.now()}`;

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
      SESSION_STORE_PATH: `/tmp/sisyphus-scene-pages-${smokeRunId}.json`,
      PRODUCTION_PRESET_PATH:
        `/tmp/sisyphus-scene-pages-preset-${smokeRunId}.json`,
      SETTINGS_TEMPLATE_STORE_PATH:
        `/tmp/sisyphus-scene-pages-settings-${smokeRunId}.json`,
      SESSION_PERSIST_INTERVAL_MS: "50",
    },
  },
});
