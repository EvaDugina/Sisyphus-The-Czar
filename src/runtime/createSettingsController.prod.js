const EMPTY_SETTINGS = Object.freeze({});

export function createSettingsController() {
  return {
    enabled: false,
    bind() {},
    getLatestSettingsVersionPreset: () => null,
    getSettingsVersions: () => [],
    load() {},
    markSettingsVersionDraft() {},
    readPhysicsControls: () => EMPTY_SETTINGS,
    readRoomSettingsControls: () => EMPTY_SETTINGS,
    roomSettingControlElement: () => null,
    saveSettings() {},
    syncRoomSettingControls() {},
    syncSettingControl() {},
    updateControlOutputs() {},
  };
}
