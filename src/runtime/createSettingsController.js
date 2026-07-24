import katex from "katex";
import "katex/dist/katex.min.css";

import { formatSettingsVersionOptionLabel } from "../lib/settingsVersions.mjs";
import { settingsFromLatestVersionEntry } from "../lib/settingsVersionSelection.mjs";
import {
  LEGACY_SETTINGS_STORAGE_KEYS,
  SETTINGS_GROUPS,
  SETTINGS_STORAGE_KEY,
  SETTINGS_VERSIONS_STORAGE_KEY,
  settingsGroupControls,
} from "../config/settings.mjs";

const SETTINGS_CONTROL_NAMES = SETTINGS_GROUPS.flatMap(settingsGroupControls).map(
  (control) => control.name,
);
const SETTINGS_CONTROL_NAME_SET = new Set(SETTINGS_CONTROL_NAMES);
const SETTINGS_SCHEMA_VERSION = 18;
const SETTINGS_VERSION_LIMIT = 50;

export function createSettingsController(options) {
  const {
    SharedPhysics,
    SharedRoomSettings,
    clamp,
    collab,
    controlValueToSettingValue,
    hintEl,
    listen,
    localCanEditSettings,
    params,
    readControls,
    resetTrail,
    restartExperience,
    secondsOutput,
    settingValueToControlValue,
  } = options;
  const settingsPanel =
    options.settingsPanel || document.querySelector(".settings-panel");
  const settingsVersionName =
    options.settingsVersionName ||
    document.querySelector(".settings-version-name");
  const settingsVersionToggle =
    options.settingsVersionToggle ||
    document.querySelector(".settings-version-toggle");
  const settingsVersionCurrent =
    options.settingsVersionCurrent ||
    document.querySelector("#settings-version-current");
  const settingsVersionMenu =
    options.settingsVersionMenu ||
    document.querySelector(".settings-version-menu");
  const settingsVersionSave =
    options.settingsVersionSave ||
    document.querySelector(".settings-version-save");
  const sessionRestartButton =
    options.sessionRestartButton || document.querySelector(".session-restart");
  const sharedRoomSettingKeys = SharedRoomSettings.ROOM_SETTINGS_KEYS;
  const settingsVersions = {
    entries: [],
    selectedId: "",
  };

  function settingsControlElements() {
    if (!settingsPanel) {
      return [];
    }
    return settingsPanel.querySelectorAll(
      "[data-setting-control] input, [data-setting-control] select",
    );
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(params));
    } catch {
      /* localStorage недоступен — тихо игнорируем */
    }
  }

  function settingsStorageKeyVersion(key) {
    const match = String(key || "").match(/-v(\d+)$/);
    return match ? Number(match[1]) : 0;
  }

  function migrateStoredVerticalInertiaValue(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return value;
    }
    if (number > 10 && number <= 100) {
      return clamp(number / 100, 0, 1);
    }
    if (number > 2 && number <= 10) {
      return clamp(number / 10, 0, 1);
    }
    if (number > 1) {
      return 1;
    }
    if (number > 0 && number <= 0.1) {
      return clamp(number * 10, 0, 1);
    }
    return clamp(number, 0, 1);
  }

  function migrateStoredHorizontalInertiaValue(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return value;
    }
    if (number > 10 && number <= 100) {
      return clamp(number / 1000, 0, 1);
    }
    if (number > 2 && number <= 10) {
      return clamp(number / 100, 0, 1);
    }
    if (number > 1) {
      return 1;
    }
    return clamp(number, 0, 1);
  }

  function migrateStoredInertiaSettings(settings, settingsSchemaVersion = 0) {
    if (settingsSchemaVersion >= SETTINGS_SCHEMA_VERSION) {
      return settings;
    }
    let migrated = settings;
    if (Object.hasOwn(migrated, "inertia")) {
      const inertia = migrateStoredVerticalInertiaValue(migrated.inertia);
      if (inertia !== migrated.inertia) {
        migrated = { ...migrated, inertia };
      }
    }
    if (Object.hasOwn(migrated, "horizontalInertia")) {
      const horizontalInertia = migrateStoredHorizontalInertiaValue(
        migrated.horizontalInertia,
      );
      if (horizontalInertia !== migrated.horizontalInertia) {
        migrated = { ...migrated, horizontalInertia };
      }
    } else {
      migrated = {
        ...migrated,
        horizontalInertia: SharedPhysics.DEFAULT_PHYSICS.horizontalInertia,
      };
    }
    return migrated;
  }

  function loadSettings() {
    let stored = null;
    let migratedLegacySettings = false;
    let legacyKey = null;
    try {
      const current = localStorage.getItem(SETTINGS_STORAGE_KEY);
      const legacyEntry = LEGACY_SETTINGS_STORAGE_KEYS.map((key) => [
        key,
        localStorage.getItem(key),
      ]).find(([, value]) => value !== null);
      legacyKey = legacyEntry?.[0] ?? null;
      const raw = current ?? legacyEntry?.[1];
      migratedLegacySettings = current === null && raw !== null;
      stored = JSON.parse(raw || "null");
    } catch {
      stored = null;
    }
    if (!stored || typeof stored !== "object") {
      return;
    }

    const legacyKeyVersion = settingsStorageKeyVersion(legacyKey);
    const migratedPreV7Settings =
      migratedLegacySettings && legacyKeyVersion > 0 && legacyKeyVersion < 7;
    const migratedPreV10Settings =
      migratedLegacySettings && legacyKeyVersion > 0 && legacyKeyVersion < 10;
    if (migratedPreV7Settings) {
      const legacyHandForce = Number(stored.handForce);
      if (
        Number.isFinite(legacyHandForce) &&
        legacyHandForce >= 0.1 &&
        legacyHandForce <= 10
      ) {
        stored = { ...stored, handForce: legacyHandForce * 10 };
      }
      const legacyInertia = Number(stored.inertia);
      if (
        Number.isFinite(legacyInertia) &&
        legacyInertia >= 0 &&
        legacyInertia <= 1
      ) {
        stored = { ...stored, inertia: legacyInertia * 10 };
      }
      delete stored.mass;
      delete stored.gravity;
    }
    if (migratedLegacySettings) {
      stored = migrateStoredInertiaSettings(stored, legacyKeyVersion);
    } else if (!Object.hasOwn(stored, "horizontalInertia")) {
      stored = {
        ...stored,
        horizontalInertia: SharedPhysics.DEFAULT_PHYSICS.horizontalInertia,
      };
    }
    if (
      !Object.hasOwn(stored, "groundFriction") &&
      Object.hasOwn(stored, "sliding")
    ) {
      stored = { ...stored, groundFriction: stored.sliding };
    }
    if (migratedLegacySettings) {
      stored = { ...stored };
      delete stored.trailEnabled;
      if (migratedPreV10Settings && Number.isFinite(Number(stored.handWidthVw))) {
        stored.handWidthVw = Number(stored.handWidthVw) / 2;
      }
      if (
        migratedPreV10Settings &&
        Number.isFinite(Number(stored.slaveHandWidthPx))
      ) {
        stored.slaveHandWidthPx = Number(stored.slaveHandWidthPx) / 2;
      }
    }

    settingsControlElements().forEach((element) => {
      const key = element.getAttribute("name");
      if (!key || !(key in stored)) {
        return;
      }
      if (element.type === "checkbox") {
        element.checked = Boolean(stored[key]);
      } else {
        element.value = settingValueToControlValue(key, stored[key]);
      }
    });
  }

  function normalizeSettingsVersionEntry(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const settings =
      entry.settings && typeof entry.settings === "object"
        ? migrateStoredInertiaSettings(
            entry.settings,
            Number(entry.settingsSchemaVersion) || 0,
          )
        : null;
    if (!settings) {
      return null;
    }
    const cleanSettings = {};
    SETTINGS_CONTROL_NAMES.forEach((key) => {
      if (Object.hasOwn(settings, key)) {
        cleanSettings[key] = settings[key];
      }
    });
    if (Object.keys(cleanSettings).length === 0) {
      return null;
    }
    const id = String(entry.id || "").trim();
    const name = String(entry.name || "").trim();
    if (!id || !name) {
      return null;
    }
    return {
      id,
      name,
      settingsSchemaVersion:
        Number(entry.settingsSchemaVersion) || SETTINGS_SCHEMA_VERSION,
      createdAt: String(entry.createdAt || ""),
      updatedAt: String(entry.updatedAt || entry.createdAt || ""),
      settings: cleanSettings,
    };
  }

  function loadSettingsVersions() {
    let stored = null;
    try {
      stored = JSON.parse(
        localStorage.getItem(SETTINGS_VERSIONS_STORAGE_KEY) || "null",
      );
    } catch {
      stored = null;
    }
    const entries = Array.isArray(stored?.entries)
      ? stored.entries.map(normalizeSettingsVersionEntry).filter(Boolean)
      : [];
    settingsVersions.entries = entries.slice(-SETTINGS_VERSION_LIMIT);
    settingsVersions.selectedId = settingsVersions.entries.some(
      (entry) => entry.id === stored?.selectedId,
    )
      ? stored.selectedId
      : "";
    renderSettingsVersions();
  }

  function saveSettingsVersions() {
    try {
      localStorage.setItem(
        SETTINGS_VERSIONS_STORAGE_KEY,
        JSON.stringify({
          selectedId: settingsVersions.selectedId,
          entries: settingsVersions.entries,
        }),
      );
    } catch {
      /* localStorage недоступен — тихо игнорируем */
    }
  }

  function defaultSettingsVersionName(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return [
      "Версия",
      `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`,
      `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    ].join(" ");
  }

  function currentSettingsSnapshot() {
    return Object.fromEntries(
      SETTINGS_CONTROL_NAMES.filter((key) => Object.hasOwn(params, key)).map(
        (key) => [key, params[key]],
      ),
    );
  }

  function roomSettingControlElement(key) {
    return settingsPanel?.querySelector(`[name="${key}"]`) || null;
  }

  function readRoomSettingsControls() {
    return Object.fromEntries(
      sharedRoomSettingKeys.map((key) => {
        const input = roomSettingControlElement(key);
        return [
          key,
          input ? controlValueToSettingValue(input, key) : params[key],
        ];
      }),
    );
  }

  function syncSettingControl(input, key) {
    if (!input || !Object.hasOwn(params, key)) {
      return;
    }
    if (input.type === "checkbox") {
      input.checked = Boolean(params[key]);
    } else {
      input.value = settingValueToControlValue(key, params[key]);
    }
  }

  function syncRoomSettingControls() {
    sharedRoomSettingKeys.forEach((key) => {
      syncSettingControl(roomSettingControlElement(key), key);
    });
  }

  function setSettingsVersionMenuOpen(open) {
    if (!settingsVersionMenu || !settingsVersionToggle) {
      return;
    }
    settingsVersionMenu.hidden = !open;
    settingsVersionToggle.setAttribute("aria-expanded", String(open));
  }

  function createSettingsVersionMenuItem({ id, label, selected, draft = false }) {
    const item = document.createElement("div");
    item.className = `settings-version-option${selected ? " is-selected" : ""}${
      draft ? " is-draft" : ""
    }`;

    const choice = document.createElement("button");
    choice.className = "settings-version-choice";
    choice.type = "button";
    choice.dataset.settingsVersionChoice = id;
    choice.setAttribute("role", "menuitemradio");
    choice.setAttribute("aria-checked", String(selected));
    choice.textContent = label;
    item.append(choice);

    if (!draft) {
      const deleteButton = document.createElement("button");
      deleteButton.className = "settings-version-delete";
      deleteButton.type = "button";
      deleteButton.dataset.settingsVersionDelete = id;
      deleteButton.setAttribute("aria-label", `Удалить версию ${label}`);
      deleteButton.title = "Удалить версию";
      deleteButton.innerHTML =
        '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /><path d="M10 11v5" /><path d="M14 11v5" /></svg>';
      item.append(deleteButton);
    }

    return item;
  }

  function selectedSettingsVersion() {
    return settingsVersions.entries.find(
      (entry) => entry.id === settingsVersions.selectedId,
    );
  }

  function renderSettingsVersions() {
    if (!settingsVersionMenu || !settingsVersionCurrent) {
      return;
    }
    const selectedEntry = selectedSettingsVersion();
    settingsVersionCurrent.textContent = selectedEntry
      ? formatSettingsVersionOptionLabel(selectedEntry)
      : "Черновик";
    settingsVersionMenu.replaceChildren(
      createSettingsVersionMenuItem({
        id: "",
        label: "Черновик",
        selected: !selectedEntry,
        draft: true,
      }),
      ...settingsVersions.entries.map((entry) =>
        createSettingsVersionMenuItem({
          id: entry.id,
          label: formatSettingsVersionOptionLabel(entry),
          selected: entry.id === selectedEntry?.id,
        }),
      ),
    );
    if (settingsVersionName && selectedEntry) {
      settingsVersionName.value = selectedEntry.name;
    }
  }

  function createSettingsVersionId() {
    const random =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    return `settings-version-${Date.now().toString(36)}-${random}`;
  }

  function saveCurrentSettingsVersion() {
    const now = new Date();
    const selected = selectedSettingsVersion();
    const name =
      String(settingsVersionName?.value || "").trim() ||
      selected?.name ||
      defaultSettingsVersionName(now);
    if (selected) {
      selected.name = name;
      selected.updatedAt = now.toISOString();
      selected.settingsSchemaVersion = SETTINGS_SCHEMA_VERSION;
      selected.settings = currentSettingsSnapshot();
    } else {
      const entry = {
        id: createSettingsVersionId(),
        name,
        settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        settings: currentSettingsSnapshot(),
      };
      settingsVersions.entries = [
        ...settingsVersions.entries,
        entry,
      ].slice(-SETTINGS_VERSION_LIMIT);
      settingsVersions.selectedId = entry.id;
    }
    if (settingsVersionName) {
      settingsVersionName.value = name;
    }
    renderSettingsVersions();
    saveSettingsVersions();
  }

  function applySettingsVersion(entry) {
    if (!entry) {
      return;
    }
    const changedKeys = [];
    settingsControlElements().forEach((element) => {
      const key = element.getAttribute("name");
      if (
        !key ||
        !SETTINGS_CONTROL_NAME_SET.has(key) ||
        !Object.hasOwn(entry.settings, key)
      ) {
        return;
      }
      const nextValue = entry.settings[key];
      if (element.type === "checkbox") {
        const checked = Boolean(nextValue);
        if (element.checked !== checked) {
          changedKeys.push(key);
        }
        element.checked = checked;
      } else {
        const value = settingValueToControlValue(key, nextValue);
        if (String(element.value) !== value) {
          changedKeys.push(key);
        }
        element.value = value;
      }
    });
    settingsVersions.selectedId = entry.id;
    if (settingsVersionName) {
      settingsVersionName.value = entry.name;
    }
    renderSettingsVersions();
    saveSettingsVersions();
    readControls({
      changedKeys,
      preserveSettingsVersionSelection: true,
    });
  }

  function selectSettingsVersion(id) {
    settingsVersions.selectedId = id;
    const entry = selectedSettingsVersion();
    if (!entry) {
      settingsVersions.selectedId = "";
      if (settingsVersionName) {
        settingsVersionName.value = "";
      }
      renderSettingsVersions();
      saveSettingsVersions();
      setSettingsVersionMenuOpen(false);
      return;
    }
    applySettingsVersion(entry);
    setSettingsVersionMenuOpen(false);
  }

  function deleteSettingsVersion(id) {
    const beforeCount = settingsVersions.entries.length;
    settingsVersions.entries = settingsVersions.entries.filter(
      (entry) => entry.id !== id,
    );
    if (settingsVersions.entries.length === beforeCount) {
      return;
    }
    if (settingsVersions.selectedId === id) {
      settingsVersions.selectedId = "";
      if (settingsVersionName) {
        settingsVersionName.value = "";
      }
    }
    renderSettingsVersions();
    saveSettingsVersions();
  }

  function markSettingsVersionDraft() {
    if (!settingsVersions.selectedId) {
      return;
    }
    settingsVersions.selectedId = "";
    renderSettingsVersions();
    saveSettingsVersions();
  }

  function updateControlOutputs() {
    const outputs = {
      mass: params.mass.toFixed(1),
      gravity: params.gravity.toFixed(2),
      handForce: params.handForce.toFixed(0),
      pointerInfluence: params.pointerInfluence.toFixed(1),
      bounce: params.bounce.toFixed(2),
      inertia: params.inertia.toFixed(2),
      horizontalInertia: params.horizontalInertia.toFixed(2),
      groundFriction: params.groundFriction.toFixed(2),
      turbulence: params.turbulence.toFixed(2),
      rockMinWidthVw: `${params.rockMinWidthVw.toFixed(0)}%`,
      rockMaxWidthVw: `${params.rockMaxWidthVw.toFixed(0)}%`,
      sceneHeightScreens: `${Math.round(params.sceneHeightScreens * 100)}vh`,
      returnScrollDurationSeconds: secondsOutput(
        params.returnScrollDurationSeconds,
      ),
      handWidthVw: `${params.handWidthVw.toFixed(1)}vw`,
      slaveHandWidthPx: `${params.slaveHandWidthPx.toFixed(0)}px`,
      rainStrength: `${Math.round(params.rainStrength * 100)}%`,
      rainMaxVolume: `${Math.round(params.rainMaxVolume * 100)}%`,
      rainBackgroundBlurSteps: params.rainBackgroundBlurSteps.toFixed(0),
      rainBlurPx: `${params.rainBlurPx.toFixed(0)} px`,
      rainBlurOpacity: `${Math.round(params.rainBlurOpacity * 100)}%`,
      rainBlurSaturation: `${Math.round(params.rainBlurSaturation * 100)}%`,
      rainZIndex: params.rainZIndex.toFixed(0),
      rainEnterMs: secondsOutput(params.rainEnterMs / 1000),
      rainExitMs: secondsOutput(params.rainExitMs / 1000),
      lineDelay: params.lineDelay.toFixed(2),
      trailMaxPoints: params.trailMaxPoints.toFixed(0),
      trailSampleDist: params.trailSampleDist.toFixed(0),
      lineWidth: params.lineWidth.toFixed(0),
      lineOpacity: params.lineOpacity.toFixed(2),
      linePassOpacity: params.linePassOpacity.toFixed(2),
      dashLength: params.dashLength.toFixed(0),
      dashGap: params.dashGap.toFixed(0),
      glow: params.glow.toFixed(0),
    };

    Object.entries(outputs).forEach(([key, value]) => {
      document.querySelectorAll(`[data-output="${key}"]`).forEach((element) => {
        element.textContent = value;
      });
    });
  }

  function readPhysicsControls() {
    const number = (name) =>
      Number(settingsPanel.querySelector(`[name="${name}"]`).value);
    return {
      mass: number("mass"),
      gravity: number("gravity"),
      handForce: number("handForce"),
      pointerInfluence: number("pointerInfluence"),
      bounce: number("bounce"),
      inertia: number("inertia"),
      horizontalInertia: number("horizontalInertia"),
      groundFriction: number("groundFriction"),
      turbulence: number("turbulence"),
    };
  }

  function showHint(target) {
    const text = target.getAttribute("data-hint");
    let formulas;
    try {
      const rawFormulas = target.getAttribute("data-formulas");
      formulas = rawFormulas ? JSON.parse(rawFormulas) : [];
    } catch {
      formulas = [];
    }
    formulas = Array.isArray(formulas)
      ? formulas.filter((formula) => typeof formula === "string" && formula.trim())
      : [];
    if (!hintEl || (!text && formulas.length === 0)) {
      return;
    }

    hintEl.replaceChildren();
    if (text) {
      const description = document.createElement("div");
      description.className = "hint__text";
      description.textContent = text;
      hintEl.append(description);
    }
    if (formulas.length > 0) {
      const formulaBlock = document.createElement("div");
      formulaBlock.className = "hint__formulas";
      const title = document.createElement("div");
      title.className = "hint__formulas-title";
      title.textContent = "Формулы";
      const list = document.createElement("ul");
      formulas.forEach((formula) => {
        const item = document.createElement("li");
        const math = document.createElement("span");
        math.className = "hint__formula-math";
        math.setAttribute("aria-label", formula);
        try {
          katex.render(formula, math, {
            displayMode: false,
            strict: "ignore",
            throwOnError: false,
          });
        } catch {
          math.textContent = formula;
        }
        item.append(math);
        list.append(item);
      });
      formulaBlock.append(title, list);
      hintEl.append(formulaBlock);
    }
    hintEl.classList.add("is-visible");

    const panelRect = settingsPanel.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const hintRect = hintEl.getBoundingClientRect();
    const top = clamp(targetRect.top, 8, window.innerHeight - hintRect.height - 8);
    const right = window.innerWidth - panelRect.left + 10;
    hintEl.style.left = "auto";
    hintEl.style.right = `${right}px`;
    hintEl.style.top = `${top}px`;
  }

  function hideHint() {
    hintEl?.classList.remove("is-visible");
  }

  function bind() {
    settingsControlElements().forEach((element) => {
      const handleControlChange = () => {
        if (collab.enabled && !localCanEditSettings()) {
          syncSettingControl(element, element.name);
          updateControlOutputs();
          return;
        }
        readControls({ changedKey: element.name });
      };
      listen(element, "input", handleControlChange);
      listen(element, "change", handleControlChange);
    });

    listen(settingsVersionSave, "click", () => {
      if (collab.enabled && !localCanEditSettings()) {
        return;
      }
      readControls({ changedKeys: [] });
      saveCurrentSettingsVersion();
    });
    listen(settingsVersionToggle, "click", () => {
      if (collab.enabled && !localCanEditSettings()) {
        return;
      }
      setSettingsVersionMenuOpen(settingsVersionMenu?.hidden !== false);
    });
    listen(settingsVersionMenu, "click", (event) => {
      if (collab.enabled && !localCanEditSettings()) {
        return;
      }
      const deleteButton = event.target.closest("[data-settings-version-delete]");
      if (deleteButton) {
        deleteSettingsVersion(deleteButton.dataset.settingsVersionDelete || "");
        return;
      }
      const choice = event.target.closest("[data-settings-version-choice]");
      if (choice) {
        selectSettingsVersion(choice.dataset.settingsVersionChoice || "");
      }
    });
    listen(document, "click", (event) => {
      const target = event.target;
      if (
        settingsVersionToggle?.contains(target) ||
        settingsVersionMenu?.contains(target)
      ) {
        return;
      }
      setSettingsVersionMenuOpen(false);
    });
    listen(window, "keydown", (event) => {
      if (event.key === "Escape") {
        setSettingsVersionMenuOpen(false);
      }
    });
    listen(settingsPanel?.querySelector(".trail-clear"), "click", resetTrail);
    listen(sessionRestartButton, "click", restartExperience);
    listen(settingsPanel, "pointerover", (event) => {
      const target = event.target.closest("[data-hint]");
      if (target) {
        showHint(target);
      }
    });
    listen(settingsPanel, "pointerout", (event) => {
      const target = event.target.closest("[data-hint]");
      const next =
        event.relatedTarget && event.relatedTarget.closest
          ? event.relatedTarget.closest("[data-hint]")
          : null;
      if (target && next !== target) {
        hideHint();
      }
    });
    listen(settingsPanel, "focusin", (event) => {
      const target = event.target.closest("[data-hint]");
      if (target) {
        showHint(target);
      }
    });
    listen(settingsPanel, "focusout", hideHint);
  }

  return {
    enabled: Boolean(settingsPanel),
    bind,
    getLatestSettingsVersionPreset: () =>
      settingsFromLatestVersionEntry(settingsVersions.entries),
    getSettingsVersions: () =>
      settingsVersions.entries.map((entry) => ({
        id: entry.id,
        name: entry.name,
        settings: { ...entry.settings },
      })),
    load() {
      loadSettings();
      loadSettingsVersions();
    },
    markSettingsVersionDraft,
    readPhysicsControls,
    readRoomSettingsControls,
    roomSettingControlElement,
    saveSettings,
    syncRoomSettingControls,
    syncSettingControl,
    updateControlOutputs,
  };
}
