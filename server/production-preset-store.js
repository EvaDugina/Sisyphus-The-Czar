"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Physics = require("../shared/physics");
const RoomSettings = require("../shared/room-settings");

const STORE_VERSION = 1;
const SETTINGS_SCHEMA_VERSION = 49;
const MAX_SOURCE_ID_LENGTH = 180;
const MAX_SOURCE_NAME_LENGTH = 120;

function validationError(message) {
  const error = new Error(message);
  error.code = "invalid_production_preset";
  return error;
}

function requiredString(value, field, maxLength) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength) {
    throw validationError(`invalid_${field}`);
  }
  return normalized;
}

function normalizedTimestamp(value, field) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) {
    throw validationError(`invalid_${field}`);
  }
  return new Date(timestamp).toISOString();
}

function normalizeSettings(settings, settingsSchemaVersion) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw validationError("invalid_settings");
  }
  let migratedSettings = settings;
  if (Number(settingsSchemaVersion) < 33) {
    migratedSettings = RoomSettings.migrateFoldSettings(migratedSettings);
  }
  if (Number(settingsSchemaVersion) < 35) {
    migratedSettings = RoomSettings.migrateRockVisualSettings(migratedSettings);
  }
  if (Number(settingsSchemaVersion) < 36) {
    migratedSettings = RoomSettings.migratePreclickHopSettings(migratedSettings);
  }
  if (Number(settingsSchemaVersion) < 37) {
    migratedSettings = RoomSettings.migrateHandDisplaySettings(migratedSettings);
  }
  if (Number(settingsSchemaVersion) < 38) {
    migratedSettings = RoomSettings.migrateFoldLayoutSettings(migratedSettings);
  }
  if (Number(settingsSchemaVersion) < 40) {
    migratedSettings = RoomSettings.migratePreclickHopSettings(migratedSettings);
  }
  if (Number(settingsSchemaVersion) < 41) {
    migratedSettings = RoomSettings.migrateRoomSettings(migratedSettings, 40);
  }
  if (Number(settingsSchemaVersion) < 42) {
    migratedSettings = RoomSettings.migrateRoomSettings(migratedSettings, 41);
  }
  if (Number(settingsSchemaVersion) < 43) {
    migratedSettings = RoomSettings.migrateRoomSettings(migratedSettings, 42);
  }
  if (Number(settingsSchemaVersion) < 44) {
    migratedSettings = RoomSettings.migrateRoomSettings(migratedSettings, 43);
  }
  if (Number(settingsSchemaVersion) < 45) {
    migratedSettings = RoomSettings.migrateRoomSettings(migratedSettings, 44);
  }
  if (Number(settingsSchemaVersion) < 46) {
    migratedSettings = RoomSettings.migrateRoomSettings(migratedSettings, 45);
  }
  if (Number(settingsSchemaVersion) < 49) {
    migratedSettings = RoomSettings.migrateRoomSettings(migratedSettings, 48);
  }
  return {
    ...RoomSettings.sanitizeRoomSettings(migratedSettings),
    ...Physics.sanitizePhysics(migratedSettings),
  };
}

function normalizeSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw validationError("invalid_source");
  }
  const settingsSchemaVersion = Number(source.settingsSchemaVersion);
  if (
    !Number.isSafeInteger(settingsSchemaVersion) ||
    settingsSchemaVersion <= 0
  ) {
    throw validationError("invalid_settings_schema_version");
  }
  return {
    id: requiredString(source.id, "source_id", MAX_SOURCE_ID_LENGTH),
    name: requiredString(source.name, "source_name", MAX_SOURCE_NAME_LENGTH),
    settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
    updatedAt: normalizedTimestamp(source.updatedAt, "source_updated_at"),
  };
}

function normalizeSelection(selection, now = Date.now()) {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
    throw validationError("invalid_selection");
  }
  const source = normalizeSource(selection);
  return {
    version: STORE_VERSION,
    selectedAt: new Date(now).toISOString(),
    source,
    settings: normalizeSettings(
      selection.settings,
      selection.settingsSchemaVersion,
    ),
  };
}

function normalizeDocument(document) {
  if (
    !document ||
    typeof document !== "object" ||
    document.version !== STORE_VERSION
  ) {
    throw validationError("unsupported_production_preset_store_format");
  }
  const source = normalizeSource(document.source);
  return {
    version: STORE_VERSION,
    selectedAt: normalizedTimestamp(document.selectedAt, "selected_at"),
    source,
    settings: normalizeSettings(
      document.settings,
      document.source.settingsSchemaVersion,
    ),
  };
}

class ProductionPresetStore {
  constructor(filePath, options = {}) {
    this.filePath = String(filePath || "").trim();
    this.logger = options.logger || (() => {});
    this.now = options.now || Date.now;
    this.current = null;
  }

  get enabled() {
    return this.filePath.length > 0;
  }

  metadata() {
    if (!this.current) {
      return null;
    }
    return {
      selectedAt: this.current.selectedAt,
      source: { ...this.current.source },
    };
  }

  load() {
    if (!this.enabled) {
      this.logger("production_preset_store_disabled");
      return null;
    }
    if (!fs.existsSync(this.filePath)) {
      this.logger("production_preset_store_missing");
      return null;
    }
    try {
      const document = normalizeDocument(
        JSON.parse(fs.readFileSync(this.filePath, "utf8")),
      );
      this.current = document;
      this.logger("production_preset_store_loaded", {
        sourceId: document.source.id,
      });
      return {
        ...document,
        source: { ...document.source },
        settings: { ...document.settings },
      };
    } catch (error) {
      this.current = null;
      this.logger("production_preset_store_load_error", {
        message: error.message,
      });
      return null;
    }
  }

  save(selection) {
    if (!this.enabled) {
      const error = new Error("production_preset_store_disabled");
      error.code = "production_preset_store_unavailable";
      throw error;
    }
    const document = normalizeSelection(selection, this.now());
    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(temporaryPath, JSON.stringify(document), {
        encoding: "utf8",
        mode: 0o600,
      });
      fs.renameSync(temporaryPath, this.filePath);
      this.current = document;
      this.logger("production_preset_store_saved", {
        sourceId: document.source.id,
      });
      return {
        ...document,
        source: { ...document.source },
        settings: { ...document.settings },
      };
    } catch (error) {
      try {
        fs.rmSync(temporaryPath, { force: true });
      } catch {
        // Ошибка очистки не должна скрывать исходную ошибку записи.
      }
      if (!error.code) {
        error.code = "production_preset_store_unavailable";
      }
      this.logger("production_preset_store_save_error", {
        message: error.message,
      });
      throw error;
    }
  }
}

module.exports = {
  ProductionPresetStore,
  STORE_VERSION,
  SETTINGS_SCHEMA_VERSION,
  normalizeDocument,
  normalizeSelection,
};
