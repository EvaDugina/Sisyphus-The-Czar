import "../../shared/physics.js";
import "../../shared/room-settings.js";
import "../../shared/production-preset.js";

const SharedProductionPreset = globalThis.SisyphusProductionPreset;

export const presetName = SharedProductionPreset.PRESET_NAME;
export const settingsSchemaVersion =
  SharedProductionPreset.SETTINGS_SCHEMA_VERSION;
export const settings = SharedProductionPreset.settings;
