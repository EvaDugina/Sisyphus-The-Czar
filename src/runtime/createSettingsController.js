import katex from "katex";
import "katex/dist/katex.min.css";

import { formatSettingsVersionOptionLabel } from "../lib/settingsVersions.mjs";
import {
  selectLatestSettingsVersionEntry,
  settingsFromLatestVersionEntry,
} from "../lib/settingsVersionSelection.mjs";
import {
  parseSettingDependencyAttribute,
  settingDependencyMatches,
} from "../lib/settingsDependencies.mjs";
import {
  LEGACY_SETTINGS_STORAGE_KEYS,
  SETTINGS_GROUPS,
  SETTINGS_STORAGE_KEY,
  SETTINGS_VERSIONS_STORAGE_KEY,
  settingsGroupControls,
} from "../config/settings.mjs";

const SETTINGS_CONTROLS = SETTINGS_GROUPS.flatMap(settingsGroupControls);
const LOCAL_SETTING_CONTROL_NAMES = SETTINGS_CONTROLS.filter(
  (control) => control.scope === "local",
).map((control) => control.name);
const VERSIONED_SETTING_CONTROL_NAMES = SETTINGS_CONTROLS.filter(
  (control) => control.scope !== "local",
).map((control) => control.name);
const VERSIONED_SETTING_CONTROL_NAME_SET = new Set(
  VERSIONED_SETTING_CONTROL_NAMES,
);
const SETTINGS_SCHEMA_VERSION = 27;
const INERTIA_SETTINGS_SCHEMA_VERSION = 18;
const SETTINGS_VERSION_LIMIT = 50;
const SETTINGS_TEMPLATES_IMPORT_KEY = "sisyphus-settings-templates-imported-v1";

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
    onDeleteSettingsTemplate,
    onImportSettingsTemplates,
    onListSettingsTemplates,
    onSaveSettingsTemplate,
    onSelectProductionPreset,
    params,
    readControls,
    resetTrail,
    restartExperience,
    secondsOutput,
    settingValueToControlValue,
    stageControlChange = () => {},
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
  const productionPresetStatus =
    options.productionPresetStatus ||
    document.querySelector(".settings-production-status");
  const sessionRestartButton =
    options.sessionRestartButton || document.querySelector(".session-restart");
  const sharedRoomSettingKeys = SharedRoomSettings.ROOM_SETTINGS_KEYS;
  const settingsVersions = {
    entries: [],
    selectedId: "",
    baselineId: "",
    baselineName: "",
    baselineSettings: null,
    draftDetached: false,
    dirtyKeys: new Set(),
    productionSelection: null,
    canSelectProductionPreset: false,
    sharedCatalogReady: false,
    catalogRevision: 0,
    catalogPages: [],
    pendingImportBatches: 0,
  };
  let loadedLocalSettings = false;
  let previewAnimationFrame = null;
  let commitTimerId = null;
  const pendingPreviewKeys = new Set();
  const pendingCommitKeys = new Set();
  const CONTROL_COMMIT_DELAY_MS = 180;

  function copySettingsVersionEntry(entry) {
    if (!entry) {
      return null;
    }
    return {
      id: entry.id,
      name: entry.name,
      settingsSchemaVersion: entry.settingsSchemaVersion,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      settings: { ...entry.settings },
    };
  }

  function settingValuesEqual(left, right) {
    if (Array.isArray(left) || Array.isArray(right)) {
      return JSON.stringify(left || []) === JSON.stringify(right || []);
    }
    if (typeof left === "number" || typeof right === "number") {
      const leftNumber = Number(left);
      const rightNumber = Number(right);
      return (
        Number.isFinite(leftNumber) &&
        Number.isFinite(rightNumber) &&
        Math.abs(leftNumber - rightNumber) < 1e-9
      );
    }
    return Object.is(left, right);
  }

  function baselineSettingsVersion() {
    return settingsVersions.entries.find(
      (entry) => entry.id === settingsVersions.baselineId,
    );
  }

  function productionSelectionMatches(entry) {
    const source = settingsVersions.productionSelection?.source;
    return Boolean(
      entry &&
        source &&
        source.id === entry.id &&
        source.updatedAt === entry.updatedAt,
    );
  }

  function hasUnsavedDraft() {
    const name = String(settingsVersionName?.value || "").trim();
    return Boolean(
      settingsVersions.draftDetached ||
        settingsVersions.dirtyKeys.size > 0 ||
        (settingsVersions.baselineId &&
          name !== settingsVersions.baselineName),
    );
  }

  function setProductionPresetStatus(message, state = "") {
    if (!productionPresetStatus) {
      return;
    }
    productionPresetStatus.textContent = message;
    productionPresetStatus.dataset.state = state;
  }

  function productionPresetPayload(entry) {
    return {
      id: entry.id,
      name: entry.name,
      settingsSchemaVersion: entry.settingsSchemaVersion,
      updatedAt: entry.updatedAt,
      settings: { ...entry.settings },
    };
  }

  function requestProductionPresetSelection(entry) {
    if (
      !entry ||
      !settingsVersions.canSelectProductionPreset ||
      typeof onSelectProductionPreset !== "function"
    ) {
      setProductionPresetStatus(
        "Production preset доступен в личной сессии при DEBUG=true",
        "error",
      );
      return false;
    }
    const sent = onSelectProductionPreset(productionPresetPayload(entry));
    if (sent === false) {
      setProductionPresetStatus(
        "Нет соединения для сохранения production preset",
        "error",
      );
      return false;
    }
    setProductionPresetStatus("Сохраняем production preset…", "pending");
    return true;
  }

  function setProductionPresetState(payload = {}) {
    settingsVersions.canSelectProductionPreset = Boolean(payload.canSelect);
    settingsVersions.productionSelection =
      payload.selection && typeof payload.selection === "object"
        ? payload.selection
        : null;
    const source = settingsVersions.productionSelection?.source;
    if (source) {
      setProductionPresetStatus(
        `Production: ${source.name}`,
        "success",
      );
    } else if (settingsVersions.canSelectProductionPreset) {
      setProductionPresetStatus("Production preset ещё не выбран");
    } else {
      setProductionPresetStatus("");
    }
    renderSettingsVersions();
  }

  function setProductionPresetError(message) {
    setProductionPresetStatus(
      String(message || "Не удалось сохранить production preset"),
      "error",
    );
  }

  function settingsControlElements() {
    if (!settingsPanel) {
      return [];
    }
    return settingsPanel.querySelectorAll(
      "[data-setting-control] input[name], [data-setting-control] select[name]",
    );
  }

  function syncSettingDependencies() {
    if (!settingsPanel) {
      return;
    }
    settingsPanel
      .querySelectorAll("[data-setting-enabled-when]")
      .forEach((control) => {
        const condition = parseSettingDependencyAttribute(
          control.dataset.settingEnabledWhen,
        );
        const dependency = condition?.name
          ? settingsPanel.querySelector(`[name="${condition.name}"]`)
          : null;
        const enabled = Boolean(
          dependency &&
            !dependency.disabled &&
            settingDependencyMatches(condition, {
              checked: dependency.checked,
              type: dependency.type,
              value: dependency.value,
            }),
        );
        control.querySelectorAll("input, select, button").forEach((input) => {
          input.disabled = !enabled;
        });
        control.classList.toggle("is-disabled", !enabled);
        control.dataset.settingDisabled = String(!enabled);
        control.setAttribute("aria-disabled", String(!enabled));

        if (!Object.hasOwn(control.dataset, "settingBaseHint")) {
          control.dataset.settingBaseHint = control.dataset.hint || "";
        }
        const dependencyControl = dependency?.closest("[data-setting-control]");
        const dependencyLabel =
          dependencyControl
            ?.querySelector(".control-label span")
            ?.textContent?.trim() || condition?.name || "зависимый параметр";
        const allowedLabels = condition?.values
          ?.map((value) => {
            const option = [...(dependency?.options || [])].find(
              (candidate) => String(candidate.value) === value,
            );
            return option?.textContent?.trim() || value;
          })
          .filter(Boolean);
        const reason = allowedLabels?.length
          ? `Доступно, когда «${dependencyLabel}»: ${allowedLabels.join(", ")}.`
          : `Доступно, когда «${dependencyLabel}» включено.`;
        control.dataset.hint = enabled
          ? control.dataset.settingBaseHint
          : [control.dataset.settingBaseHint, reason].filter(Boolean).join(" ");
      });
  }

  function notifySettingControlSync(input) {
    if (
      input?.matches(
        "[data-cubic-bezier-control] input[name], [data-structured-setting-control] input[name]",
      )
    ) {
      input.dispatchEvent(new Event("settings-control-sync"));
    }
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
    if (settingsSchemaVersion >= INERTIA_SETTINGS_SCHEMA_VERSION) {
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

  function migrateStoredParallaxRadiusSettings(settings) {
    if (
      !settings ||
      typeof settings !== "object" ||
      Object.hasOwn(settings, "preclickParallaxActivationRadiusVw")
    ) {
      return settings;
    }
    const radiusPx = Number(settings.preclickParallaxActivationRadiusPx);
    if (!Number.isFinite(radiusPx)) {
      return settings;
    }
    const [minRadiusVw, maxRadiusVw] =
      SharedRoomSettings.ROOM_SETTINGS_LIMITS
        .preclickParallaxActivationRadiusVw;
    const migrated = {
      ...settings,
      preclickParallaxActivationRadiusVw: Math.min(
        maxRadiusVw,
        Math.max(
          minRadiusVw,
          radiusPx /
            SharedRoomSettings.PRECLICK_PARALLAX_RADIUS_PX_PER_VW,
        ),
      ),
    };
    delete migrated.preclickParallaxActivationRadiusPx;
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
      return false;
    }
    stored = migrateStoredParallaxRadiusSettings(stored);

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
      if (legacyKeyVersion < 20) {
        delete stored.trailEnabled;
      }
      if (migratedPreV10Settings && Number.isFinite(Number(stored.handWidthVw))) {
        stored.handWidthVw = Number(stored.handWidthVw) / 2;
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
        notifySettingControlSync(element);
      }
    });
    return true;
  }

  function normalizeSettingsVersionEntry(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const settings =
      entry.settings && typeof entry.settings === "object"
        ? migrateStoredParallaxRadiusSettings(
            migrateStoredInertiaSettings(
              entry.settings,
              Number(entry.settingsSchemaVersion) || 0,
            ),
          )
        : null;
    if (!settings) {
      return null;
    }
    const cleanSettings = {};
    VERSIONED_SETTING_CONTROL_NAMES.forEach((key) => {
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

  function settingsTemplatesImportMarker() {
    return `${SETTINGS_TEMPLATES_IMPORT_KEY}:${window.location.origin}`;
  }

  function settingsTemplatesImported() {
    try {
      return localStorage.getItem(settingsTemplatesImportMarker()) === "true";
    } catch {
      return false;
    }
  }

  function markSettingsTemplatesImported() {
    try {
      localStorage.setItem(settingsTemplatesImportMarker(), "true");
    } catch {
      /* localStorage недоступен — повторный импорт дедуплицируется сервером */
    }
  }

  function mergeCatalogEntries(entries) {
    if (!Array.isArray(entries)) {
      return [];
    }
    const merged = new Map(
      settingsVersions.entries.map((entry) => [entry.id, entry]),
    );
    const changed = [];
    entries.forEach((rawEntry) => {
      const entry = normalizeSettingsVersionEntry(rawEntry);
      if (!entry) {
        return;
      }
      merged.set(entry.id, entry);
      changed.push(entry);
    });
    settingsVersions.entries = [...merged.values()]
      .sort((left, right) => {
        const updated =
          Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || "");
        return updated || String(right.id).localeCompare(String(left.id));
      })
      .slice(0, SETTINGS_VERSION_LIMIT);
    renderSettingsVersions();
    saveSettingsVersions();
    return changed;
  }

  function applyLatestCatalogEntry() {
    const latest = selectLatestSettingsVersionEntry(settingsVersions.entries);
    if (!latest) {
      return;
    }
    settingsVersions.baselineId = latest.id;
    settingsVersions.baselineName = latest.name;
    settingsVersions.baselineSettings = { ...latest.settings };
    settingsVersions.draftDetached = false;
    if (settingsVersionName) {
      settingsVersionName.value = latest.name;
    }
    refreshDraftState();
  }

  function importLegacySettingsVersions(entries) {
    if (
      settingsTemplatesImported() ||
      !Array.isArray(entries) ||
      entries.length === 0 ||
      typeof onImportSettingsTemplates !== "function"
    ) {
      markSettingsTemplatesImported();
      return;
    }
    const batches = [];
    for (let index = 0; index < entries.length; index += 10) {
      batches.push(entries.slice(index, index + 10).map(copySettingsVersionEntry));
    }
    settingsVersions.pendingImportBatches = batches.length;
    let sentBatches = 0;
    batches.forEach((batch) => {
      if (onImportSettingsTemplates(batch) !== false) {
        sentBatches += 1;
      }
    });
    settingsVersions.pendingImportBatches = sentBatches;
    if (sentBatches === 0) {
      setProductionPresetStatus("Нет соединения для импорта шаблонов", "error");
    } else {
      setProductionPresetStatus("Импортируем локальные шаблоны…", "pending");
    }
  }

  function setSettingsTemplatesPage(payload = {}) {
    const offset = Math.max(0, Number(payload.offset) || 0);
    if (offset === 0) {
      settingsVersions.catalogPages = [];
    }
    const entries = Array.isArray(payload.entries)
      ? payload.entries.map(normalizeSettingsVersionEntry).filter(Boolean)
      : [];
    settingsVersions.catalogPages.push(...entries);
    settingsVersions.catalogRevision = Math.max(
      settingsVersions.catalogRevision,
      Number(payload.revision) || 0,
    );
    if (
      payload.nextOffset !== null &&
      payload.nextOffset !== undefined &&
      typeof onListSettingsTemplates === "function"
    ) {
      onListSettingsTemplates({ offset: payload.nextOffset, limit: 10 });
      return;
    }

    const legacyEntries = settingsVersions.sharedCatalogReady
      ? []
      : settingsVersions.entries.map(copySettingsVersionEntry);
    settingsVersions.entries = [];
    settingsVersions.sharedCatalogReady = true;
    mergeCatalogEntries(settingsVersions.catalogPages);
    applyLatestCatalogEntry();
    importLegacySettingsVersions(legacyEntries);
  }

  function setSettingsTemplatesImported(payload = {}) {
    mergeCatalogEntries(payload.entries);
    settingsVersions.catalogRevision = Math.max(
      settingsVersions.catalogRevision,
      Number(payload.revision) || 0,
    );
    settingsVersions.pendingImportBatches = Math.max(
      0,
      settingsVersions.pendingImportBatches - 1,
    );
    if (settingsVersions.pendingImportBatches === 0) {
      markSettingsTemplatesImported();
      setProductionPresetStatus("Локальные шаблоны импортированы", "success");
      applyLatestCatalogEntry();
    }
  }

  function setSettingsTemplateSaved(payload = {}) {
    const [entry] = mergeCatalogEntries(payload.entry ? [payload.entry] : []);
    if (!entry) {
      return;
    }
    settingsVersions.selectedId = entry.id;
    settingsVersions.baselineId = entry.id;
    settingsVersions.baselineName = entry.name;
    settingsVersions.baselineSettings = { ...entry.settings };
    settingsVersions.draftDetached = false;
    settingsVersions.dirtyKeys.clear();
    if (settingsVersionName) {
      settingsVersionName.value = entry.name;
    }
    renderSettingsVersions();
    renderDraftState();
    saveSettingsVersions();
    setProductionPresetStatus(
      payload.branched
        ? "Конфликт сохранён новой версией"
        : "Общий шаблон сохранён",
      "success",
    );
    if (
      !payload.branched &&
      settingsVersions.productionSelection?.source?.id === entry.id
    ) {
      requestProductionPresetSelection(entry);
    }
  }

  function setSettingsTemplateDeleted(payload = {}) {
    const id = String(payload.deletedId || "");
    if (!id) {
      return;
    }
    settingsVersions.entries = settingsVersions.entries.filter(
      (entry) => entry.id !== id,
    );
    if (settingsVersions.selectedId === id) {
      settingsVersions.selectedId = "";
    }
    if (settingsVersions.baselineId === id) {
      settingsVersions.baselineId = "";
      settingsVersions.baselineName = "";
      settingsVersions.baselineSettings = currentSettingsSnapshot();
      settingsVersions.draftDetached = true;
    }
    renderSettingsVersions();
    renderDraftState();
    saveSettingsVersions();
  }

  function applySettingsTemplateChange(payload = {}) {
    settingsVersions.catalogRevision = Math.max(
      settingsVersions.catalogRevision,
      Number(payload.revision) || 0,
    );
    if (payload.action === "delete") {
      setSettingsTemplateDeleted({ deletedId: payload.id });
      return;
    }
    mergeCatalogEntries(payload.entries);
  }

  function setSettingsConflict(payload = {}) {
    mergeCatalogEntries(payload.entry ? [payload.entry] : []);
    setProductionPresetStatus(
      payload.entry
        ? `Конфликт сохранён как «${payload.entry.name}»`
        : "Настройки изменены другим пользователем",
      payload.entry ? "success" : "error",
    );
  }

  function setSettingsTemplateError(message) {
    setProductionPresetStatus(
      String(message || "Не удалось обработать общий шаблон"),
      "error",
    );
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
      VERSIONED_SETTING_CONTROL_NAMES.filter((key) =>
        Object.hasOwn(params, key),
      ).map(
        (key) => [key, params[key]],
      ),
    );
  }

  function renderDraftState() {
    const dirty = hasUnsavedDraft();
    settingsPanel?.classList.toggle("has-draft", dirty);
    settingsVersionToggle?.classList.toggle("is-dirty", dirty);
    settingsVersionSave?.classList.toggle("is-dirty", dirty);
    settingsVersionName?.classList.toggle(
      "is-dirty",
      Boolean(
        settingsVersions.baselineId &&
          String(settingsVersionName.value || "").trim() !==
            settingsVersions.baselineName,
      ),
    );
    settingsControlElements().forEach((element) => {
      element
        .closest("[data-setting-control]")
        ?.classList.toggle(
          "is-dirty",
          settingsVersions.dirtyKeys.has(element.name),
        );
    });
  }

  function refreshDraftState() {
    const baseline = settingsVersions.baselineSettings;
    const snapshot = currentSettingsSnapshot();
    settingsVersions.dirtyKeys.clear();
    if (baseline) {
      VERSIONED_SETTING_CONTROL_NAMES.forEach((key) => {
        if (
          !Object.hasOwn(snapshot, key) ||
          !Object.hasOwn(baseline, key) ||
          !settingValuesEqual(snapshot[key], baseline[key])
        ) {
          settingsVersions.dirtyKeys.add(key);
        }
      });
    }
    const dirty = hasUnsavedDraft();
    settingsVersions.selectedId = dirty
      ? ""
      : settingsVersions.baselineId;
    renderSettingsVersions();
    renderDraftState();
  }

  function captureCurrentAsBaseline(entry = baselineSettingsVersion()) {
    if (!entry) {
      return;
    }
    settingsVersions.baselineId = entry.id;
    settingsVersions.baselineName = entry.name;
    settingsVersions.baselineSettings = currentSettingsSnapshot();
    settingsVersions.draftDetached = false;
    settingsVersions.selectedId = entry.id;
    settingsVersions.dirtyKeys.clear();
    renderSettingsVersions();
    renderDraftState();
    saveSettingsVersions();
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

  function readLocalSettingsControls() {
    return Object.fromEntries(
      LOCAL_SETTING_CONTROL_NAMES.map((key) => {
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
      notifySettingControlSync(input);
    }
  }

  function syncRoomSettingControls() {
    sharedRoomSettingKeys.forEach((key) => {
      syncSettingControl(roomSettingControlElement(key), key);
    });
    syncSettingDependencies();
  }

  function syncLocalSettingControls() {
    LOCAL_SETTING_CONTROL_NAMES.forEach((key) => {
      syncSettingControl(roomSettingControlElement(key), key);
    });
    syncSettingDependencies();
  }

  function setSettingsVersionMenuOpen(open) {
    if (!settingsVersionMenu || !settingsVersionToggle) {
      return;
    }
    settingsVersionMenu.hidden = !open;
    settingsVersionToggle.setAttribute("aria-expanded", String(open));
  }

  function createSettingsVersionMenuItem({
    id,
    label,
    selected,
    draft = false,
    production = false,
  }) {
    const item = document.createElement("div");
    item.className = `settings-version-option${selected ? " is-selected" : ""}${
      draft ? " is-draft" : ""
    }${production ? " is-production" : ""}`;

    const choice = document.createElement("button");
    choice.className = "settings-version-choice";
    choice.type = "button";
    choice.dataset.settingsVersionChoice = id;
    choice.setAttribute("role", "menuitemradio");
    choice.setAttribute("aria-checked", String(selected));
    choice.textContent = label;
    item.append(choice);

    if (!draft) {
      const productionButton = document.createElement("button");
      productionButton.className = "settings-version-production";
      productionButton.type = "button";
      productionButton.dataset.productionPresetSelect = id;
      productionButton.disabled =
        !settingsVersions.canSelectProductionPreset;
      productionButton.setAttribute(
        "aria-label",
        production
          ? `Шаблон ${label} выбран для production`
          : `Выбрать шаблон ${label} для production`,
      );
      productionButton.title = production
        ? "Выбран для следующего production запуска"
        : "Выбрать для следующего production запуска";
      productionButton.innerHTML =
        '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 21V4" /><path d="M5 5h11l-2 4 2 4H5" /></svg>';
      item.append(productionButton);

      const deleteButton = document.createElement("button");
      deleteButton.className = "settings-version-delete";
      deleteButton.type = "button";
      deleteButton.dataset.settingsVersionDelete = id;
      deleteButton.disabled =
        settingsVersions.productionSelection?.source?.id === id;
      deleteButton.setAttribute("aria-label", `Удалить версию ${label}`);
      deleteButton.title = deleteButton.disabled
        ? "Сначала выберите другой production preset"
        : "Удалить версию";
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
          production: productionSelectionMatches(entry),
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
    const selected = settingsVersions.draftDetached
      ? null
      : baselineSettingsVersion() || selectedSettingsVersion();
    const name =
      String(settingsVersionName?.value || "").trim() ||
      selected?.name ||
      defaultSettingsVersionName(now);
    if (
      settingsVersions.sharedCatalogReady &&
      typeof onSaveSettingsTemplate === "function"
    ) {
      const timestamp = now.toISOString();
      const candidate = {
        id: selected?.id || createSettingsVersionId(),
        name,
        settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
        createdAt: selected?.createdAt || timestamp,
        updatedAt: selected?.updatedAt || timestamp,
        settings: currentSettingsSnapshot(),
      };
      if (
        onSaveSettingsTemplate(candidate, selected?.updatedAt || "") !== false
      ) {
        setProductionPresetStatus("Сохраняем общий шаблон…", "pending");
        return;
      }
    }
    let savedEntry = selected;
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
      savedEntry = entry;
    }
    if (settingsVersionName) {
      settingsVersionName.value = name;
    }
    captureCurrentAsBaseline(savedEntry);
    saveSettingsVersions();
    if (
      settingsVersions.productionSelection?.source?.id === savedEntry.id
    ) {
      requestProductionPresetSelection(savedEntry);
    }
  }

  function writeSettingsVersionToControls(entry) {
    if (!entry) {
      return [];
    }
    const changedKeys = [];
    settingsControlElements().forEach((element) => {
      const key = element.getAttribute("name");
      if (
        !key ||
        !VERSIONED_SETTING_CONTROL_NAME_SET.has(key) ||
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
        notifySettingControlSync(element);
      }
    });
    settingsVersions.selectedId = entry.id;
    settingsVersions.baselineId = entry.id;
    settingsVersions.baselineName = entry.name;
    settingsVersions.baselineSettings = { ...entry.settings };
    settingsVersions.draftDetached = false;
    settingsVersions.dirtyKeys.clear();
    if (settingsVersionName) {
      settingsVersionName.value = entry.name;
    }
    syncSettingDependencies();
    return changedKeys;
  }

  function applySettingsVersion(entry) {
    if (!entry) {
      return;
    }
    const changedKeys = writeSettingsVersionToControls(entry);
    renderSettingsVersions();
    saveSettingsVersions();
    readControls({
      changedKeys,
      preserveSettingsVersionSelection: true,
    });
    captureCurrentAsBaseline(entry);
  }

  function selectSettingsVersion(id) {
    settingsVersions.selectedId = id;
    const entry = selectedSettingsVersion();
    if (!entry) {
      settingsVersions.selectedId = "";
      settingsVersions.baselineId = "";
      settingsVersions.baselineName = "";
      settingsVersions.baselineSettings = currentSettingsSnapshot();
      settingsVersions.draftDetached = true;
      settingsVersions.dirtyKeys.clear();
      if (settingsVersionName) {
        settingsVersionName.value = "";
      }
      renderSettingsVersions();
      renderDraftState();
      saveSettingsVersions();
      setSettingsVersionMenuOpen(false);
      return;
    }
    applySettingsVersion(entry);
    setSettingsVersionMenuOpen(false);
  }

  function deleteSettingsVersion(id) {
    if (settingsVersions.productionSelection?.source?.id === id) {
      setProductionPresetStatus(
        "Сначала выберите другой production preset",
        "error",
      );
      return;
    }
    if (
      settingsVersions.sharedCatalogReady &&
      typeof onDeleteSettingsTemplate === "function" &&
      onDeleteSettingsTemplate(id) !== false
    ) {
      setProductionPresetStatus("Удаляем общий шаблон…", "pending");
      return;
    }
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
    if (settingsVersions.baselineId === id) {
      settingsVersions.baselineId = "";
      settingsVersions.baselineName = "";
      settingsVersions.baselineSettings = null;
      settingsVersions.draftDetached = true;
    }
    renderSettingsVersions();
    renderDraftState();
    saveSettingsVersions();
  }

  function markSettingsVersionDraft() {
    refreshDraftState();
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
      rockActivatedWidthVw: `${params.rockActivatedWidthVw.toFixed(0)}%`,
      preclickParallaxMaxOffsetPx:
        `${params.preclickParallaxMaxOffsetPx.toFixed(0)}px`,
      preclickParallaxActivationRadiusVw:
        `${params.preclickParallaxActivationRadiusVw.toFixed(0)}vw`,
      preclickParallaxReturnDurationMs:
        `${params.preclickParallaxReturnDurationMs.toFixed(0)}мс`,
      rockMinWidthVw: `${params.rockMinWidthVw.toFixed(0)}%`,
      rockMaxWidthVw: `${params.rockMaxWidthVw.toFixed(0)}%`,
      sceneHeightScreens: `${Math.round(params.sceneHeightScreens * 100)}vh`,
      positionScrollZonePercent:
        `${params.positionScrollZonePercent.toFixed(1)}%`,
      positionScrollStartSpeedVh:
        params.positionScrollStartSpeedVh.toFixed(2),
      positionScrollEndSpeedVh:
        params.positionScrollEndSpeedVh.toFixed(2),
      draftFoldAngle: `${params.draftFoldAngle.toFixed(0)}°`,
      draftFoldZoneSize: `${params.draftFoldZoneSize.toFixed(0)} vh`,
      finalFallDelaySeconds: secondsOutput(params.finalFallDelaySeconds),
      rockJumpIntervalSeconds: secondsOutput(
        params.rockJumpIntervalSeconds,
      ),
      rockJumpAngleSpreadDegrees:
        `${params.rockJumpAngleSpreadDegrees.toFixed(0)}°`,
      rockJumpInertiaSpreadPercent:
        `${params.rockJumpInertiaSpreadPercent.toFixed(0)}%`,
      handWidthVw: `${params.handWidthVw.toFixed(1)}vw`,
      windowObstacleMinHeightVh:
        `${params.windowObstacleMinHeightVh.toFixed(0)}vh`,
      windowObstacleMaxHeightVh:
        `${params.windowObstacleMaxHeightVh.toFixed(0)}vh`,
      windowObstacleMinIntervalSeconds:
        secondsOutput(params.windowObstacleMinIntervalSeconds),
      windowObstacleMaxIntervalSeconds:
        secondsOutput(params.windowObstacleMaxIntervalSeconds),
      windowObstacleMinWidthPx:
        `${params.windowObstacleMinWidthPx.toFixed(0)}px`,
      windowObstacleMaxWidthPx:
        `${params.windowObstacleMaxWidthPx.toFixed(0)}px`,
      windowObstacleMinHeightPx:
        `${params.windowObstacleMinHeightPx.toFixed(0)}px`,
      windowObstacleMaxHeightPx:
        `${params.windowObstacleMaxHeightPx.toFixed(0)}px`,
      drizzleStartVolume: `${Math.round(params.drizzleStartVolume * 100)}%`,
      drizzleEndVolume: `${Math.round(params.drizzleEndVolume * 100)}%`,
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
      trailAnchorHeightPercent:
        `${params.trailAnchorHeightPercent.toFixed(0)}%`,
      trailMaxPoints: params.trailMaxPoints.toFixed(0),
      trailSampleDist: params.trailSampleDist.toFixed(0),
      lineWidth: params.lineWidth.toFixed(0),
      lineOpacity: params.lineOpacity.toFixed(2),
      linePassOpacity: params.linePassOpacity.toFixed(2),
      dashLength: params.dashLength.toFixed(0),
      dashGap: params.dashGap.toFixed(0),
      glow: params.glow.toFixed(0),
      glowBufferScalePercent: `${params.glowBufferScalePercent.toFixed(0)}%`,
      glowUpdateFps: params.glowUpdateFps.toFixed(0),
      glowMaxPoints: params.glowMaxPoints.toFixed(0),
      glowDecimation: params.glowDecimation.toFixed(0),
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

  function cancelScheduledControlUpdates() {
    if (previewAnimationFrame !== null) {
      window.cancelAnimationFrame(previewAnimationFrame);
      previewAnimationFrame = null;
    }
    if (commitTimerId !== null) {
      window.clearTimeout(commitTimerId);
      commitTimerId = null;
    }
  }

  function collectPendingControlKeys(extraKey = "") {
    const keys = new Set([...pendingPreviewKeys, ...pendingCommitKeys]);
    if (extraKey) {
      keys.add(extraKey);
    }
    pendingPreviewKeys.clear();
    pendingCommitKeys.clear();
    return [...keys];
  }

  function commitPendingControlChanges(extraKey = "") {
    cancelScheduledControlUpdates();
    const changedKeys = collectPendingControlKeys(extraKey);
    if (changedKeys.length > 0) {
      readControls({ changedKeys, commit: true });
    }
  }

  function scheduleControlPreview(key) {
    pendingPreviewKeys.add(key);
    pendingCommitKeys.add(key);
    if (previewAnimationFrame === null) {
      previewAnimationFrame = window.requestAnimationFrame(() => {
        previewAnimationFrame = null;
        const changedKeys = [...pendingPreviewKeys];
        pendingPreviewKeys.clear();
        if (changedKeys.length > 0) {
          readControls({ changedKeys, commit: false });
        }
      });
    }
    if (commitTimerId !== null) {
      window.clearTimeout(commitTimerId);
    }
    commitTimerId = window.setTimeout(() => {
      commitTimerId = null;
      commitPendingControlChanges();
    }, CONTROL_COMMIT_DELAY_MS);
  }

  function bind() {
    settingsControlElements().forEach((element) => {
      let discreteInputHandled = false;
      let discreteInputResetTimerId = null;
      const restoreLockedControl = () => {
        syncSettingControl(element, element.name);
        updateControlOutputs();
      };
      const canApplyControl = () => {
        const localOnly =
          element.closest("[data-setting-control]")?.dataset.settingScope ===
          "local";
        if (collab.enabled && !localOnly && !localCanEditSettings()) {
          restoreLockedControl();
          return false;
        }
        return true;
      };
      const handleControlInput = () => {
        if (!canApplyControl()) {
          return;
        }
        stageControlChange(
          element.name,
          controlValueToSettingValue(element, element.name),
        );
        scheduleControlPreview(element.name);
      };
      const handleControlChange = () => {
        syncSettingDependencies();
        if (discreteInputHandled) {
          discreteInputHandled = false;
          if (discreteInputResetTimerId !== null) {
            window.clearTimeout(discreteInputResetTimerId);
            discreteInputResetTimerId = null;
          }
          return;
        }
        if (!canApplyControl()) {
          return;
        }
        stageControlChange(
          element.name,
          controlValueToSettingValue(element, element.name),
        );
        commitPendingControlChanges(element.name);
      };
      const continuous =
        element.matches('input[type="range"], input[type="color"]') ||
        Boolean(element.closest("[data-cubic-bezier-control]"));
      if (continuous) {
        listen(element, "input", handleControlInput);
      } else {
        listen(element, "input", () => {
          syncSettingDependencies();
          if (!canApplyControl()) {
            return;
          }
          stageControlChange(
            element.name,
            controlValueToSettingValue(element, element.name),
          );
          discreteInputHandled = true;
          if (discreteInputResetTimerId !== null) {
            window.clearTimeout(discreteInputResetTimerId);
          }
          discreteInputResetTimerId = window.setTimeout(() => {
            discreteInputHandled = false;
            discreteInputResetTimerId = null;
          }, 0);
          commitPendingControlChanges(element.name);
        });
      }
      listen(element, "change", handleControlChange);
    });

    listen(settingsVersionSave, "click", () => {
      if (collab.enabled && !localCanEditSettings()) {
        return;
      }
      readControls({ changedKeys: [] });
      saveCurrentSettingsVersion();
    });
    listen(settingsVersionName, "input", refreshDraftState);
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
      const productionButton = event.target.closest(
        "[data-production-preset-select]",
      );
      if (productionButton) {
        const entry = settingsVersions.entries.find(
          (candidate) =>
            candidate.id === productionButton.dataset.productionPresetSelect,
        );
        requestProductionPresetSelection(entry);
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
    listen(window, "beforeunload", (event) => {
      if (!hasUnsavedDraft()) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
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
    hasLocalSettings: () => loadedLocalSettings,
    getLoadedSettingsVersionEntry: () =>
      copySettingsVersionEntry(baselineSettingsVersion()),
    getSettingsVersions: () =>
      settingsVersions.entries.map(copySettingsVersionEntry),
    load() {
      loadedLocalSettings = loadSettings();
      loadSettingsVersions();
      const latest = selectLatestSettingsVersionEntry(settingsVersions.entries);
      if (latest) {
        loadedLocalSettings = true;
        writeSettingsVersionToControls(latest);
        renderSettingsVersions();
      }
      syncSettingDependencies();
      renderDraftState();
    },
    captureCurrentAsBaseline,
    dispose: cancelScheduledControlUpdates,
    markSettingsVersionDraft,
    readPhysicsControls,
    readLocalSettingsControls,
    readRoomSettingsControls,
    roomSettingControlElement,
    saveSettings,
    setProductionPresetError,
    setProductionPresetState,
    setSettingsConflict,
    setSettingsTemplateDeleted,
    setSettingsTemplateError,
    setSettingsTemplateSaved,
    setSettingsTemplatesImported,
    setSettingsTemplatesPage,
    applySettingsTemplateChange,
    syncRoomSettingControls,
    syncLocalSettingControls,
    syncSettingControl,
    updateControlOutputs,
  };
}
