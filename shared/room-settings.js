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
  const ROOM_SETTINGS_VERSION = 11;

  const DEFAULT_ROCK_MIN_WIDTH_VW = 8;
  const DEFAULT_ROCK_MAX_WIDTH_VW = 35;
  const DEFAULT_ROCK_SCALE_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
  const DEFAULT_HAND_FORCE_DEFICIT_EASING =
    "cubic-bezier(0.42, 0, 1, 1)";
  const DEFAULT_RETURN_SCROLL_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
  const DEFAULT_POSITION_SCROLL_EASING =
    "cubic-bezier(0.17, 0.67, 0.83, 0.67)";
  const ROCK_WIDTH_VW_LIMITS = Object.freeze([1, 150]);

  const THEME_MODES = Object.freeze(["auto", "dark", "light"]);
  const MIX_BLEND_MODES = Object.freeze([
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "hard-light",
    "soft-light",
    "difference",
    "exclusion",
  ]);
  const TRAIL_DASH_STYLES = Object.freeze(["solid", "dashed", "dotted"]);
  const TRAIL_LINE_CAPS = Object.freeze(["round", "butt", "square"]);
  const TRAIL_LINE_JOINS = Object.freeze(["round", "miter", "bevel"]);
  const CUBIC_BEZIER_RE =
    /^cubic-bezier\(\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*\)$/i;

  const ROOM_SETTINGS_LIMITS = Object.freeze({
    sceneHeightScreens: [1, 100],
    returnScrollDurationSeconds: [0, 10],
    positionScrollZonePercent: [0, 20],
    positionScrollSpeedVh: [0, 2],
    handWidthVw: [10, 90],
    slaveHandWidthPx: [8, 96],
    rockWidthVw: ROCK_WIDTH_VW_LIMITS,
    rainStrength: [0.25, 1.5],
    rainMaxVolume: [0, 3],
    rainBackgroundBlurSteps: [0, 8],
    rainBlurPx: [0, 40],
    rainBlurOpacity: [0, 1],
    rainBlurSaturation: [0, 2],
    rainZIndex: [0, 30],
    rainTimingMs: [0, 20000],
    lineDelay: [0, 1],
    trailAnchorHeightPercent: [0, 100],
    trailMaxPoints: [20, 2000],
    trailSampleDist: [1, 40],
    lineWidth: [1, 60],
    lineOpacity: [0, 1],
    linePassOpacity: [0, 1],
    dashLength: [1, 40],
    dashGap: [0, 40],
    glow: [0, 40],
  });

  const DEFAULT_ROOM_SETTINGS = Object.freeze({
    themeMode: "auto",
    sceneHeightScreens: DEFAULT_SCENE_HEIGHT_SCREENS,
    returnScrollDurationSeconds: 4,
    returnScrollEasing: DEFAULT_RETURN_SCROLL_EASING,
    stationaryAutoSlipEnabled: true,
    positionScrollEnabled: true,
    positionScrollZonePercent: 20,
    positionScrollStartSpeedVh: 0.2,
    positionScrollEndSpeedVh: 1,
    positionScrollEasing: DEFAULT_POSITION_SCROLL_EASING,
    manualVerticalScrollEnabled: true,
    rockScaleEasing: DEFAULT_ROCK_SCALE_EASING,
    rockMinWidthVw: DEFAULT_ROCK_MIN_WIDTH_VW,
    rockMaxWidthVw: DEFAULT_ROCK_MAX_WIDTH_VW,
    handWidthVw: 14.375,
    slaveHandWidthPx: 16,
    handForceDeficitEasing: DEFAULT_HAND_FORCE_DEFICIT_EASING,
    rainEnabled: false,
    rainStrength: 1,
    rainMaxVolume: 0.5,
    rainDropColor: "#8c8c8c",
    rainHighlightColor: "#ffffff",
    rainBlendMode: "multiply",
    rainBlurBlendMode: "normal",
    rainBackgroundBlurSteps: 3,
    rainBlurPx: 14,
    rainBlurOpacity: 0.2,
    rainBlurSaturation: 1.1,
    rainZIndex: 5,
    rainEnterEasing: "cubic-bezier(0.2, 0, 0, 1)",
    rainExitEasing: "cubic-bezier(0.4, 0, 0.2, 1)",
    rainEnterMs: 1100,
    rainExitMs: 2000,
    trailEnabled: true,
    trailReset: false,
    lineDelay: 0.5,
    trailAnchorHeightPercent: 100,
    trailMaxPoints: 1000,
    trailUnlimited: false,
    trailSampleDist: 6,
    blendMode: "difference",
    lineColor: "#ffffff",
    lineColorTail: "#ffffff",
    useGradient: false,
    lineWidth: 2,
    lineOpacity: 0.9,
    linePassOpacity: 1,
    dashStyle: "solid",
    dashLength: 12,
    dashGap: 8,
    lineCap: "round",
    lineJoin: "round",
    glow: 0,
    glowColor: "#ffffff",
  });

  const ROOM_SETTINGS_KEYS = Object.freeze(Object.keys(DEFAULT_ROOM_SETTINGS));

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function finiteSetting(source, fallbackSource, key, min, max) {
    const fallback = clamp(
      finiteNumber(fallbackSource[key], DEFAULT_ROOM_SETTINGS[key]),
      min,
      max
    );
    return clamp(finiteNumber(source[key], fallback), min, max);
  }

  function integerSetting(source, fallbackSource, key, min, max) {
    return Math.round(finiteSetting(source, fallbackSource, key, min, max));
  }

  function boolSetting(source, fallbackSource, key) {
    if (typeof source[key] === "boolean") {
      return source[key];
    }
    if (source[key] === "true") {
      return true;
    }
    if (source[key] === "false") {
      return false;
    }
    return typeof fallbackSource[key] === "boolean"
      ? fallbackSource[key]
      : DEFAULT_ROOM_SETTINGS[key];
  }

  function enumSetting(source, fallbackSource, key, options) {
    const optionSet = new Set(options);
    const value = String(source[key] || "").trim();
    if (optionSet.has(value)) {
      return value;
    }
    const fallback = String(fallbackSource[key] || "").trim();
    return optionSet.has(fallback) ? fallback : DEFAULT_ROOM_SETTINGS[key];
  }

  function normalizeHexColor(value, fallback = DEFAULT_ROOM_SETTINGS.rainDropColor) {
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
    if (fallback !== value) {
      return normalizeHexColor(fallback, DEFAULT_ROOM_SETTINGS.rainDropColor);
    }
    return DEFAULT_ROOM_SETTINGS.rainDropColor;
  }

  function parseCubicBezier(value) {
    const match = String(value || "").trim().match(CUBIC_BEZIER_RE);
    if (!match) {
      return null;
    }
    const points = match.slice(1).map(Number);
    if (!points.every(Number.isFinite)) {
      return null;
    }
    const [x1, , x2] = points;
    if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
      return null;
    }
    return points;
  }

  function cubicBezierSetting(source, fallbackSource, key) {
    const value = String(source[key] || "").trim();
    if (parseCubicBezier(value)) {
      return value;
    }
    const fallback = String(fallbackSource[key] || "").trim();
    return parseCubicBezier(fallback) ? fallback : DEFAULT_ROOM_SETTINGS[key];
  }

  function timingFunctionSetting(source, fallbackSource, key) {
    const value = String(source[key] || "").trim();
    if (/^[a-zA-Z0-9\s,().-]{1,120}$/.test(value)) {
      return value;
    }
    const fallback = String(fallbackSource[key] || "").trim();
    return /^[a-zA-Z0-9\s,().-]{1,120}$/.test(fallback)
      ? fallback
      : DEFAULT_ROOM_SETTINGS[key];
  }

  function normalizeRockWidthRange(source, fallbackSource) {
    const [minLimit, maxLimit] = ROOM_SETTINGS_LIMITS.rockWidthVw;
    const start = finiteSetting(
      source,
      fallbackSource,
      "rockMinWidthVw",
      minLimit,
      maxLimit
    );
    const end = finiteSetting(
      source,
      fallbackSource,
      "rockMaxWidthVw",
      minLimit,
      maxLimit
    );
    return {
      rockMinWidthVw: start,
      rockMaxWidthVw: end,
    };
  }

  function sanitizeRoomSettings(input, fallback = DEFAULT_ROOM_SETTINGS) {
    const source = input && typeof input === "object" ? input : {};
    const fallbackSource =
      fallback && typeof fallback === "object" ? fallback : DEFAULT_ROOM_SETTINGS;
    const [sceneMin, sceneMax] = ROOM_SETTINGS_LIMITS.sceneHeightScreens;
    const [returnScrollMin, returnScrollMax] =
      ROOM_SETTINGS_LIMITS.returnScrollDurationSeconds;
    const [positionScrollZoneMin, positionScrollZoneMax] =
      ROOM_SETTINGS_LIMITS.positionScrollZonePercent;
    const [positionScrollSpeedMin, positionScrollSpeedMax] =
      ROOM_SETTINGS_LIMITS.positionScrollSpeedVh;
    const [handMin, handMax] = ROOM_SETTINGS_LIMITS.handWidthVw;
    const [slaveHandMin, slaveHandMax] = ROOM_SETTINGS_LIMITS.slaveHandWidthPx;
    const [rainStrengthMin, rainStrengthMax] = ROOM_SETTINGS_LIMITS.rainStrength;
    const [rainVolumeMin, rainVolumeMax] =
      ROOM_SETTINGS_LIMITS.rainMaxVolume;
    const [rainStepsMin, rainStepsMax] =
      ROOM_SETTINGS_LIMITS.rainBackgroundBlurSteps;
    const [rainBlurMin, rainBlurMax] = ROOM_SETTINGS_LIMITS.rainBlurPx;
    const [opacityMin, opacityMax] = ROOM_SETTINGS_LIMITS.rainBlurOpacity;
    const [saturationMin, saturationMax] =
      ROOM_SETTINGS_LIMITS.rainBlurSaturation;
    const [zIndexMin, zIndexMax] = ROOM_SETTINGS_LIMITS.rainZIndex;
    const [timingMin, timingMax] = ROOM_SETTINGS_LIMITS.rainTimingMs;
    const [lineDelayMin, lineDelayMax] = ROOM_SETTINGS_LIMITS.lineDelay;
    const [trailAnchorMin, trailAnchorMax] =
      ROOM_SETTINGS_LIMITS.trailAnchorHeightPercent;
    const [trailPointsMin, trailPointsMax] = ROOM_SETTINGS_LIMITS.trailMaxPoints;
    const [sampleMin, sampleMax] = ROOM_SETTINGS_LIMITS.trailSampleDist;
    const [lineWidthMin, lineWidthMax] = ROOM_SETTINGS_LIMITS.lineWidth;
    const [lineOpacityMin, lineOpacityMax] = ROOM_SETTINGS_LIMITS.lineOpacity;
    const [linePassOpacityMin, linePassOpacityMax] =
      ROOM_SETTINGS_LIMITS.linePassOpacity;
    const [dashLengthMin, dashLengthMax] = ROOM_SETTINGS_LIMITS.dashLength;
    const [dashGapMin, dashGapMax] = ROOM_SETTINGS_LIMITS.dashGap;
    const [glowMin, glowMax] = ROOM_SETTINGS_LIMITS.glow;
    const rockWidths = normalizeRockWidthRange(source, fallbackSource);

    return {
      themeMode: enumSetting(source, fallbackSource, "themeMode", THEME_MODES),
      sceneHeightScreens: integerSetting(
        source,
        fallbackSource,
        "sceneHeightScreens",
        sceneMin,
        sceneMax
      ),
      returnScrollDurationSeconds: finiteSetting(
        source,
        fallbackSource,
        "returnScrollDurationSeconds",
        returnScrollMin,
        returnScrollMax
      ),
      returnScrollEasing: cubicBezierSetting(
        source,
        fallbackSource,
        "returnScrollEasing"
      ),
      stationaryAutoSlipEnabled: boolSetting(
        source,
        fallbackSource,
        "stationaryAutoSlipEnabled"
      ),
      positionScrollEnabled: boolSetting(
        source,
        fallbackSource,
        "positionScrollEnabled"
      ),
      positionScrollZonePercent: finiteSetting(
        source,
        fallbackSource,
        "positionScrollZonePercent",
        positionScrollZoneMin,
        positionScrollZoneMax
      ),
      positionScrollStartSpeedVh: finiteSetting(
        source,
        fallbackSource,
        "positionScrollStartSpeedVh",
        positionScrollSpeedMin,
        positionScrollSpeedMax
      ),
      positionScrollEndSpeedVh: finiteSetting(
        source,
        fallbackSource,
        "positionScrollEndSpeedVh",
        positionScrollSpeedMin,
        positionScrollSpeedMax
      ),
      positionScrollEasing: cubicBezierSetting(
        source,
        fallbackSource,
        "positionScrollEasing"
      ),
      manualVerticalScrollEnabled: boolSetting(
        source,
        fallbackSource,
        "manualVerticalScrollEnabled"
      ),
      rockScaleEasing: cubicBezierSetting(
        source,
        fallbackSource,
        "rockScaleEasing"
      ),
      ...rockWidths,
      handWidthVw: finiteSetting(
        source,
        fallbackSource,
        "handWidthVw",
        handMin,
        handMax
      ),
      slaveHandWidthPx: integerSetting(
        source,
        fallbackSource,
        "slaveHandWidthPx",
        slaveHandMin,
        slaveHandMax
      ),
      handForceDeficitEasing: cubicBezierSetting(
        source,
        fallbackSource,
        "handForceDeficitEasing"
      ),
      rainEnabled: boolSetting(source, fallbackSource, "rainEnabled"),
      rainStrength: finiteSetting(
        source,
        fallbackSource,
        "rainStrength",
        rainStrengthMin,
        rainStrengthMax
      ),
      rainMaxVolume: finiteSetting(
        source,
        fallbackSource,
        "rainMaxVolume",
        rainVolumeMin,
        rainVolumeMax
      ),
      rainDropColor: normalizeHexColor(
        source.rainDropColor,
        fallbackSource.rainDropColor
      ),
      rainHighlightColor: normalizeHexColor(
        source.rainHighlightColor,
        fallbackSource.rainHighlightColor || DEFAULT_ROOM_SETTINGS.rainHighlightColor
      ),
      rainBlendMode: enumSetting(
        source,
        fallbackSource,
        "rainBlendMode",
        MIX_BLEND_MODES
      ),
      rainBlurBlendMode: enumSetting(
        source,
        fallbackSource,
        "rainBlurBlendMode",
        MIX_BLEND_MODES
      ),
      rainBackgroundBlurSteps: integerSetting(
        source,
        fallbackSource,
        "rainBackgroundBlurSteps",
        rainStepsMin,
        rainStepsMax
      ),
      rainBlurPx: integerSetting(
        source,
        fallbackSource,
        "rainBlurPx",
        rainBlurMin,
        rainBlurMax
      ),
      rainBlurOpacity: finiteSetting(
        source,
        fallbackSource,
        "rainBlurOpacity",
        opacityMin,
        opacityMax
      ),
      rainBlurSaturation: finiteSetting(
        source,
        fallbackSource,
        "rainBlurSaturation",
        saturationMin,
        saturationMax
      ),
      rainZIndex: integerSetting(
        source,
        fallbackSource,
        "rainZIndex",
        zIndexMin,
        zIndexMax
      ),
      rainEnterEasing: timingFunctionSetting(
        source,
        fallbackSource,
        "rainEnterEasing"
      ),
      rainExitEasing: timingFunctionSetting(
        source,
        fallbackSource,
        "rainExitEasing"
      ),
      rainEnterMs: integerSetting(
        source,
        fallbackSource,
        "rainEnterMs",
        timingMin,
        timingMax
      ),
      rainExitMs: integerSetting(
        source,
        fallbackSource,
        "rainExitMs",
        timingMin,
        timingMax
      ),
      trailEnabled: boolSetting(source, fallbackSource, "trailEnabled"),
      trailReset: boolSetting(source, fallbackSource, "trailReset"),
      lineDelay: finiteSetting(
        source,
        fallbackSource,
        "lineDelay",
        lineDelayMin,
        lineDelayMax
      ),
      trailAnchorHeightPercent: finiteSetting(
        source,
        fallbackSource,
        "trailAnchorHeightPercent",
        trailAnchorMin,
        trailAnchorMax
      ),
      trailMaxPoints: integerSetting(
        source,
        fallbackSource,
        "trailMaxPoints",
        trailPointsMin,
        trailPointsMax
      ),
      trailUnlimited: boolSetting(source, fallbackSource, "trailUnlimited"),
      trailSampleDist: integerSetting(
        source,
        fallbackSource,
        "trailSampleDist",
        sampleMin,
        sampleMax
      ),
      blendMode: enumSetting(source, fallbackSource, "blendMode", MIX_BLEND_MODES),
      lineColor: normalizeHexColor(source.lineColor, fallbackSource.lineColor),
      lineColorTail: normalizeHexColor(
        source.lineColorTail,
        fallbackSource.lineColorTail
      ),
      useGradient: boolSetting(source, fallbackSource, "useGradient"),
      lineWidth: integerSetting(
        source,
        fallbackSource,
        "lineWidth",
        lineWidthMin,
        lineWidthMax
      ),
      lineOpacity: finiteSetting(
        source,
        fallbackSource,
        "lineOpacity",
        lineOpacityMin,
        lineOpacityMax
      ),
      linePassOpacity: finiteSetting(
        source,
        fallbackSource,
        "linePassOpacity",
        linePassOpacityMin,
        linePassOpacityMax
      ),
      dashStyle: enumSetting(
        source,
        fallbackSource,
        "dashStyle",
        TRAIL_DASH_STYLES
      ),
      dashLength: integerSetting(
        source,
        fallbackSource,
        "dashLength",
        dashLengthMin,
        dashLengthMax
      ),
      dashGap: integerSetting(
        source,
        fallbackSource,
        "dashGap",
        dashGapMin,
        dashGapMax
      ),
      lineCap: enumSetting(source, fallbackSource, "lineCap", TRAIL_LINE_CAPS),
      lineJoin: enumSetting(source, fallbackSource, "lineJoin", TRAIL_LINE_JOINS),
      glow: integerSetting(source, fallbackSource, "glow", glowMin, glowMax),
      glowColor: normalizeHexColor(source.glowColor, fallbackSource.glowColor),
    };
  }

  function migrateRoomSettings(input, version = 1) {
    const source = input && typeof input === "object" ? { ...input } : {};
    if (finiteNumber(version, 1) < 4) {
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
    parseCubicBezier,
    migrateRoomSettings,
    sanitizeRoomSettings,
    sceneMotionMultiplier,
  });
});
