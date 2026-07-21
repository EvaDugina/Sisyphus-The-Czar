(function attachRoomSettings(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SisyphusRoomSettings = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createRoomSettings() {
  "use strict";

  const DEFAULT_SCENE_HEIGHT_SCREENS = 10;
  const SCENE_MOTION_REFERENCE_SCREENS = 100;
  const SCENE_MOTION_COMPENSATION_BOOST = 10;
  const ROOM_SETTINGS_VERSION = 4;
  const ROOM_SETTINGS_KEYS = Object.freeze([
    "sceneHeightScreens",
    "handWidthVw",
    "slaveHandWidthPx",
    "rainDropColor",
    "rainHighlightColor",
  ]);

  const ROOM_SETTINGS_LIMITS = Object.freeze({
    sceneHeightScreens: [5, 100],
    handWidthVw: [10, 90],
    slaveHandWidthPx: [8, 96],
  });

  const DEFAULT_ROOM_SETTINGS = Object.freeze({
    sceneHeightScreens: DEFAULT_SCENE_HEIGHT_SCREENS,
    handWidthVw: 14.375,
    slaveHandWidthPx: 16,
    rainDropColor: "#8c8c8c",
    rainHighlightColor: "#ffffff",
  });

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizeHexColor(value, fallback) {
    const raw = String(value || "").trim();
    const short = raw.match(/^#([0-9a-fA-F]{3})$/);
    if (short) {
      return `#${short[1]
        .split("")
        .map((part) => `${part}${part}`)
        .join("")
        .toLowerCase()}`;
    }
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
      return raw.toLowerCase();
    }
    return normalizeHexColor(fallback, DEFAULT_ROOM_SETTINGS.rainDropColor);
  }

  function sanitizeRoomSettings(input, fallback = DEFAULT_ROOM_SETTINGS) {
    const source = input && typeof input === "object" ? input : {};
    const fallbackSource =
      fallback && typeof fallback === "object" ? fallback : DEFAULT_ROOM_SETTINGS;
    const [sceneMin, sceneMax] = ROOM_SETTINGS_LIMITS.sceneHeightScreens;
    const [handMin, handMax] = ROOM_SETTINGS_LIMITS.handWidthVw;
    const [slaveHandMin, slaveHandMax] = ROOM_SETTINGS_LIMITS.slaveHandWidthPx;
    const fallbackSceneHeightScreens = finiteNumber(
      fallbackSource.sceneHeightScreens,
      DEFAULT_ROOM_SETTINGS.sceneHeightScreens
    );
    const fallbackHandWidthVw = finiteNumber(
      fallbackSource.handWidthVw,
      DEFAULT_ROOM_SETTINGS.handWidthVw
    );
    const fallbackSlaveHandWidthPx = finiteNumber(
      fallbackSource.slaveHandWidthPx,
      DEFAULT_ROOM_SETTINGS.slaveHandWidthPx
    );

    return {
      sceneHeightScreens: clamp(
        finiteNumber(source.sceneHeightScreens, fallbackSceneHeightScreens),
        sceneMin,
        sceneMax
      ),
      handWidthVw: clamp(
        finiteNumber(source.handWidthVw, fallbackHandWidthVw),
        handMin,
        handMax
      ),
      slaveHandWidthPx: clamp(
        finiteNumber(source.slaveHandWidthPx, fallbackSlaveHandWidthPx),
        slaveHandMin,
        slaveHandMax
      ),
      rainDropColor: normalizeHexColor(
        source.rainDropColor,
        fallbackSource.rainDropColor
      ),
      rainHighlightColor: normalizeHexColor(
        source.rainHighlightColor,
        fallbackSource.rainHighlightColor
      ),
    };
  }

  function migrateRoomSettings(input, version = 1) {
    const source = input && typeof input === "object" ? { ...input } : {};
    if (finiteNumber(version, 1) < ROOM_SETTINGS_VERSION) {
      if (Number.isFinite(Number(source.handWidthVw))) {
        source.handWidthVw = Number(source.handWidthVw) / 2;
      }
      if (Number.isFinite(Number(source.slaveHandWidthPx))) {
        source.slaveHandWidthPx = Number(source.slaveHandWidthPx) / 2;
      }
    }
    return source;
  }

  function sceneMotionMultiplier(settings) {
    const clean = sanitizeRoomSettings(settings);
    return (
      (SCENE_MOTION_REFERENCE_SCREENS / clean.sceneHeightScreens) *
      SCENE_MOTION_COMPENSATION_BOOST
    );
  }

  return Object.freeze({
    DEFAULT_SCENE_HEIGHT_SCREENS,
    SCENE_MOTION_REFERENCE_SCREENS,
    SCENE_MOTION_COMPENSATION_BOOST,
    ROOM_SETTINGS_VERSION,
    ROOM_SETTINGS_KEYS,
    ROOM_SETTINGS_LIMITS,
    DEFAULT_ROOM_SETTINGS,
    normalizeHexColor,
    migrateRoomSettings,
    sanitizeRoomSettings,
    sceneMotionMultiplier,
  });
});
