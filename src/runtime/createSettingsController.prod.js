const EMPTY_SETTINGS = Object.freeze({});

export function createSettingsController() {
  return {
    enabled: false,
    bind() {},
    captureCurrentAsBaseline() {},
    getLatestSettingsVersionPreset: () => null,
    getLoadedSettingsVersionEntry: () => null,
    getSettingsVersions: () => [],
    hasLocalSettings: () => false,
    load: () => [],
    markSettingsVersionDraft() {},
    readPhysicsControls: () => EMPTY_SETTINGS,
    readRoomSettingsControls: () => EMPTY_SETTINGS,
    roomSettingControlElement: () => null,
    saveSettings() {},
    setProductionPresetError() {},
    setProductionPresetState() {},
    syncRoomSettingControls() {},
    syncSettingControl() {},
    updateControlOutputs() {},
  };
}
