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
  const ROOM_SETTINGS_VERSION = 3;
  const ROOM_SETTINGS_KEYS = Object.freeze([
    "sceneHeightScreens",
    "handWidthVw",
    "slaveHandWidthPx",
    "rainDropColor",
    "rainHighlightColor",
  ]);

  const ROOM_SETTINGS_LIMITS = Object.freeze({
    sceneHeightScreens: [5, 100],
    handWidthVw: [20, 90],
    slaveHandWidthPx: [16, 96],
  });

  const DEFAULT_ROOM_SETTINGS = Object.freeze({
    sceneHeightScreens: DEFAULT_SCENE_HEIGHT_SCREENS,
    handWidthVw: 28.75,
    slaveHandWidthPx: 32,
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

  function sceneMotionMultiplier(settings) {
    const clean = sanitizeRoomSettings(settings);
    return SCENE_MOTION_REFERENCE_SCREENS / clean.sceneHeightScreens;
  }

  return Object.freeze({
    DEFAULT_SCENE_HEIGHT_SCREENS,
    SCENE_MOTION_REFERENCE_SCREENS,
    ROOM_SETTINGS_VERSION,
    ROOM_SETTINGS_KEYS,
    ROOM_SETTINGS_LIMITS,
    DEFAULT_ROOM_SETTINGS,
    normalizeHexColor,
    sanitizeRoomSettings,
    sceneMotionMultiplier,
  });
});
