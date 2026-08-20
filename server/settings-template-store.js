"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Physics = require("../shared/physics");
const RoomSettings = require("../shared/room-settings");

const STORE_VERSION = 1;
const SETTINGS_SCHEMA_VERSION = RoomSettings.ROOM_SETTINGS_VERSION;
const MAX_ENTRIES = 50;
const MAX_ID_LENGTH = 180;
const MAX_NAME_LENGTH = 120;
const MAX_PAGE_SIZE = 10;

function validationError(message) {
  const error = new Error(message);
  error.code = "invalid_settings_template";
  return error;
}

function requiredString(value, field, maxLength) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength) {
    throw validationError(`invalid_${field}`);
  }
  return normalized;
}

function normalizedTimestamp(value, field, fallback) {
  const timestamp = Date.parse(String(value || ""));
  if (Number.isFinite(timestamp)) {
    return new Date(timestamp).toISOString();
  }
  if (fallback !== undefined) {
    return new Date(fallback).toISOString();
  }
  throw validationError(`invalid_${field}`);
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
  if (Number(settingsSchemaVersion) < 50) {
    migratedSettings = RoomSettings.migrateRoomSettings(migratedSettings, 49);
  }
  if (Number(settingsSchemaVersion) < 51) {
    migratedSettings = RoomSettings.migrateRoomSettings(migratedSettings, 50);
  }
  if (Number(settingsSchemaVersion) < 52) {
    migratedSettings = RoomSettings.migrateRoomSettings(migratedSettings, 51);
  }
  return {
    ...RoomSettings.sanitizeRoomSettings(migratedSettings),
    ...Physics.sanitizePhysics(migratedSettings),
  };
}

function normalizeEntry(entry, options = {}) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw validationError("invalid_entry");
  }
  const now = options.now ?? Date.now();
  const settingsSchemaVersion = Number(entry.settingsSchemaVersion);
  if (
    !Number.isSafeInteger(settingsSchemaVersion) ||
    settingsSchemaVersion <= 0
  ) {
    throw validationError("invalid_settings_schema_version");
  }
  const createdAt = normalizedTimestamp(
    entry.createdAt,
    "created_at",
    options.allowTimestampFallback ? now : undefined,
  );
  const updatedAt = normalizedTimestamp(
    entry.updatedAt,
    "updated_at",
    options.allowTimestampFallback ? now : undefined,
  );
  return {
    id: requiredString(entry.id, "id", MAX_ID_LENGTH),
    name: requiredString(entry.name, "name", MAX_NAME_LENGTH),
    settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
    createdAt,
    updatedAt,
    settings: normalizeSettings(entry.settings, settingsSchemaVersion),
  };
}

function copyEntry(entry) {
  return {
    ...entry,
    settings: { ...entry.settings },
  };
}

function compareLatest(left, right) {
  const updated = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  if (updated !== 0) {
    return updated;
  }
  const created = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (created !== 0) {
    return created;
  }
  return String(right.id).localeCompare(String(left.id));
}

function normalizeDocument(document) {
  if (
    !document ||
    typeof document !== "object" ||
    document.version !== STORE_VERSION ||
    !Array.isArray(document.entries)
  ) {
    throw validationError("unsupported_settings_template_store_format");
  }
  const revision = Number(document.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw validationError("invalid_store_revision");
  }
  return {
    version: STORE_VERSION,
    savedAt: normalizedTimestamp(document.savedAt, "saved_at"),
    revision,
    entries: document.entries
      .map((entry) => normalizeEntry(entry))
      .slice(-MAX_ENTRIES),
  };
}

class SettingsTemplateStore {
  constructor(filePath, options = {}) {
    this.filePath = String(filePath || "").trim();
    this.logger = options.logger || (() => {});
    this.now = options.now || Date.now;
    this.entries = [];
    this.revision = 0;
  }

  get enabled() {
    return this.filePath.length > 0;
  }

  load() {
    if (!this.enabled) {
      this.logger("settings_template_store_disabled");
      return [];
    }
    if (!fs.existsSync(this.filePath)) {
      this.logger("settings_template_store_missing");
      return [];
    }
    try {
      const document = normalizeDocument(
        JSON.parse(fs.readFileSync(this.filePath, "utf8")),
      );
      this.entries = document.entries;
      this.revision = document.revision;
      this.logger("settings_template_store_loaded", {
        entries: this.entries.length,
        revision: this.revision,
      });
      return this.list();
    } catch (error) {
      this.entries = [];
      this.revision = 0;
      this.logger("settings_template_store_load_error", {
        message: error.message,
      });
      return [];
    }
  }

  list() {
    return this.entries.map(copyEntry);
  }

  latest() {
    const latest = [...this.entries].sort(compareLatest)[0];
    return latest ? copyEntry(latest) : null;
  }

  page(offset = 0, limit = MAX_PAGE_SIZE) {
    const normalizedOffset = Math.max(0, Number(offset) || 0);
    const normalizedLimit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number(limit) || MAX_PAGE_SIZE),
    );
    const entries = [...this.entries].sort(compareLatest);
    const pageEntries = entries
      .slice(normalizedOffset, normalizedOffset + normalizedLimit)
      .map(copyEntry);
    const nextOffset =
      normalizedOffset + pageEntries.length < entries.length
        ? normalizedOffset + pageEntries.length
        : null;
    return {
      revision: this.revision,
      offset: normalizedOffset,
      nextOffset,
      entries: pageEntries,
    };
  }

  generatedId(prefix = "settings-version") {
    return `${prefix}-${this.now().toString(36)}-${crypto
      .randomBytes(9)
      .toString("base64url")}`;
  }

  uniqueName(name, suffix) {
    const cleanName = requiredString(name, "name", MAX_NAME_LENGTH);
    const cleanSuffix = String(suffix || "").trim();
    if (!cleanSuffix) {
      return cleanName;
    }
    const available = Math.max(1, MAX_NAME_LENGTH - cleanSuffix.length - 1);
    return `${cleanName.slice(0, available)} ${cleanSuffix}`;
  }

  trim(protectedId = "") {
    while (this.entries.length > MAX_ENTRIES) {
      const candidates = this.entries
        .filter((entry) => entry.id !== protectedId)
        .sort((left, right) => compareLatest(right, left));
      const oldest = candidates[0];
      if (!oldest) {
        throw validationError("settings_template_limit_reached");
      }
      this.entries = this.entries.filter((entry) => entry.id !== oldest.id);
    }
  }

  commit(protectedId = "") {
    if (!this.enabled) {
      const error = new Error("settings_template_store_disabled");
      error.code = "settings_template_store_unavailable";
      throw error;
    }
    this.trim(protectedId);
    const nextRevision = this.revision + 1;
    const document = {
      version: STORE_VERSION,
      savedAt: new Date(this.now()).toISOString(),
      revision: nextRevision,
      entries: this.entries,
    };
    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      fs.renameSync(temporaryPath, this.filePath);
    } catch (error) {
      try {
        fs.rmSync(temporaryPath, { force: true });
      } catch {
        // Ошибка очистки не должна скрывать исходную ошибку записи.
      }
      if (!error.code) {
        error.code = "settings_template_store_unavailable";
      }
      this.logger("settings_template_store_save_error", {
        message: error.message,
      });
      throw error;
    }
    this.revision = nextRevision;
    return this.revision;
  }

  importEntries(entries, options = {}) {
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > 10) {
      throw validationError("invalid_import_batch");
    }
    const previousEntries = this.entries.map(copyEntry);
    const previousRevision = this.revision;
    const imported = [];
    try {
      entries.forEach((rawEntry) => {
        const entry = normalizeEntry(rawEntry);
        const existing = this.entries.find(
          (candidate) => candidate.id === entry.id,
        );
        if (existing?.updatedAt === entry.updatedAt) {
          return;
        }
        if (existing) {
          entry.id = this.generatedId("settings-import");
          entry.name = this.uniqueName(entry.name, "(импорт)");
        }
        this.entries.push(entry);
        imported.push(copyEntry(entry));
      });
      if (imported.length > 0) {
        this.commit(options.protectedId);
      }
    } catch (error) {
      this.entries = previousEntries;
      this.revision = previousRevision;
      throw error;
    }
    return {
      revision: this.revision,
      entries: imported,
    };
  }

  saveEntry(rawEntry, options = {}) {
    const now = this.now();
    const entry = normalizeEntry(rawEntry, {
      now,
      allowTimestampFallback: true,
    });
    const previousEntries = this.entries.map(copyEntry);
    const previousRevision = this.revision;
    const existingIndex = this.entries.findIndex(
      (candidate) => candidate.id === entry.id,
    );
    let branched = false;
    try {
      if (existingIndex >= 0) {
        const existing = this.entries[existingIndex];
        if (String(options.baseUpdatedAt || "") !== existing.updatedAt) {
          branched = true;
          entry.id = this.generatedId("settings-conflict");
          entry.name = this.uniqueName(entry.name, "(конфликт)");
          entry.createdAt = new Date(now).toISOString();
        } else {
          entry.createdAt = existing.createdAt;
        }
      }
      entry.updatedAt = new Date(now).toISOString();
      if (branched || existingIndex < 0) {
        this.entries.push(entry);
      } else {
        this.entries[existingIndex] = entry;
      }
      this.commit(options.protectedId);
    } catch (error) {
      this.entries = previousEntries;
      this.revision = previousRevision;
      throw error;
    }
    return {
      revision: this.revision,
      entry: copyEntry(entry),
      branched,
    };
  }

  createConflict(settings, options = {}) {
    const now = this.now();
    const timestamp = new Date(now).toISOString().replace("T", " ").slice(0, 19);
    const entry = normalizeEntry(
      {
        id: this.generatedId("settings-conflict"),
        name: this.uniqueName(options.name || "Конфликт", timestamp),
        settingsSchemaVersion:
          Number(options.settingsSchemaVersion) || SETTINGS_SCHEMA_VERSION,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        settings,
      },
      { now, allowTimestampFallback: true },
    );
    const previousEntries = this.entries.map(copyEntry);
    const previousRevision = this.revision;
    try {
      this.entries.push(entry);
      this.commit(options.protectedId);
    } catch (error) {
      this.entries = previousEntries;
      this.revision = previousRevision;
      throw error;
    }
    return {
      revision: this.revision,
      entry: copyEntry(entry),
    };
  }

  deleteEntry(id, options = {}) {
    const normalizedId = requiredString(id, "id", MAX_ID_LENGTH);
    if (normalizedId === options.protectedId) {
      const error = validationError("production_template_protected");
      error.code = "production_template_protected";
      throw error;
    }
    const previousEntries = this.entries.map(copyEntry);
    const previousRevision = this.revision;
    const before = this.entries.length;
    this.entries = this.entries.filter((entry) => entry.id !== normalizedId);
    if (this.entries.length === before) {
      return { revision: this.revision, deletedId: null };
    }
    try {
      this.commit(options.protectedId);
    } catch (error) {
      this.entries = previousEntries;
      this.revision = previousRevision;
      throw error;
    }
    return { revision: this.revision, deletedId: normalizedId };
  }
}

module.exports = {
  SettingsTemplateStore,
  STORE_VERSION,
  SETTINGS_SCHEMA_VERSION,
  MAX_ENTRIES,
  MAX_PAGE_SIZE,
  compareLatest,
  normalizeDocument,
  normalizeEntry,
  normalizeSettings,
};
