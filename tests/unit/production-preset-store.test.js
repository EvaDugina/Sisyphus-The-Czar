"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Physics = require("../../shared/physics");
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

test("Git production preset содержит полный canonical snapshot", () => {
  const document = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../../config/production-preset.json"),
      "utf8",
    ),
  );
  const normalized = normalizeDocument(document);

  assert.equal(normalized.source.settingsSchemaVersion, 51);
  assert.equal(normalized.source.name, "v1");
  assert.equal(normalized.settings.handAudioEnabled, false);
  assert.equal(normalized.settings.cameraFollowUpEnabled, true);
  assert.equal(normalized.settings.cameraFollowUpLerp, 0.1);
  assert.equal(normalized.settings.cameraFollowDownEnabled, true);
  assert.equal(normalized.settings.cameraFollowDownLerp, 0.1);
  assert.equal(normalized.settings.rockAccelerationEnabled, false);
  assert.equal(
    Object.hasOwn(normalized.settings, "upperZoneAutoScrollEnabled"),
    false,
  );
  assert.equal(normalized.settings.sceneTwoOverflowYVisible, false);
  assert.equal(normalized.settings.gachiClickSoundFilename, "Camen.mp3");
  assert.deepEqual(
    Object.keys(normalized.settings).sort(),
    [
      ...new Set([
        ...Object.keys(RoomSettings.DEFAULT_ROOM_SETTINGS),
        ...Object.keys(Physics.DEFAULT_PHYSICS),
      ]),
    ].sort(),
  );
  assert.equal(
    Object.keys(normalized.settings).some((key) => key.startsWith("preclickParallax")),
    false,
  );
});

test("production preset мигрирует legacy Fold-ключи и длину отскока в schema 51", () => {
  const normalized = normalizeDocument({
    version: STORE_VERSION,
    selectedAt: "2026-08-09T10:00:00.000Z",
    source: {
      id: "legacy-fold",
      name: "Legacy Fold",
      settingsSchemaVersion: 32,
      updatedAt: "2026-08-09T09:00:00.000Z",
    },
    settings: {
      draftFoldAngle: 41,
      draftFoldZoneSize: 17,
      draftFoldBlendEnabled: false,
      draftFoldBlendCurve: "cubic-bezier(0, 0, 1, 1)",
      foldAngle: 52,
    },
  });

  assert.equal(normalized.source.settingsSchemaVersion, 51);
  assert.equal(normalized.settings.preclickPopupDelayMs, 200);
  assert.equal(normalized.settings.foldAngle, 52);
  assert.equal(normalized.settings.foldZoneSize, 17);
  assert.equal(normalized.settings.foldPositionPercent, 0);
  assert.equal(normalized.settings.foldPanelHeightVh, 17);
  assert.equal(normalized.settings.foldBlendEnabled, false);
  assert.equal(
    normalized.settings.foldBlendCurve,
    "cubic-bezier(0, 0, 1, 1)",
  );
  assert.equal(
    Object.keys(normalized.settings).some((key) => key.startsWith("draftFold")),
    false,
  );
  assert.equal(normalized.settings.preclickHopMaxDistancePercent, 62.5);
  assert.equal(normalized.settings.preclickHopGuardClickCount, 1);
  assert.equal(normalized.settings.rockImageId, "rock-03");
  assert.equal(normalized.settings.foldRockImageId, "rock-03");
});

test("production preset сохраняет старую дальность отскока через миграцию", () => {
  const normalized = normalizeDocument({
    version: STORE_VERSION,
    selectedAt: "2026-08-09T10:00:00.000Z",
    source: {
      id: "legacy-hop",
      name: "Legacy Hop",
      settingsSchemaVersion: 33,
      updatedAt: "2026-08-09T09:00:00.000Z",
    },
    settings: {
      preclickParallaxActivationRadiusVw: 12,
      preclickParallaxMaxOffsetVw: 8,
      preclickParallaxStartDelayMs: 320,
      preclickParallaxInverted: true,
    },
  });

  assert.equal(normalized.source.settingsSchemaVersion, 51);
  assert.equal(normalized.settings.preclickHopActivationRadiusPercent, 12);
  assert.equal(normalized.settings.preclickHopMaxDistancePercent, 15);
  assert.equal(
    Object.keys(normalized.settings).some((key) => key.startsWith("preclickParallax")),
    false,
  );
});

test("production preset разделяет press и pulse при миграции schema 34", () => {
  const normalized = normalizeDocument({
    version: STORE_VERSION,
    selectedAt: "2026-08-09T10:00:00.000Z",
    source: {
      id: "legacy-rock-visuals",
      name: "Legacy Rock Visuals",
      settingsSchemaVersion: 34,
      updatedAt: "2026-08-09T09:00:00.000Z",
    },
    settings: {
      rockPressShrinkPercent: 17,
    },
  });

  assert.equal(normalized.source.settingsSchemaVersion, 51);
  assert.equal(normalized.settings.rockPressShrinkPercent, 17);
  assert.equal(normalized.settings.rockPulseShrinkPercent, 17);
  assert.equal(normalized.settings.rockImageId, "rock-03");
  assert.equal(normalized.settings.foldRockImageId, "rock-03");
});

test("production preset мигрирует boolean-видимость руки из schema 36", () => {
  const normalized = normalizeDocument({
    version: STORE_VERSION,
    selectedAt: "2026-08-10T10:00:00.000Z",
    source: {
      id: "legacy-hand-visibility",
      name: "Legacy Hand Visibility",
      settingsSchemaVersion: 36,
      updatedAt: "2026-08-10T09:00:00.000Z",
    },
    settings: {
      handAlwaysVisible: false,
    },
  });

  assert.equal(normalized.source.settingsSchemaVersion, 51);
  assert.equal(normalized.settings.handVisibilityMode, "hover");
  assert.equal(normalized.settings.handImageChangeDelayMs, 0);
  assert.equal(normalized.settings.foldPositionPercent, 0);
  assert.equal(normalized.settings.foldPanelHeightVh, 20);
  assert.equal(Object.hasOwn(normalized.settings, "handAlwaysVisible"), false);
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
