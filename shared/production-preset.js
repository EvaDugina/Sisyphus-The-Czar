(function attachProductionPreset(root, factory) {
  const api = factory(
    typeof module === "object" && module.exports
      ? require("./physics")
      : root.SisyphusPhysics,
    typeof module === "object" && module.exports
      ? require("./room-settings")
      : root.SisyphusRoomSettings
  );
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SisyphusProductionPreset = api;
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function createProductionPreset(Physics, RoomSettings) {
    "use strict";

    const SETTINGS_SCHEMA_VERSION = 41;
    const PRESET_NAME = "prod";
    const settings = Object.freeze({
      ...RoomSettings.DEFAULT_ROOM_SETTINGS,
      ...Physics.DEFAULT_PHYSICS,
      sceneHeightScreens: 1,
    });

    return Object.freeze({
      PRESET_NAME,
      SETTINGS_SCHEMA_VERSION,
      settings,
    });
  }
);
