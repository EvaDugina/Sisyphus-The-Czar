const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/smoke",
  testMatch: /preclick-rock-hop\.spec\.js/,
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
    reuseExistingServer: false,
    env: {
      ALLOWED_ORIGIN: "http://127.0.0.1:8080",
      SESSION_TTL_SECONDS: "86400",
      EMPTY_SESSION_GRACE_SECONDS: "2",
      SESSION_CREATE_RATE_LIMIT: "50",
      SESSION_STORE_PATH: "/tmp/sisyphus-hop-smoke-sessions.json",
      PRODUCTION_PRESET_PATH: "/tmp/sisyphus-hop-production-preset.json",
      SETTINGS_TEMPLATE_STORE_PATH:
        "/tmp/sisyphus-hop-settings-templates.json",
      SESSION_PERSIST_INTERVAL_MS: "50",
    },
  },
});
