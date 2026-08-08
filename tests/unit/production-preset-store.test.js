"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Physics = require("../../shared/physics");
const ProductionPreset = require("../../shared/production-preset");
const RoomSettings = require("../../shared/room-settings");
const {
  normalizeDocument,
  ProductionPresetStore,
  STORE_VERSION,
} = require("../../server/production-preset-store");

function selection(id, overrides = {}) {
  return {
    id,
    name: overrides.name || `Шаблон ${id}`,
    settingsSchemaVersion: 20,
    updatedAt: overrides.updatedAt || "2026-07-26T10:00:00.000Z",
    settings: {
      ...RoomSettings.DEFAULT_ROOM_SETTINGS,
      ...Physics.DEFAULT_PHYSICS,
      gravity: overrides.gravity ?? 7,
      sceneHeightScreens: overrides.sceneHeightScreens ?? 12,
      ignored: "not-persisted",
    },
  };
}

test("Git production preset совпадает со встроенным fallback", () => {
  const document = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../../config/production-preset.json"),
      "utf8",
    ),
  );
  const normalized = normalizeDocument(document);

  assert.equal(normalized.source.settingsSchemaVersion, 32);
  assert.deepEqual(normalized.settings, ProductionPreset.settings);
});

test("production preset store атомарно сохраняет полный whitelist настроек", (context) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "sisyphus-production-preset-"),
  );
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "production-preset.json");
  const store = new ProductionPresetStore(filePath, {
    now: () => Date.parse("2026-07-26T12:00:00.000Z"),
  });

  const saved = store.save(selection("version-a"));
  const document = JSON.parse(fs.readFileSync(filePath, "utf8"));

  assert.equal(document.version, STORE_VERSION);
  assert.equal(document.selectedAt, "2026-07-26T12:00:00.000Z");
  assert.equal(document.source.id, "version-a");
  assert.equal(document.settings.gravity, 7);
  assert.equal(document.settings.sceneHeightScreens, 12);
  assert.equal(Object.hasOwn(document.settings, "ignored"), false);
  assert.deepEqual(store.metadata(), {
    selectedAt: saved.selectedAt,
    source: saved.source,
  });

  const loaded = new ProductionPresetStore(filePath).load();
  assert.deepEqual(loaded, saved);
});

test("последний успешный выбор полностью заменяет production preset", (context) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "sisyphus-production-preset-"),
  );
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "production-preset.json");
  const store = new ProductionPresetStore(filePath);

  store.save(selection("version-a", { gravity: 6 }));
  const saved = store.save(selection("version-b", { gravity: 8 }));
  const loaded = new ProductionPresetStore(filePath).load();

  assert.equal(saved.source.id, "version-b");
  assert.equal(loaded.source.id, "version-b");
  assert.equal(loaded.settings.gravity, 8);
});

test("отсутствующий или повреждённый store возвращает fallback-сигнал", (context) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "sisyphus-production-preset-"),
  );
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "production-preset.json");
  const events = [];
  const store = new ProductionPresetStore(filePath, {
    logger: (event) => events.push(event),
  });

  assert.equal(store.load(), null);
  fs.writeFileSync(filePath, "{broken", "utf8");
  assert.equal(store.load(), null);
  assert.deepEqual(events, [
    "production_preset_store_missing",
    "production_preset_store_load_error",
  ]);
});

test("store отклоняет некорректные метаданные версии", () => {
  const store = new ProductionPresetStore("/unused/production-preset.json");

  assert.throws(
    () =>
      store.save({
        ...selection("version-a"),
        updatedAt: "не дата",
      }),
    { code: "invalid_production_preset" },
  );
});
