const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/smoke",
  testMatch: /compose-lifecycle\.spec\.js/,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:18082",
    headless: true,
    trace: "retain-on-failure",
  },
});
