"use strict";

const fs = require("node:fs");
const path = require("node:path");

const STORE_VERSION = 1;

class SessionStore {
  constructor(filePath, options = {}) {
    this.filePath = String(filePath || "").trim();
    this.logger = options.logger || (() => {});
    this.lastSerializedSessions = null;
  }

  get enabled() {
    return this.filePath.length > 0;
  }

  load() {
    if (!this.enabled || !fs.existsSync(this.filePath)) {
      return [];
    }

    try {
      const document = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (
        !document ||
        document.version !== STORE_VERSION ||
        !Array.isArray(document.sessions)
      ) {
        throw new Error("unsupported_session_store_format");
      }
      this.lastSerializedSessions = JSON.stringify(document.sessions);
      this.logger("session_store_loaded", { sessions: document.sessions.length });
      return document.sessions;
    } catch (error) {
      this.logger("session_store_load_error", { message: error.message });
      return [];
    }
  }

  save(sessions, options = {}) {
    if (!this.enabled) {
      return false;
    }

    const serializedSessions = JSON.stringify(
      Array.isArray(sessions) ? sessions : []
    );
    if (!options.force && serializedSessions === this.lastSerializedSessions) {
      return false;
    }

    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(
        temporaryPath,
        JSON.stringify({
          version: STORE_VERSION,
          savedAt: Date.now(),
          sessions: JSON.parse(serializedSessions),
        }),
        { encoding: "utf8", mode: 0o600 }
      );
      fs.renameSync(temporaryPath, this.filePath);
      this.lastSerializedSessions = serializedSessions;
      return true;
    } catch (error) {
      try {
        fs.rmSync(temporaryPath, { force: true });
      } catch {
        // Ошибка очистки временного файла не должна скрывать исходную ошибку.
      }
      this.logger("session_store_save_error", { message: error.message });
      return false;
    }
  }
}

module.exports = {
  SessionStore,
  STORE_VERSION,
};
