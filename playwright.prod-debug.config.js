const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/smoke",
  testMatch: /prod-debug\.spec\.js/,
  timeout: 35_000,
  expect: { timeout: 10_000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4174",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "cross-env VITE_DEBUG_UI=true npm run build && node server/index.js",
    url: "http://127.0.0.1:4174/healthz",
    timeout: 45_000,
    reuseExistingServer: false,
    env: {
      PORT: "4174",
      HOST: "127.0.0.1",
      DEBUG: "true",
      VITE_DEBUG_UI: "true",
      ALLOWED_ORIGIN: "http://127.0.0.1:4174",
      SESSION_TTL_SECONDS: "86400",
      EMPTY_SESSION_GRACE_SECONDS: "2",
      SESSION_CREATE_RATE_LIMIT: "50",
      SESSION_STORE_PATH: "/tmp/sisyphus-prod-debug-sessions.json",
      PRODUCTION_PRESET_PATH: "/tmp/sisyphus-prod-debug-preset.json",
      SETTINGS_TEMPLATE_STORE_PATH:
        "/tmp/sisyphus-prod-debug-settings-templates.json",
      SESSION_PERSIST_INTERVAL_MS: "50",
    },
  },
});
