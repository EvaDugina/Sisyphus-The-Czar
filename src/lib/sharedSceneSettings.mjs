import {
  SETTINGS_SCENE_OPTIONS,
  legacySettingsStorageKeysForScene,
  settingsControlSharedSceneIds,
  settingsStorageKeyForScene,
  sharedSettingNamesForScene,
} from "../config/settings.mjs";

export const SHARED_SCENE_SETTINGS_STORAGE_KEY =
  "sisyphus-czar-shared-scene-settings-v1";
export const SHARED_SCENE_SETTINGS_VERSION = 1;

function parsedObject(raw) {
  try {
    const value = JSON.parse(raw || "null");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function readSceneSettings(storage, sceneId) {
  const keys = [
    settingsStorageKeyForScene(sceneId),
    ...legacySettingsStorageKeysForScene(sceneId),
  ];
  for (const key of keys) {
    try {
      const value = parsedObject(storage?.getItem?.(key));
      if (value) {
        return value;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function sharedSettingNames() {
  return [
    ...new Set(
      SETTINGS_SCENE_OPTIONS.flatMap(({ id }) => sharedSettingNamesForScene(id)),
    ),
  ];
}

export function migrateSharedSceneSettings(storage) {
  const byScene = Object.fromEntries(
    SETTINGS_SCENE_OPTIONS.map(({ id }) => [id, readSceneSettings(storage, id)]),
  );
  const settings = {};
  sharedSettingNames().forEach((name) => {
    const sources = settingsControlSharedSceneIds(name);
    const source = sources.find(
      (sceneId) =>
        byScene[sceneId] && Object.hasOwn(byScene[sceneId], name),
    );
    if (source) {
      settings[name] = byScene[source][name];
    }
  });
  return {
    version: SHARED_SCENE_SETTINGS_VERSION,
    settings,
  };
}

export function loadSharedSceneSettings(storage) {
  let stored;
  try {
    stored = parsedObject(storage?.getItem?.(SHARED_SCENE_SETTINGS_STORAGE_KEY));
  } catch {
    stored = null;
  }
  if (
    stored?.version === SHARED_SCENE_SETTINGS_VERSION &&
    stored.settings &&
    typeof stored.settings === "object" &&
    !Array.isArray(stored.settings)
  ) {
    return { ...stored.settings };
  }

  const migrated = migrateSharedSceneSettings(storage);
  try {
    storage?.setItem?.(
      SHARED_SCENE_SETTINGS_STORAGE_KEY,
      JSON.stringify(migrated),
    );
  } catch {
    // Недоступный localStorage не должен блокировать загрузку сцены.
  }
  return { ...migrated.settings };
}

export function saveSharedSceneSettings(storage, values, names) {
  const current = loadSharedSceneSettings(storage);
  const source = values && typeof values === "object" ? values : {};
  const allowed = new Set(Array.isArray(names) ? names : []);
  allowed.forEach((name) => {
    if (Object.hasOwn(source, name)) {
      current[name] = source[name];
    }
  });
  try {
    storage?.setItem?.(
      SHARED_SCENE_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        version: SHARED_SCENE_SETTINGS_VERSION,
        settings: current,
      }),
    );
  } catch {
    // Недоступный localStorage не должен блокировать сохранение сцены.
  }
  return current;
}

export function sharedSceneSettingsForScene(settings, sceneId) {
  const allowed = new Set(sharedSettingNamesForScene(sceneId));
  const source = settings && typeof settings === "object" ? settings : {};
  return Object.fromEntries(
    Object.entries(source).filter(([name]) => allowed.has(name)),
  );
}
