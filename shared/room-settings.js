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

  const ROOM_SETTINGS_VERSION = 2;
  const ROOM_SETTINGS_KEYS = Object.freeze([
    "handWidthVw",
    "slaveHandWidthPx",
    "rainDropColor",
    "rainHighlightColor",
  ]);

  const ROOM_SETTINGS_LIMITS = Object.freeze({
    handWidthVw: [20, 90],
    slaveHandWidthPx: [16, 96],
  });

  const DEFAULT_ROOM_SETTINGS = Object.freeze({
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
    const [handMin, handMax] = ROOM_SETTINGS_LIMITS.handWidthVw;
    const [slaveHandMin, slaveHandMax] = ROOM_SETTINGS_LIMITS.slaveHandWidthPx;
    const fallbackHandWidthVw = finiteNumber(
      fallbackSource.handWidthVw,
      DEFAULT_ROOM_SETTINGS.handWidthVw
    );
    const fallbackSlaveHandWidthPx = finiteNumber(
      fallbackSource.slaveHandWidthPx,
      DEFAULT_ROOM_SETTINGS.slaveHandWidthPx
    );

    return {
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

  return Object.freeze({
    ROOM_SETTINGS_VERSION,
    ROOM_SETTINGS_KEYS,
    ROOM_SETTINGS_LIMITS,
    DEFAULT_ROOM_SETTINGS,
    normalizeHexColor,
    sanitizeRoomSettings,
  });
});
