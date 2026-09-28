const { defineConfig } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const smokeRunId = `${process.pid}-${Date.now()}`;
const smokePath = (name) =>
  path.join(os.tmpdir(), `sisyphus-prod-debug-${name}-${smokeRunId}.json`);
const productionPresetPath = smokePath("preset");
const basePath = String(process.env.PROD_DEBUG_BASE_PATH || "")
  .trim()
  .replace(/^\/+|\/+$/g, "");
const normalizedBasePath = basePath ? `/${basePath}` : "";
const accessPassword = process.env.PROD_DEBUG_ACCESS_PASSWORD || "";

fs.copyFileSync(
  path.join(__dirname, "config", "production-preset.json"),
  productionPresetPath,
);

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
      VITE_BASE_PATH: normalizedBasePath,
      BASE_PATH: normalizedBasePath,
      ACCESS_PASSWORD: accessPassword,
      ALLOWED_ORIGIN: "http://127.0.0.1:4174",
      SESSION_TTL_SECONDS: "86400",
      EMPTY_SESSION_GRACE_SECONDS: "2",
      SESSION_CREATE_RATE_LIMIT: "50",
      SESSION_STORE_PATH: smokePath("sessions"),
      PRODUCTION_PRESET_PATH: productionPresetPath,
      SETTINGS_TEMPLATE_STORE_PATH: smokePath("settings"),
      SESSION_PERSIST_INTERVAL_MS: "50",
    },
  },
});
