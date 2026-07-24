import "../../shared/physics.js";
import "../../shared/room-settings.js";

const SharedPhysics = globalThis.SisyphusPhysics;
const SharedRoomSettings = globalThis.SisyphusRoomSettings;

export const settingsSchemaVersion = 18;

export const settings = Object.freeze({
  ...SharedRoomSettings.DEFAULT_ROOM_SETTINGS,
  ...SharedPhysics.DEFAULT_PHYSICS,
});
