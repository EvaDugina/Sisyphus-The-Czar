"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Physics = require("../../shared/physics");
const RoomSettings = require("../../shared/room-settings");
const {
  SettingsTemplateStore,
  STORE_VERSION,
} = require("../../server/settings-template-store");

function entry(id, overrides = {}) {
  return {
    id,
    name: overrides.name || `Шаблон ${id}`,
    settingsSchemaVersion: 20,
    createdAt: overrides.createdAt || "2026-07-26T10:00:00.000Z",
    updatedAt: overrides.updatedAt || "2026-07-26T10:00:00.000Z",
    settings: {
      ...RoomSettings.DEFAULT_ROOM_SETTINGS,
      ...Physics.DEFAULT_PHYSICS,
      gravity: overrides.gravity ?? 7,
      ignored: "drop-me",
    },
  };
}

function temporaryStore(context, options = {}) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "sisyphus-settings-templates-"),
  );
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "settings-templates.json");
  return {
    filePath,
    store: new SettingsTemplateStore(filePath, options),
  };
}

test("settings template store атомарно сохраняет whitelist и загружается", (context) => {
  const now = Date.parse("2026-07-26T12:00:00.000Z");
  const { filePath, store } = temporaryStore(context, { now: () => now });

  const saved = store.saveEntry(entry("version-a"));
  const rawDocument = fs.readFileSync(filePath, "utf8");
  const document = JSON.parse(rawDocument);

  assert.equal(document.version, STORE_VERSION);
  assert.equal(document.revision, 1);
  assert.equal(saved.entry.updatedAt, "2026-07-26T12:00:00.000Z");
  assert.equal(saved.entry.settings.gravity, 7);
  assert.equal(Object.hasOwn(saved.entry.settings, "ignored"), false);
  assert.match(rawDocument, /^\{\n  "version": 1,/);
  assert.equal(rawDocument.endsWith("\n"), true);
  assert.deepEqual(
    fs.readdirSync(path.dirname(filePath)).filter((name) => name.endsWith(".tmp")),
    [],
  );

  const loaded = new SettingsTemplateStore(filePath);
  assert.equal(loaded.load().length, 1);
  assert.deepEqual(loaded.latest(), saved.entry);
});

test("settings template store мигрирует legacy Fold-ключи в schema 35", (context) => {
  const { store } = temporaryStore(context);
  const legacy = entry("legacy-fold");
  legacy.settingsSchemaVersion = 32;
  legacy.settings = {
    draftFoldAngle: 44,
    draftFoldZoneSize: 18,
    draftFoldBlendEnabled: false,
    draftFoldBlendCurve: "cubic-bezier(0, 0, 1, 1)",
    foldAngle: 55,
  };

  const imported = store.importEntries([legacy]).entries[0];

  assert.equal(imported.settingsSchemaVersion, 35);
  assert.equal(imported.settings.foldAngle, 55);
  assert.equal(imported.settings.foldZoneSize, 18);
  assert.equal(imported.settings.foldBlendEnabled, false);
  assert.equal(
    imported.settings.foldBlendCurve,
    "cubic-bezier(0, 0, 1, 1)",
  );
  assert.equal(
    Object.keys(imported.settings).some((key) => key.startsWith("draftFold")),
    false,
  );
  assert.equal(imported.settings.preclickHopMaxDistanceVw, 62.5);
  assert.equal(imported.settings.rockImageId, "rock-03");
  assert.equal(imported.settings.foldRockImageId, "rock-03");
});

test("settings template store мигрирует длину отскока из schema 33", (context) => {
  const { store } = temporaryStore(context);
  const legacy = entry("legacy-hop");
  legacy.settingsSchemaVersion = 33;
  legacy.settings = {
    preclickParallaxActivationRadiusVw: 20,
  };

  const imported = store.importEntries([legacy]).entries[0];

  assert.equal(imported.settingsSchemaVersion, 35);
  assert.equal(imported.settings.preclickHopMaxDistanceVw, 25);
});

test("settings template store разделяет press и pulse из schema 34", (context) => {
  const { store } = temporaryStore(context);
  const legacy = entry("legacy-rock-visuals");
  legacy.settingsSchemaVersion = 34;
  legacy.settings = {
    rockPressShrinkPercent: 17,
  };

  const imported = store.importEntries([legacy]).entries[0];

  assert.equal(imported.settingsSchemaVersion, 35);
  assert.equal(imported.settings.rockPressShrinkPercent, 17);
  assert.equal(imported.settings.rockPulseShrinkPercent, 17);
  assert.equal(imported.settings.rockImageId, "rock-03");
  assert.equal(imported.settings.foldRockImageId, "rock-03");
});

test("latest выбирается по updatedAt, createdAt и id", (context) => {
  const { store } = temporaryStore(context);
  store.importEntries([
    entry("a", {
      createdAt: "2026-07-26T09:00:00.000Z",
      updatedAt: "2026-07-26T11:00:00.000Z",
    }),
    entry("b", {
      createdAt: "2026-07-26T10:00:00.000Z",
      updatedAt: "2026-07-26T11:00:00.000Z",
    }),
    entry("c", {
      createdAt: "2026-07-26T10:00:00.000Z",
      updatedAt: "2026-07-26T11:00:00.000Z",
    }),
  ]);

  assert.equal(store.latest().id, "c");
});

test("import дедуплицирует id+updatedAt и ветвит расхождение id", (context) => {
  const { store } = temporaryStore(context);
  const original = entry("version-a");
  assert.equal(store.importEntries([original]).entries.length, 1);
  assert.equal(store.importEntries([original]).entries.length, 0);

  const result = store.importEntries([
    entry("version-a", {
      updatedAt: "2026-07-26T11:00:00.000Z",
      gravity: 8,
    }),
  ]);

  assert.equal(result.entries.length, 1);
  assert.notEqual(result.entries[0].id, "version-a");
  assert.match(result.entries[0].name, /импорт/);
  assert.equal(store.list().length, 2);
});

test("optimistic save создаёт ветку и защищает production entry", (context) => {
  const { store } = temporaryStore(context, {
    now: () => Date.parse("2026-07-26T12:00:00.000Z"),
  });
  const first = store.saveEntry(entry("version-a")).entry;
  const branch = store.saveEntry(
    { ...first, settings: { ...first.settings, gravity: 9 } },
    {
      baseUpdatedAt: "2026-07-26T09:00:00.000Z",
      protectedId: "version-a",
    },
  );

  assert.equal(branch.branched, true);
  assert.notEqual(branch.entry.id, "version-a");
  assert.equal(store.list().length, 2);
  const missingBase = store.saveEntry(
    { ...first, settings: { ...first.settings, gravity: 10 } },
    { protectedId: "version-a" },
  );
  assert.equal(missingBase.branched, true);
  assert.notEqual(missingBase.entry.id, "version-a");
  assert.equal(store.list().length, 3);
  assert.throws(
    () => store.deleteEntry("version-a", { protectedId: "version-a" }),
    { code: "production_template_protected" },
  );
});

test("ошибка записи не меняет canonical каталог и ревизию", (context) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "sisyphus-settings-templates-blocked-"),
  );
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const blockedDirectory = path.join(directory, "not-a-directory");
  fs.writeFileSync(blockedDirectory, "blocked", "utf8");
  const store = new SettingsTemplateStore(
    path.join(blockedDirectory, "settings-templates.json"),
  );

  assert.throws(() => store.saveEntry(entry("version-a")));
  assert.equal(store.revision, 0);
  assert.deepEqual(store.list(), []);
});

test("повреждённый settings template store даёт пустой fallback", (context) => {
  const events = [];
  const { filePath, store } = temporaryStore(context, {
    logger: (event) => events.push(event),
  });
  assert.deepEqual(store.load(), []);
  fs.writeFileSync(filePath, "{broken", "utf8");
  assert.deepEqual(store.load(), []);
  assert.deepEqual(events, [
    "settings_template_store_missing",
    "settings_template_store_load_error",
  ]);
});
