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
  const ROOM_SETTINGS_VERSION = 27;
  const MAX_HEIGHT_GATES = 10;
  const PRECLICK_PARALLAX_RADIUS_PX_PER_VW = 20;
  const PRECLICK_PARALLAX_OFFSET_PX_PER_VW = 20;

  const DEFAULT_ROCK_MIN_WIDTH_VW = 8;
  const DEFAULT_ROCK_MAX_WIDTH_VW = 35;
  const DEFAULT_ROCK_ACTIVATED_WIDTH_VW = 10;
  const DEFAULT_ROCK_SCALE_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
  const DEFAULT_HAND_FORCE_DEFICIT_EASING =
    "cubic-bezier(0.42, 0, 1, 1)";
  const DEFAULT_RETURN_SCROLL_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
  const DEFAULT_PRECLICK_PARALLAX_RETURN_EASING =
    "cubic-bezier(0.22, 1, 0.36, 1)";
  const DEFAULT_PRECLICK_PARALLAX_TRANSITION_EASING =
    "cubic-bezier(0, 0, 1, 1)";
  const DEFAULT_DRAFT_FOLD_BLEND_CURVE =
    "cubic-bezier(0.333, 0, 0.667, 1)";
  const DEFAULT_DRIZZLE_VOLUME_EASING =
    "cubic-bezier(0.4, 0, 0.2, 1)";
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
    cameraFollowLerp: [0.01, 1],
    draftFoldAngle: [0, 180],
    draftFoldZoneSize: [0, 50],
    finalFallDelaySeconds: [0, 10],
    drizzleVolume: [0, 1],
    handWidthVw: [10, 90],
    heightGateCount: [0, MAX_HEIGHT_GATES],
    heightGatePercent: [1, 99],
    heightGateDurationSeconds: [1, 60],
    windowObstacleHeightVh: [0, 10000],
    windowObstacleIntervalSeconds: [0.1, 30],
    windowObstacleWidthPx: [100, 1920],
    windowObstacleHeightPx: [100, 1080],
    rockWidthVw: ROCK_WIDTH_VW_LIMITS,
    preclickParallaxMaxOffsetVw: [0, 150],
    preclickParallaxEndMaxOffsetVw: [0, 50],
    preclickParallaxActivationRadiusVw: [0, 200],
    preclickParallaxStartDelayMs: [0, 1000],
    preclickParallaxEndDelayMs: [0, 1000],
    preclickParallaxTransitionDurationSeconds: [1, 30],
    preclickParallaxReturnDurationMs: [0, 2000],
    rockGrabRadiusVh: [0, 10],
    rockJumpIntervalSeconds: [1, 10],
    rockJumpAngleSpreadDegrees: [0, 180],
    rockJumpInertiaSpreadPercent: [0, 100],
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
    lightBackgroundColor: "#f8f8f5",
    lightBackgroundDeepColor: "#e9e8e2",
    lightBackgroundLowColor: "#d9d8d1",
    darkBackgroundColor: "#101211",
    darkBackgroundDeepColor: "#191a16",
    darkBackgroundLowColor: "#070807",
    sceneHeightScreens: DEFAULT_SCENE_HEIGHT_SCREENS,
    returnScrollDurationSeconds: 4,
    returnScrollEasing: DEFAULT_RETURN_SCROLL_EASING,
    stationaryAutoSlipEnabled: true,
    cameraFollowLerp: 0.1,
    draftFoldAngle: 30,
    draftFoldZoneSize: 20,
    draftFoldBlendEnabled: true,
    draftFoldBlendCurve: DEFAULT_DRAFT_FOLD_BLEND_CURVE,
    finalFallEnabled: false,
    finalFallDelaySeconds: 2,
    randomDropEnabled: true,
    rockJumpEnabled: true,
    rockJumpIntervalSeconds: 5,
    rockJumpAngleSpreadDegrees: 90,
    rockJumpInertiaSpreadPercent: 25,
    rockScaleEasing: DEFAULT_ROCK_SCALE_EASING,
    rockActivatedWidthVw: DEFAULT_ROCK_ACTIVATED_WIDTH_VW,
    rockMinWidthVw: DEFAULT_ROCK_MIN_WIDTH_VW,
    rockMaxWidthVw: DEFAULT_ROCK_MAX_WIDTH_VW,
    preclickParallaxMaxOffsetVw: 0.6,
    preclickParallaxEndMaxOffsetVw: 0,
    preclickParallaxMaxOffsetEasing:
      DEFAULT_PRECLICK_PARALLAX_TRANSITION_EASING,
    preclickParallaxActivationRadiusVw: 50,
    preclickParallaxStartDelayMs: 0,
    preclickParallaxEndDelayMs: 1000,
    preclickParallaxDelayEasing:
      DEFAULT_PRECLICK_PARALLAX_TRANSITION_EASING,
    preclickParallaxTransitionDurationSeconds: 30,
    preclickParallaxInverted: false,
    preclickParallaxReturnDurationMs: 400,
    preclickParallaxReturnEasing: DEFAULT_PRECLICK_PARALLAX_RETURN_EASING,
    handAlwaysVisible: true,
    rockGrabRadiusVh: 0,
    handWidthVw: 14.375,
    heightGates: Object.freeze([]),
    handForceDeficitEasing: DEFAULT_HAND_FORCE_DEFICIT_EASING,
    windowObstacleEnabled: false,
    windowObstacleMinHeightVh: 1000,
    windowObstacleMaxHeightVh: 1500,
    windowObstacleMinIntervalSeconds: 0.5,
    windowObstacleMaxIntervalSeconds: 1.5,
    windowObstacleMinWidthPx: 240,
    windowObstacleMaxWidthPx: 640,
    windowObstacleMinHeightPx: 160,
    windowObstacleMaxHeightPx: 480,
    handAudioEnabled: true,
    drizzleEnabled: true,
    drizzleStartVolume: 0.1,
    drizzleEndVolume: 1,
    drizzleVolumeEasing: DEFAULT_DRIZZLE_VOLUME_EASING,
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

  function sanitizeHeightGates(input, fallback = []) {
    const source = Array.isArray(input)
      ? input
      : Array.isArray(fallback)
        ? fallback
        : [];
    const [heightMin, heightMax] = ROOM_SETTINGS_LIMITS.heightGatePercent;
    const [durationMin, durationMax] =
      ROOM_SETTINGS_LIMITS.heightGateDurationSeconds;
    const usedIds = new Set();
    const usedHeights = new Set();
    const gates = [];

    source.slice(0, MAX_HEIGHT_GATES).forEach((candidate, index) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        return;
      }
      const heightPercent = Math.round(
        clamp(finiteNumber(candidate.heightPercent, heightMin), heightMin, heightMax)
      );
      if (usedHeights.has(heightPercent)) {
        return;
      }
      const durationSeconds = Math.round(
        clamp(
          finiteNumber(candidate.durationSeconds, durationMin),
          durationMin,
          durationMax
        )
      );
      const rawId = String(candidate.id || "").trim();
      const safeId = /^[A-Za-z0-9_-]{1,64}$/.test(rawId)
        ? rawId
        : `height-gate-${index + 1}-${heightPercent}`;
      let id = safeId;
      let suffix = 2;
      while (usedIds.has(id)) {
        const suffixText = `-${suffix}`;
        id = `${safeId.slice(0, 64 - suffixText.length)}${suffixText}`;
        suffix += 1;
      }
      usedIds.add(id);
      usedHeights.add(heightPercent);
      gates.push({ id, heightPercent, durationSeconds });
    });

    return gates.sort((left, right) => left.heightPercent - right.heightPercent);
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

  function hexColorSetting(source, fallbackSource, key) {
    return normalizeHexColor(
      source[key],
      fallbackSource[key] || DEFAULT_ROOM_SETTINGS[key]
    );
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

  function normalizeNumericRange(
    source,
    fallbackSource,
    minKey,
    maxKey,
    limits,
    integer = false
  ) {
    const [limitMin, limitMax] = limits;
    const read = integer ? integerSetting : finiteSetting;
    const start = read(source, fallbackSource, minKey, limitMin, limitMax);
    const end = read(source, fallbackSource, maxKey, limitMin, limitMax);
    return {
      [minKey]: Math.min(start, end),
      [maxKey]: Math.max(start, end),
    };
  }

  function sanitizeRoomSettings(input, fallback = DEFAULT_ROOM_SETTINGS) {
    const source = input && typeof input === "object" ? input : {};
    const fallbackSource =
      fallback && typeof fallback === "object" ? fallback : DEFAULT_ROOM_SETTINGS;
    const [sceneMin, sceneMax] = ROOM_SETTINGS_LIMITS.sceneHeightScreens;
    const [returnScrollMin, returnScrollMax] =
      ROOM_SETTINGS_LIMITS.returnScrollDurationSeconds;
    const [cameraFollowLerpMin, cameraFollowLerpMax] =
      ROOM_SETTINGS_LIMITS.cameraFollowLerp;
    const [draftFoldAngleMin, draftFoldAngleMax] =
      ROOM_SETTINGS_LIMITS.draftFoldAngle;
    const [draftFoldZoneMin, draftFoldZoneMax] =
      ROOM_SETTINGS_LIMITS.draftFoldZoneSize;
    const [finalFallDelayMin, finalFallDelayMax] =
      ROOM_SETTINGS_LIMITS.finalFallDelaySeconds;
    const [rockJumpIntervalMin, rockJumpIntervalMax] =
      ROOM_SETTINGS_LIMITS.rockJumpIntervalSeconds;
    const [rockJumpAngleSpreadMin, rockJumpAngleSpreadMax] =
      ROOM_SETTINGS_LIMITS.rockJumpAngleSpreadDegrees;
    const [rockJumpSpreadMin, rockJumpSpreadMax] =
      ROOM_SETTINGS_LIMITS.rockJumpInertiaSpreadPercent;
    const [parallaxOffsetMin, parallaxOffsetMax] =
      ROOM_SETTINGS_LIMITS.preclickParallaxMaxOffsetVw;
    const [parallaxEndOffsetMin, parallaxEndOffsetMax] =
      ROOM_SETTINGS_LIMITS.preclickParallaxEndMaxOffsetVw;
    const [parallaxRadiusMin, parallaxRadiusMax] =
      ROOM_SETTINGS_LIMITS.preclickParallaxActivationRadiusVw;
    const [parallaxStartDelayMin, parallaxStartDelayMax] =
      ROOM_SETTINGS_LIMITS.preclickParallaxStartDelayMs;
    const [parallaxEndDelayMin, parallaxEndDelayMax] =
      ROOM_SETTINGS_LIMITS.preclickParallaxEndDelayMs;
    const [parallaxTransitionDurationMin, parallaxTransitionDurationMax] =
      ROOM_SETTINGS_LIMITS.preclickParallaxTransitionDurationSeconds;
    const [parallaxReturnDurationMin, parallaxReturnDurationMax] =
      ROOM_SETTINGS_LIMITS.preclickParallaxReturnDurationMs;
    const [drizzleVolumeMin, drizzleVolumeMax] =
      ROOM_SETTINGS_LIMITS.drizzleVolume;
    const [handMin, handMax] = ROOM_SETTINGS_LIMITS.handWidthVw;
    const [rockGrabRadiusMin, rockGrabRadiusMax] =
      ROOM_SETTINGS_LIMITS.rockGrabRadiusVh;
    const windowObstacleHeightRange = normalizeNumericRange(
      source,
      fallbackSource,
      "windowObstacleMinHeightVh",
      "windowObstacleMaxHeightVh",
      ROOM_SETTINGS_LIMITS.windowObstacleHeightVh,
      true
    );
    const windowObstacleIntervalRange = normalizeNumericRange(
      source,
      fallbackSource,
      "windowObstacleMinIntervalSeconds",
      "windowObstacleMaxIntervalSeconds",
      ROOM_SETTINGS_LIMITS.windowObstacleIntervalSeconds
    );
    const windowObstacleWidthRange = normalizeNumericRange(
      source,
      fallbackSource,
      "windowObstacleMinWidthPx",
      "windowObstacleMaxWidthPx",
      ROOM_SETTINGS_LIMITS.windowObstacleWidthPx,
      true
    );
    const windowObstacleHeightPxRange = normalizeNumericRange(
      source,
      fallbackSource,
      "windowObstacleMinHeightPx",
      "windowObstacleMaxHeightPx",
      ROOM_SETTINGS_LIMITS.windowObstacleHeightPx,
      true
    );
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
    const parallaxOffsetSource =
      !Object.hasOwn(source, "preclickParallaxMaxOffsetVw") &&
      Number.isFinite(Number(source.preclickParallaxMaxOffsetPx))
        ? {
            ...source,
            preclickParallaxMaxOffsetVw:
              Number(source.preclickParallaxMaxOffsetPx) /
              PRECLICK_PARALLAX_OFFSET_PX_PER_VW,
          }
        : source;
    const preclickParallaxMaxOffsetVw = finiteSetting(
      parallaxOffsetSource,
      fallbackSource,
      "preclickParallaxMaxOffsetVw",
      parallaxOffsetMin,
      parallaxOffsetMax
    );
    const preclickParallaxEndMaxOffsetVw = Math.min(
      preclickParallaxMaxOffsetVw,
      finiteSetting(
        source,
        fallbackSource,
        "preclickParallaxEndMaxOffsetVw",
        parallaxEndOffsetMin,
        parallaxEndOffsetMax
      )
    );
    const preclickParallaxStartDelayMs = finiteSetting(
      source,
      fallbackSource,
      "preclickParallaxStartDelayMs",
      parallaxStartDelayMin,
      parallaxStartDelayMax
    );
    const preclickParallaxEndDelayMs = Math.max(
      preclickParallaxStartDelayMs,
      finiteSetting(
        source,
        fallbackSource,
        "preclickParallaxEndDelayMs",
        parallaxEndDelayMin,
        parallaxEndDelayMax
      )
    );

    return {
      themeMode: enumSetting(source, fallbackSource, "themeMode", THEME_MODES),
      lightBackgroundColor: hexColorSetting(
        source,
        fallbackSource,
        "lightBackgroundColor"
      ),
      lightBackgroundDeepColor: hexColorSetting(
        source,
        fallbackSource,
        "lightBackgroundDeepColor"
      ),
      lightBackgroundLowColor: hexColorSetting(
        source,
        fallbackSource,
        "lightBackgroundLowColor"
      ),
      darkBackgroundColor: hexColorSetting(
        source,
        fallbackSource,
        "darkBackgroundColor"
      ),
      darkBackgroundDeepColor: hexColorSetting(
        source,
        fallbackSource,
        "darkBackgroundDeepColor"
      ),
      darkBackgroundLowColor: hexColorSetting(
        source,
        fallbackSource,
        "darkBackgroundLowColor"
      ),
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
      cameraFollowLerp: finiteSetting(
        source,
        fallbackSource,
        "cameraFollowLerp",
        cameraFollowLerpMin,
        cameraFollowLerpMax
      ),
      draftFoldAngle: integerSetting(
        source,
        fallbackSource,
        "draftFoldAngle",
        draftFoldAngleMin,
        draftFoldAngleMax
      ),
      draftFoldZoneSize: integerSetting(
        source,
        fallbackSource,
        "draftFoldZoneSize",
        draftFoldZoneMin,
        draftFoldZoneMax
      ),
      draftFoldBlendEnabled: boolSetting(
        source,
        fallbackSource,
        "draftFoldBlendEnabled"
      ),
      draftFoldBlendCurve: cubicBezierSetting(
        source,
        fallbackSource,
        "draftFoldBlendCurve"
      ),
      finalFallEnabled: boolSetting(
        source,
        fallbackSource,
        "finalFallEnabled"
      ),
      finalFallDelaySeconds: finiteSetting(
        source,
        fallbackSource,
        "finalFallDelaySeconds",
        finalFallDelayMin,
        finalFallDelayMax
      ),
      randomDropEnabled: boolSetting(
        source,
        fallbackSource,
        "randomDropEnabled"
      ),
      rockJumpEnabled: boolSetting(
        source,
        fallbackSource,
        "rockJumpEnabled"
      ),
      rockJumpIntervalSeconds: integerSetting(
        source,
        fallbackSource,
        "rockJumpIntervalSeconds",
        rockJumpIntervalMin,
        rockJumpIntervalMax
      ),
      rockJumpAngleSpreadDegrees: integerSetting(
        source,
        fallbackSource,
        "rockJumpAngleSpreadDegrees",
        rockJumpAngleSpreadMin,
        rockJumpAngleSpreadMax
      ),
      rockJumpInertiaSpreadPercent: integerSetting(
        source,
        fallbackSource,
        "rockJumpInertiaSpreadPercent",
        rockJumpSpreadMin,
        rockJumpSpreadMax
      ),
      rockScaleEasing: cubicBezierSetting(
        source,
        fallbackSource,
        "rockScaleEasing"
      ),
      rockActivatedWidthVw: finiteSetting(
        source,
        fallbackSource,
        "rockActivatedWidthVw",
        ROOM_SETTINGS_LIMITS.rockWidthVw[0],
        ROOM_SETTINGS_LIMITS.rockWidthVw[1]
      ),
      preclickParallaxMaxOffsetVw,
      preclickParallaxEndMaxOffsetVw,
      preclickParallaxMaxOffsetEasing: cubicBezierSetting(
        source,
        fallbackSource,
        "preclickParallaxMaxOffsetEasing"
      ),
      preclickParallaxActivationRadiusVw: finiteSetting(
        !Object.hasOwn(source, "preclickParallaxActivationRadiusVw") &&
          Number.isFinite(Number(source.preclickParallaxActivationRadiusPx))
          ? {
              ...source,
              preclickParallaxActivationRadiusVw:
                Number(source.preclickParallaxActivationRadiusPx) /
                PRECLICK_PARALLAX_RADIUS_PX_PER_VW,
            }
          : source,
        fallbackSource,
        "preclickParallaxActivationRadiusVw",
        parallaxRadiusMin,
        parallaxRadiusMax
      ),
      preclickParallaxStartDelayMs,
      preclickParallaxEndDelayMs,
      preclickParallaxDelayEasing: cubicBezierSetting(
        source,
        fallbackSource,
        "preclickParallaxDelayEasing"
      ),
      preclickParallaxTransitionDurationSeconds: finiteSetting(
        source,
        fallbackSource,
        "preclickParallaxTransitionDurationSeconds",
        parallaxTransitionDurationMin,
        parallaxTransitionDurationMax
      ),
      preclickParallaxInverted: boolSetting(
        source,
        fallbackSource,
        "preclickParallaxInverted"
      ),
      preclickParallaxReturnDurationMs: finiteSetting(
        source,
        fallbackSource,
        "preclickParallaxReturnDurationMs",
        parallaxReturnDurationMin,
        parallaxReturnDurationMax
      ),
      preclickParallaxReturnEasing: cubicBezierSetting(
        source,
        fallbackSource,
        "preclickParallaxReturnEasing"
      ),
      handAlwaysVisible: boolSetting(
        source,
        fallbackSource,
        "handAlwaysVisible"
      ),
      rockGrabRadiusVh: finiteSetting(
        source,
        fallbackSource,
        "rockGrabRadiusVh",
        rockGrabRadiusMin,
        rockGrabRadiusMax
      ),
      ...rockWidths,
      handWidthVw: finiteSetting(
        source,
        fallbackSource,
        "handWidthVw",
        handMin,
        handMax
      ),
      heightGates: sanitizeHeightGates(
        source.heightGates,
        fallbackSource.heightGates
      ),
      handForceDeficitEasing: cubicBezierSetting(
        source,
        fallbackSource,
        "handForceDeficitEasing"
      ),
      windowObstacleEnabled: boolSetting(
        source,
        fallbackSource,
        "windowObstacleEnabled"
      ),
      ...windowObstacleHeightRange,
      ...windowObstacleIntervalRange,
      ...windowObstacleWidthRange,
      ...windowObstacleHeightPxRange,
      handAudioEnabled: boolSetting(
        source,
        fallbackSource,
        "handAudioEnabled"
      ),
      drizzleEnabled: boolSetting(source, fallbackSource, "drizzleEnabled"),
      drizzleStartVolume: finiteSetting(
        source,
        fallbackSource,
        "drizzleStartVolume",
        drizzleVolumeMin,
        drizzleVolumeMax
      ),
      drizzleEndVolume: finiteSetting(
        source,
        fallbackSource,
        "drizzleEndVolume",
        drizzleVolumeMin,
        drizzleVolumeMax
      ),
      drizzleVolumeEasing: cubicBezierSetting(
        source,
        fallbackSource,
        "drizzleVolumeEasing"
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
    }
    if (finiteNumber(version, 1) < 14) {
      delete source.handRestSeconds;
      delete source.stationaryAutoSlipEnabled;
      if (!Array.isArray(source.heightGates)) {
        source.heightGates = [];
      }
    }
    if (finiteNumber(version, 1) < 17) {
      source.windowObstacleEnabled = false;
      [
        "windowObstacleMinHeightVh",
        "windowObstacleMaxHeightVh",
        "windowObstacleMinIntervalSeconds",
        "windowObstacleMaxIntervalSeconds",
        "windowObstacleMinWidthPx",
        "windowObstacleMaxWidthPx",
        "windowObstacleMinHeightPx",
        "windowObstacleMaxHeightPx",
      ].forEach((key) => {
        if (!Object.hasOwn(source, key)) {
          source[key] = DEFAULT_ROOM_SETTINGS[key];
        }
      });
    }
    if (finiteNumber(version, 1) < 18) {
      [
        "lightBackgroundColor",
        "lightBackgroundDeepColor",
        "lightBackgroundLowColor",
        "darkBackgroundColor",
        "darkBackgroundDeepColor",
        "darkBackgroundLowColor",
        "rockActivatedWidthVw",
      ].forEach((key) => {
        if (!Object.hasOwn(source, key)) {
          source[key] = DEFAULT_ROOM_SETTINGS[key];
        }
      });
    }
    if (finiteNumber(version, 1) < 19) {
      ["handAudioEnabled", "drizzleEnabled"].forEach((key) => {
        if (!Object.hasOwn(source, key)) {
          source[key] = DEFAULT_ROOM_SETTINGS[key];
        }
      });
    }
    if (finiteNumber(version, 1) < 20) {
      if (
        !Object.hasOwn(source, "preclickParallaxMaxOffsetVw") &&
        !Object.hasOwn(source, "preclickParallaxMaxOffsetPx")
      ) {
        source.preclickParallaxMaxOffsetPx =
          DEFAULT_ROOM_SETTINGS.preclickParallaxMaxOffsetVw *
          PRECLICK_PARALLAX_OFFSET_PX_PER_VW;
      }
      if (
        !Object.hasOwn(source, "preclickParallaxActivationRadiusVw") &&
        !Object.hasOwn(source, "preclickParallaxActivationRadiusPx")
      ) {
        source.preclickParallaxActivationRadiusVw =
          DEFAULT_ROOM_SETTINGS.preclickParallaxActivationRadiusVw;
      }
    }
    if (finiteNumber(version, 1) < 21) {
      [
        "preclickParallaxReturnDurationMs",
        "preclickParallaxReturnEasing",
      ].forEach((key) => {
        if (!Object.hasOwn(source, key)) {
          source[key] = DEFAULT_ROOM_SETTINGS[key];
        }
      });
    }
    if (finiteNumber(version, 1) < 22) {
      if (
        !Object.hasOwn(source, "preclickParallaxActivationRadiusVw") &&
        !Object.hasOwn(source, "preclickParallaxActivationRadiusPx")
      ) {
        source.preclickParallaxActivationRadiusPx = 1000;
      }
    }
    if (finiteNumber(version, 1) < 23) {
      if (!Object.hasOwn(source, "preclickParallaxActivationRadiusVw")) {
        const previousRadiusPx = Number(
          source.preclickParallaxActivationRadiusPx
        );
        source.preclickParallaxActivationRadiusVw = Number.isFinite(
          previousRadiusPx
        )
          ? previousRadiusPx / PRECLICK_PARALLAX_RADIUS_PX_PER_VW
          : DEFAULT_ROOM_SETTINGS.preclickParallaxActivationRadiusVw;
      }
      delete source.preclickParallaxActivationRadiusPx;
    }
    if (finiteNumber(version, 1) < 24) {
      if (!Object.hasOwn(source, "preclickParallaxInverted")) {
        source.preclickParallaxInverted =
          DEFAULT_ROOM_SETTINGS.preclickParallaxInverted;
      }
    }
    if (finiteNumber(version, 1) < 25) {
      if (!Object.hasOwn(source, "preclickParallaxMaxOffsetVw")) {
        const previousOffsetPx = Number(source.preclickParallaxMaxOffsetPx);
        source.preclickParallaxMaxOffsetVw = Number.isFinite(previousOffsetPx)
          ? previousOffsetPx / PRECLICK_PARALLAX_OFFSET_PX_PER_VW
          : DEFAULT_ROOM_SETTINGS.preclickParallaxMaxOffsetVw;
      }
      if (!Object.hasOwn(source, "handAlwaysVisible")) {
        source.handAlwaysVisible = DEFAULT_ROOM_SETTINGS.handAlwaysVisible;
      }
      if (!Object.hasOwn(source, "cameraFollowLerp")) {
        source.cameraFollowLerp = DEFAULT_ROOM_SETTINGS.cameraFollowLerp;
      }
      delete source.preclickParallaxMaxOffsetPx;
      delete source.positionScrollEnabled;
      delete source.positionScrollZonePercent;
      delete source.positionScrollStartSpeedVh;
      delete source.positionScrollEndSpeedVh;
      delete source.positionScrollEasing;
      delete source.manualVerticalScrollEnabled;
    }
    if (finiteNumber(version, 1) < 26) {
      if (!Object.hasOwn(source, "preclickParallaxStartDelayMs")) {
        source.preclickParallaxStartDelayMs =
          DEFAULT_ROOM_SETTINGS.preclickParallaxStartDelayMs;
      }
      if (!Object.hasOwn(source, "rockGrabRadiusVh")) {
        source.rockGrabRadiusVh = DEFAULT_ROOM_SETTINGS.rockGrabRadiusVh;
      }
    }
    if (finiteNumber(version, 1) < 27) {
      [
        "preclickParallaxEndMaxOffsetVw",
        "preclickParallaxMaxOffsetEasing",
        "preclickParallaxEndDelayMs",
        "preclickParallaxDelayEasing",
        "preclickParallaxTransitionDurationSeconds",
      ].forEach((key) => {
        if (!Object.hasOwn(source, key)) {
          source[key] = DEFAULT_ROOM_SETTINGS[key];
        }
      });
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
    MAX_HEIGHT_GATES,
    PRECLICK_PARALLAX_RADIUS_PX_PER_VW,
    PRECLICK_PARALLAX_OFFSET_PX_PER_VW,
    ROOM_SETTINGS_VERSION,
    ROOM_SETTINGS_KEYS,
    ROOM_SETTINGS_LIMITS,
    DEFAULT_ROOM_SETTINGS,
    normalizeHexColor,
    parseCubicBezier,
    sanitizeHeightGates,
    migrateRoomSettings,
    sanitizeRoomSettings,
    sceneMotionMultiplier,
  });
});
