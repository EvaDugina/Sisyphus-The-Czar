import "../../shared/physics.js";
import "../../shared/room-settings.js";

import { createClientId } from "../lib/clientId.mjs";
import {
  DEFAULT_GLOW_OPTIMIZATION_SETTINGS,
  sanitizeGlowOptimizationSettings,
} from "../lib/glowOptimization.mjs";
import {
  resolveProductionPresetMessage,
} from "../lib/productionPresetMessages.mjs";
import { createSettingsController } from "./createSettingsController.js";
import {
  createWindowObstacleController,
  WINDOW_OBSTACLE_PERMISSION,
} from "./createWindowObstacleController.js";

const SETTINGS_SCHEMA_VERSION = 43;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

function randomRequestId() {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `settings-${Date.now().toString(36)}-${random}`;
}

export function createSettingsPageRuntime(elements = {}) {
  const SharedPhysics = globalThis.SisyphusPhysics;
  const SharedRoomSettings = globalThis.SisyphusRoomSettings;
  const listenerDisposers = [];
  const params = {
    ...SharedPhysics.DEFAULT_PHYSICS,
    ...SharedRoomSettings.DEFAULT_ROOM_SETTINGS,
    ...DEFAULT_GLOW_OPTIMIZATION_SETTINGS,
  };
  const collab = {
    enabled: true,
    connected: false,
  };
  let disposed = false;
  let socket = null;
  let sequence = 0;
  let settingsRevision = 0;
  let reconnectTimerId = null;
  let sessionCreateInFlight = false;
  let pendingRequestId = "";
  let combinedSave = null;
  let restoredSettingsAtLaunch = null;
  let settingsController;

  const listen = (target, type, listener, options) => {
    if (!target || typeof target.addEventListener !== "function") {
      return;
    }
    target.addEventListener(type, listener, options);
    listenerDisposers.push(() => target.removeEventListener(type, listener, options));
  };

  const status = elements.status || document.querySelector(".settings-production-status");
  const sessionStatus =
    elements.sessionStatus || document.querySelector("[data-session-status]");

  function setStatus(message, state = "") {
    if (status) {
      status.textContent = message;
      status.dataset.state = state;
    }
  }

  function setSessionStatus(message, state = "local") {
    if (sessionStatus) {
      sessionStatus.textContent = message;
      sessionStatus.dataset.state = state;
    }
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function secondsOutput(seconds) {
    const value = Number(seconds);
    return `${Number.isFinite(value) ? value.toFixed(1) : "0.0"} s`;
  }

  function settingValueToControlValue(key, value) {
    if (key === "heightGates") {
      return JSON.stringify(SharedRoomSettings.sanitizeHeightGates(value));
    }
    if (key === "rainEnterMs" || key === "rainExitMs") {
      return String(Number(value) / 1000);
    }
    return String(value);
  }

  function controlValueToSettingValue(input, key) {
    if (!input) {
      return undefined;
    }
    if (input.type === "checkbox") {
      return Boolean(input.checked);
    }
    if (key === "heightGates") {
      try {
        return SharedRoomSettings.sanitizeHeightGates(JSON.parse(input.value || "[]"));
      } catch {
        return [];
      }
    }
    if (key === "rainEnterMs" || key === "rainExitMs") {
      return Math.round(Number(input.value) * 1000);
    }
    return input.value;
  }

  function readDraftControls() {
    if (!settingsController) {
      return;
    }
    Object.assign(
      params,
      SharedPhysics.sanitizePhysics(
        settingsController.readPhysicsControls(),
        params,
      ),
      SharedRoomSettings.sanitizeRoomSettings(
        settingsController.readRoomSettingsControls(),
        params,
      ),
      sanitizeGlowOptimizationSettings(
        settingsController.readLocalSettingsControls(),
        params,
      ),
    );
    settingsController.updateControlOutputs();
  }

  function sharedSettingsPayload() {
    return {
      ...SharedRoomSettings.sanitizeRoomSettings(params),
      ...SharedPhysics.sanitizePhysics(params),
    };
  }

  function send(type, payload = {}) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    sequence += 1;
    socket.send(JSON.stringify({ v: 1, type, seq: sequence, payload }));
    return true;
  }

  function updateCombinedSaveStatus() {
    if (!combinedSave) {
      return false;
    }
    if (combinedSave.error) {
      setStatus(combinedSave.error, "error");
      if (!combinedSave.versionPending && !combinedSave.roomPending) {
        combinedSave = null;
      }
      return true;
    }
    if (combinedSave.versionPending || combinedSave.roomPending) {
      setStatus("Сохраняем версию и настройки комнаты…", "pending");
      return true;
    }
    setStatus(
      "Версия и настройки комнаты сохранены. Перезагрузите сцену.",
      "success",
    );
    combinedSave = null;
    return true;
  }

  function failCombinedSave(message, failedPart = "") {
    if (!combinedSave) {
      return false;
    }
    combinedSave.error = String(message || "Не удалось сохранить настройки");
    if (failedPart === "version") {
      combinedSave.versionPending = false;
    } else if (failedPart === "room") {
      combinedSave.roomPending = false;
    }
    updateCombinedSaveStatus();
    return true;
  }

  function saveRoomSettings({ versionSavePending = false } = {}) {
    readDraftControls();
    combinedSave = {
      error: "",
      roomPending: false,
      versionPending: Boolean(versionSavePending),
    };
    if (!socket || socket.readyState !== WebSocket.OPEN || settingsRevision < 1) {
      failCombinedSave("Нет соединения с комнатой", "room");
      return false;
    }
    pendingRequestId = randomRequestId();
    const sent = send("settings.update", {
      requestId: pendingRequestId,
      baseRevision: settingsRevision,
      settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
      settings: sharedSettingsPayload(),
    });
    if (sent) {
      combinedSave.roomPending = true;
      updateCombinedSaveStatus();
    } else {
      failCombinedSave("Не удалось отправить настройки комнаты", "room");
    }
    return sent;
  }

  function applyRestoredRoomSettings() {
    if (!socket || socket.readyState !== WebSocket.OPEN || settingsRevision < 1) {
      return false;
    }
    pendingRequestId = randomRequestId();
    return send("settings.update", {
      requestId: pendingRequestId,
      baseRevision: settingsRevision,
      settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
      settings: sharedSettingsPayload(),
    });
  }

  function applySharedSettings(payload = {}, preservedSettings = null) {
    if (payload.physics && typeof payload.physics === "object") {
      Object.assign(params, SharedPhysics.sanitizePhysics(payload.physics, params));
    }
    if (payload.roomSettings && typeof payload.roomSettings === "object") {
      Object.assign(
        params,
        SharedRoomSettings.sanitizeRoomSettings(payload.roomSettings, params),
      );
    }
    if (preservedSettings && typeof preservedSettings === "object") {
      Object.assign(params, preservedSettings);
    }
    settingsController.syncPhysicsSettingControls();
    settingsController.syncRoomSettingControls();
    settingsController.syncLocalSettingControls();
    settingsController.updateControlOutputs();
    settingsController.markRoomSettingsSaved();
  }

  function handleMessage(message) {
    if (!message || message.v !== 1 || typeof message.type !== "string") {
      return;
    }
    const payload = message.payload || {};
    const productionPresetMessage = resolveProductionPresetMessage(message);
    if (productionPresetMessage?.kind === "state") {
      settingsController.setProductionPresetState(
        productionPresetMessage.payload,
      );
      return;
    }
    if (productionPresetMessage?.kind === "error") {
      settingsController.setProductionPresetError(
        productionPresetMessage.message,
      );
      return;
    }
    if (message.type === "session.snapshot") {
      const revision = Number(payload.settingsRevision);
      if (Number.isSafeInteger(revision) && revision > 0) {
        settingsRevision = revision;
      }
      const restoredSettings = restoredSettingsAtLaunch;
      restoredSettingsAtLaunch = null;
      applySharedSettings(payload, restoredSettings);
      setSessionStatus("В сессии: настройки комнаты общие для всех", "online");
      if (restoredSettings) {
        settingsController.saveSettings();
        const restoredKeys = Object.keys(restoredSettings);
        const hasSharedSettings = restoredKeys.some(
          (key) =>
            Object.hasOwn(SharedPhysics.DEFAULT_PHYSICS, key) ||
            SharedRoomSettings.ROOM_SETTINGS_KEYS.includes(key),
        );
        if (hasSharedSettings) {
          applyRestoredRoomSettings();
        }
      }
      return;
    }
    if (message.type === "settings.applied") {
      if (String(payload.requestId || "") !== pendingRequestId) {
        return;
      }
      settingsRevision = Math.max(settingsRevision, Number(payload.settingsRevision) || 0);
      pendingRequestId = "";
      settingsController.saveSettings();
      settingsController.markRoomSettingsSaved();
      if (combinedSave) {
        combinedSave.roomPending = false;
        updateCombinedSaveStatus();
      } else {
        setStatus("Сохранено для всех участников. Перезагрузите сцену.", "success");
      }
      return;
    }
    if (message.type === "settings.conflict") {
      pendingRequestId = "";
      const conflictMessage =
        "Настройки уже изменил другой участник. Обновите страницу.";
      if (!failCombinedSave(conflictMessage, "room")) {
        setStatus(conflictMessage, "error");
      }
      return;
    }
    if (message.type === "settingsTemplates.page") {
      settingsController.setSettingsTemplatesPage(payload);
    } else if (message.type === "settingsTemplates.imported") {
      settingsController.setSettingsTemplatesImported(payload);
    } else if (message.type === "settingsTemplates.saved") {
      settingsController.setSettingsTemplateSaved(payload);
      if (combinedSave?.versionPending) {
        combinedSave.versionPending = false;
        updateCombinedSaveStatus();
      }
    } else if (message.type === "settingsTemplates.deleted") {
      settingsController.setSettingsTemplateDeleted(payload);
    } else if (message.type === "settingsTemplates.changed") {
      settingsController.applySettingsTemplateChange(payload);
    } else if (message.type === "error") {
      const errorMessage = String(
        payload.message || "Не удалось сохранить настройки",
      );
      if (!failCombinedSave(errorMessage, "version")) {
        setStatus(errorMessage, "error");
      }
    }
  }

  function clearReconnectTimer() {
    if (reconnectTimerId !== null) {
      window.clearTimeout(reconnectTimerId);
      reconnectTimerId = null;
    }
  }

  function scheduleReconnect() {
    if (disposed || reconnectTimerId !== null) {
      return;
    }
    reconnectTimerId = window.setTimeout(() => {
      reconnectTimerId = null;
      void ensureSessionAndConnect();
    }, 1000);
  }

  function connectSharedSession(sessionId) {
    if (disposed || !SESSION_ID_PATTERN.test(sessionId)) {
      return;
    }
    clearReconnectTimer();
    const endpoint = new URL("/realtime", window.location.origin);
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    endpoint.searchParams.set("session", sessionId);
    endpoint.searchParams.set("client", getClientId());
    socket = new WebSocket(endpoint);
    setSessionStatus("Подключаемся к комнате…", "connecting");
    socket.addEventListener("open", () => {
      if (!socket) {
        return;
      }
      collab.connected = true;
      send("ping", { clientTime: Date.now() });
      send("settingsTemplates.list", { offset: 0, limit: 10 });
      setSessionStatus("Подключено к общей комнате", "online");
    });
    socket.addEventListener("message", (event) => {
      try {
        handleMessage(JSON.parse(event.data));
      } catch {
        /* Игнорируем повреждённое сообщение */
      }
    });
    socket.addEventListener("close", (event) => {
      collab.connected = false;
      socket = null;
      if (event.code === 4004) {
        try {
          sessionStorage.removeItem("sisyphus-room-session-id");
        } catch {
          /* sessionStorage недоступен */
        }
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete("session");
        window.history.replaceState(
          null,
          "",
          `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`,
        );
      }
      setSessionStatus("Соединение потеряно, переподключаемся…", "connecting");
      scheduleReconnect();
    });
  }

  function getClientId() {
    try {
      const stored = sessionStorage.getItem("sisyphus-client-id");
      if (stored) {
        return stored;
      }
      const created = createClientId();
      sessionStorage.setItem("sisyphus-client-id", created);
      return created;
    } catch {
      return createClientId();
    }
  }

  async function ensureSessionAndConnect() {
    if (disposed || sessionCreateInFlight || socket) {
      return;
    }
    sessionCreateInFlight = true;
    try {
      const urlSessionId = new URL(window.location.href).searchParams.get("session") || "";
      let sessionId = SESSION_ID_PATTERN.test(urlSessionId) ? urlSessionId : "";
      if (!sessionId) {
        try {
          const stored = sessionStorage.getItem("sisyphus-room-session-id") || "";
          sessionId = SESSION_ID_PATTERN.test(stored) ? stored : "";
        } catch {
          sessionId = "";
        }
      }
      if (!sessionId) {
        const response = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const result = await response.json();
        sessionId = String(result.sessionId || "");
      }
      if (!SESSION_ID_PATTERN.test(sessionId)) {
        throw new Error("invalid_session_response");
      }
      try {
        sessionStorage.setItem("sisyphus-room-session-id", sessionId);
      } catch {
        /* sessionStorage недоступен */
      }
      connectSharedSession(sessionId);
    } catch (error) {
      setSessionStatus("Не удалось подключиться к комнате", "error");
      setStatus(error?.message || "Не удалось подключиться к комнате", "error");
      scheduleReconnect();
    } finally {
      sessionCreateInFlight = false;
    }
  }

  settingsController = createSettingsController({
    SharedPhysics,
    SharedRoomSettings,
    clamp,
    collab,
    controlValueToSettingValue,
    draftOnly: true,
    hintEl: elements.hint,
    listen,
    localCanEditSettings: () => true,
    onDeleteSettingsTemplate: (id) => send("settingsTemplates.delete", { id }),
    onImportSettingsTemplates: (entries) =>
      send("settingsTemplates.import", { entries }),
    onListSettingsTemplates: (payload) => send("settingsTemplates.list", payload),
    onSaveRoomSettings: saveRoomSettings,
    onSaveSettingsTemplate: (entry, baseUpdatedAt) =>
      send("settingsTemplates.save", { entry, baseUpdatedAt }),
    onSelectProductionPreset: (selection) =>
      send("productionPreset.select", selection),
    params,
    readControls: readDraftControls,
    resetTrail: () => {},
    secondsOutput,
    settingValueToControlValue,
    settingsPanel: elements.settingsPanel,
    stageControlChange: () => {},
  });

  const restoredSettingKeys = settingsController.load({
    loadLocalSettings: true,
    loadLatestVersion: false,
    loadVersionedSettings: true,
  });
  readDraftControls();
  if (restoredSettingKeys.length > 0) {
    restoredSettingsAtLaunch = Object.fromEntries(
      restoredSettingKeys.map((key) => [key, params[key]]),
    );
  }
  settingsController.syncRoomSettingControls();
  settingsController.syncLocalSettingControls();
  settingsController.updateControlOutputs();
  settingsController.bind();
  const windowObstaclePopupTest = document.querySelector(
    "[data-window-obstacle-popup-test]",
  );
  const windowObstaclePopupStatus = document.querySelector(
    "[data-window-obstacle-popup-status]",
  );
  const windowObstaclePopupHelp = document.querySelector(
    "[data-window-obstacle-popup-help]",
  );
  const windowObstacleController = createWindowObstacleController({
    getSettings: () => SharedRoomSettings.sanitizeRoomSettings(params),
    onPermissionChange: (permission, label) => {
      if (windowObstaclePopupStatus) {
        windowObstaclePopupStatus.dataset.state = permission;
        windowObstaclePopupStatus.textContent = label;
      }
      if (windowObstaclePopupHelp) {
        windowObstaclePopupHelp.hidden =
          permission !== WINDOW_OBSTACLE_PERMISSION.BLOCKED;
      }
      if (windowObstaclePopupTest) {
        windowObstaclePopupTest.disabled =
          permission === WINDOW_OBSTACLE_PERMISSION.TEST_OPENED;
      }
    },
  });
  listen(windowObstaclePopupTest, "click", () => {
    windowObstacleController.testPopupPermission();
  });
  void ensureSessionAndConnect();

  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      clearReconnectTimer();
      settingsController.dispose?.();
      windowObstacleController.dispose();
      listenerDisposers.splice(0).forEach((dispose) => dispose());
      if (socket && socket.readyState < WebSocket.CLOSING) {
        socket.close(1000, "settings_page_unmount");
      }
      socket = null;
    },
  };
}
