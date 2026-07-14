const base = require("./playwright.config");
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  ...base,
  testDir: "./tests/soak",
  timeout: 11 * 60 * 1000,
  use: {
    ...base.use,
    trace: "retain-on-failure",
  },
});
