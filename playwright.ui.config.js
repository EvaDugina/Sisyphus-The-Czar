const { defineConfig } = require("@playwright/test");

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:8080";
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === "true";

module.exports = defineConfig({
  testDir: "./tests/smoke",
  testMatch: /ui-fold\.spec\.js/,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  workers: 1,
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: skipWebServer ? undefined : {
    command: "npm run dev",
    url: "http://127.0.0.1:8080/healthz",
    timeout: 45_000,
    reuseExistingServer: true,
    env: {
      ALLOWED_ORIGIN: "http://127.0.0.1:8080",
      SESSION_TTL_SECONDS: "86400",
      EMPTY_SESSION_GRACE_SECONDS: "2",
      SESSION_CREATE_RATE_LIMIT: "50",
      SLIP_DELAY_MIN_MS: "10000",
      SLIP_DELAY_MAX_MS: "10000",
      STATIONARY_HOLD_RELEASE_MS: "10000",
      SESSION_STORE_PATH: "/tmp/sisyphus-ui-smoke-sessions.json",
      PRODUCTION_PRESET_PATH: "/tmp/sisyphus-ui-production-preset.json",
      SETTINGS_TEMPLATE_STORE_PATH:
        "/tmp/sisyphus-ui-settings-templates.json",
      SESSION_PERSIST_INTERVAL_MS: "50",
    },
  },
});
