const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/smoke",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node server/index.js",
    url: "http://127.0.0.1:4173/healthz",
    timeout: 20_000,
    reuseExistingServer: false,
    env: {
      PORT: "4173",
      HOST: "127.0.0.1",
      DEBUG: "true",
      SESSION_TTL_SECONDS: "86400",
      EMPTY_SESSION_GRACE_SECONDS: "2",
      SESSION_STORE_PATH: "/tmp/sisyphus-smoke-sessions.json",
      SESSION_PERSIST_INTERVAL_MS: "50",
    },
  },
});
