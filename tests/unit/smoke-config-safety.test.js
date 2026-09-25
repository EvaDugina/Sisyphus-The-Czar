const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const CONFIG_DIRECTORY = path.resolve(__dirname, "../../config");
const MUTATING_SMOKE_CONFIGS = [
  ["dev", require("../../playwright.dev.config")],
  ["scene-pages", require("../../playwright.scene-pages.config")],
  ["prod-debug", require("../../playwright.prod-debug.config")],
  ["ui", require("../../playwright.ui.config")],
];

function pathIsInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

test("smoke с сохранением настроек не использует рабочий сервер или config", () => {
  MUTATING_SMOKE_CONFIGS.forEach(([name, config]) => {
    assert.ok(config.webServer, `${name}: webServer обязателен`);
    const servers = Array.isArray(config.webServer)
      ? config.webServer
      : [config.webServer];
    servers.forEach((server) => {
      assert.equal(
        server.reuseExistingServer,
        false,
        `${name}: запрещено переиспользовать dev-сервер`,
      );
    });
    const settingsServer = servers.find(
      (server) => server.env?.SETTINGS_TEMPLATE_STORE_PATH,
    );
    assert.ok(settingsServer, `${name}: settings template store обязателен`);
    const storePath = path.resolve(
      settingsServer.env.SETTINGS_TEMPLATE_STORE_PATH,
    );
    assert.equal(
      pathIsInside(CONFIG_DIRECTORY, storePath),
      false,
      `${name}: settings template store должен быть вне config/`,
    );
  });
});
