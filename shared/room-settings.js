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
  const ROOM_SETTINGS_VERSION = 54;
  const MAX_HEIGHT_GATES = 10;
  const MAX_SCENE_TWO_GLASS_STRIPS = 12;
  const PRECLICK_PARALLAX_RADIUS_PX_PER_VW = 20;
  const LEGACY_PRECLICK_PARALLAX_SETTING_KEYS = Object.freeze([
    "preclickParallaxMaxOffsetVw",
    "preclickParallaxMaxOffsetPx",
    "preclickParallaxEndMaxOffsetVw",
    "preclickParallaxMaxOffsetEasing",
    "preclickParallaxActivationRadiusVw",
    "preclickParallaxActivationRadiusPx",
    "preclickParallaxStartDelayMs",
    "preclickParallaxEndDelayMs",
    "preclickParallaxDelayEasing",
    "preclickParallaxTransitionDurationSeconds",
    "preclickParallaxInverted",
    "preclickParallaxReturnDurationMs",
    "preclickParallaxReturnEasing",
  ]);

  const DEFAULT_ROCK_MIN_WIDTH_VW = 8;
  const DEFAULT_ROCK_MAX_WIDTH_VW = 35;
  const DEFAULT_ROCK_ACTIVATED_WIDTH_VW = 10;
  const DEFAULT_ROCK_SCALE_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
  const DEFAULT_PRECLICK_HOP_SPEED_EASING =
    "cubic-bezier(0.22, 1, 0.36, 1)";
  const DEFAULT_HAND_FORCE_DEFICIT_EASING =
    "cubic-bezier(0.42, 0, 1, 1)";
  const DEFAULT_RETURN_SCROLL_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
  const DEFAULT_FOLD_BLEND_CURVE =
    "cubic-bezier(0.333, 0, 0.667, 1)";
  const DEFAULT_DRIZZLE_VOLUME_EASING =
    "cubic-bezier(0.4, 0, 0.2, 1)";
  const ROCK_WIDTH_VW_LIMITS = Object.freeze([1, 150]);
  const ROCK_IMAGE_IDS = Object.freeze(["rock-03", "rock", "rock2"]);
  const HAND_VISIBILITY_MODES = Object.freeze(["always", "hover", "hidden"]);
  const SUMMIT_TIMER_FONT_FAMILIES = Object.freeze([
    "sf-pro-display-bold",
    "droid-1997",
    "aksent",
  ]);
  const GACHI_SOUND_FILENAMES = Object.freeze([
    "Aaaaaa.mp3",
    "Aaaaah.mp3",
    "Camen.mp3",
    "Deep dark fantasies.mp3",
    "Dungeon master.mp3",
    "Get your ass down for me now boy.mp3",
    "Like that.mp3",
    "ahhhhhhh.mp3",
    "thats-amazing.mp3",
  ]);
  const DEFAULT_GACHI_CLICK_SOUND_FILENAME = "Camen.mp3";
  const PRECLICK_POPUP_ARTWORK_MODES = Object.freeze([
    "random",
    "shuffle",
    "single",
  ]);
  const DEFAULT_PRECLICK_POPUP_ARTWORK_ID = "01.png";
  const ROCK_LENS_EFFECTS = Object.freeze([
    "brandon-mercer",
    "liquid-bulge",
    "vortex-lens",
    "pinch-tunnel",
    "ripple-glass",
  ]);
  const ROCK_LENS_ACTIVATION_MODES = Object.freeze(["hover", "hold"]);
  const ROCK_LENS_PRESETS = Object.freeze({
    "brandon-mercer": Object.freeze({
      effect: "brandon-mercer",
      radius: 0.3,
      strength: 0.49,
      softness: 1,
      twistDegrees: 0,
      trail: 0.15,
      dissipation: 0.96,
      activation: "hover",
    }),
    "liquid-bulge": Object.freeze({
      effect: "liquid-bulge",
      radius: 0.4,
      strength: 0.72,
      softness: 1.35,
      twistDegrees: 0,
      trail: 0.08,
      dissipation: 0.92,
      activation: "hover",
    }),
    "vortex-lens": Object.freeze({
      effect: "vortex-lens",
      radius: 0.44,
      strength: 0.95,
      softness: 1.8,
      twistDegrees: 165,
      trail: 0.12,
      dissipation: 0.94,
      activation: "hover",
    }),
    "pinch-tunnel": Object.freeze({
      effect: "pinch-tunnel",
      radius: 0.38,
      strength: 0.82,
      softness: 1.5,
      twistDegrees: 75,
      trail: 0.1,
      dissipation: 0.93,
      activation: "hold",
    }),
    "ripple-glass": Object.freeze({
      effect: "ripple-glass",
      radius: 0.46,
      strength: 0.58,
      softness: 2.1,
      twistDegrees: 30,
      trail: 0.08,
      dissipation: 0.91,
      activation: "hover",
    }),
  });
  const DEFAULT_ROCK_LENS_CONFIG = ROCK_LENS_PRESETS["brandon-mercer"];

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
    cameraFollowUpLerp: [0.01, 1],
    cameraFollowDownLerp: [0.01, 1],
    foldPositionPercent: [0, 100],
    foldPanelHeightVh: [1, 100],
    foldAngle: [0, 180],
    foldZoneSize: [0, 50],
    finalFallDelaySeconds: [0, 10],
    rockLensRadius: [0.05, 0.75],
    rockLensStrength: [0, 1.5],
    rockLensSoftness: [0.2, 3],
    rockLensTwistDegrees: [-220, 220],
    rockLensTrail: [0, 0.5],
    rockLensDissipation: [0.75, 0.99],
    drizzleVolume: [0, 1],
    customCursorSizePx: [8, 128],
    handImageChangeDelayMs: [0, 1000],
    handWidthVw: [10, 90],
    heightGateCount: [0, MAX_HEIGHT_GATES],
    heightGatePercent: [1, 99],
    heightGateDurationSeconds: [1, 60],
    sceneTwoBarrierHeightVh: [0, 10000],
    sceneTwoBarrierHopActivationRadiusPercent: [0, 300],
    sceneTwoBarrierHopMaxDistancePercent: [0, 150],
    sceneTwoBarrierHopMissProbabilityPercent: [0, 100],
    sceneTwoBarrierHopSpeedPxPerSecond: [100, 5000],
    sceneTwoGlassStripHeightPercent: [1, 99],
    sceneTwoGlassStripXPercent: [0, 90],
    sceneTwoGlassStripWidthPercent: [10, 90],
    sceneTwoGlassStripHeightVh: [1, 40],
    sceneTwoGlassZIndex: [7, 17],
    sceneTwoGlassOpacity: [0.1, 0.9],
    sceneTwoGlassBlurPx: [0, 40],
    sceneTwoGlassRefractionPercent: [0, 200],
    sceneTwoGlassBorderRadiusPx: [0, 80],
    sceneTwoGlassBounce: [0, 1],
    rockWidthVw: ROCK_WIDTH_VW_LIMITS,
    preclickHopGuardClickCount: [0, 10],
    preclickPopupDelayMs: [0, 1000],
    preclickPopupWidthViewportFraction: [0.01, 1],
    rockEchoTrailCopies: [1, 40],
    rockEchoTrailIntervalMs: [16, 500],
    rockEchoTrailOpacity: [0.05, 1],
    rockEchoTrailLifetimeMs: [100, 5000],
    birchScalePercent: [100, 400],
    preclickHopActivationRadiusPercent: [0, 300],
    preclickHopMaxDistancePercent: [0, 150],
    preclickHopMissProbabilityPercent: [0, 100],
    preclickHopSpeedPxPerSecond: [100, 5000],
    rockGrabRadiusVh: [0, 10],
    rockPressShrinkPercent: [0, 50],
    rockWallPenetrationPercent: [0, 50],
    rockPulseShrinkPercent: [0, 50],
    rockPulseBpm: [20, 240],
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
    summitTimerFontSizeRem: [4, 64],
    lineDelay: [0, 1],
    trailAnchorHeightPercent: [0, 100],
    trailMaxPoints: [20, 10000],
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
    cameraFollowUpEnabled: true,
    cameraFollowUpLerp: 0.1,
    cameraFollowDownEnabled: true,
    cameraFollowDownLerp: 0.1,
    rockAccelerationEnabled: false,
    sceneTwoOverflowYVisible: false,
    gachiClickSoundFilename: DEFAULT_GACHI_CLICK_SOUND_FILENAME,
    foldPositionPercent: 0,
    foldPanelHeightVh: 20,
    foldAngle: 30,
    foldZoneSize: 20,
    foldBlendEnabled: true,
    foldBlendCurve: DEFAULT_FOLD_BLEND_CURVE,
    finalFallEnabled: false,
    finalFallDelaySeconds: 2,
    rockLensConfig: DEFAULT_ROCK_LENS_CONFIG,
    randomDropEnabled: true,
    rockJumpEnabled: true,
    rockJumpIntervalSeconds: 5,
    rockJumpAngleSpreadDegrees: 90,
    rockJumpInertiaSpreadPercent: 25,
    rockImageId: "rock-03",
    foldRockImageId: "rock-03",
    rockScaleEasing: DEFAULT_ROCK_SCALE_EASING,
    rockActivatedWidthVw: DEFAULT_ROCK_ACTIVATED_WIDTH_VW,
    rockPressShrinkPercent: 5,
    rockWallPenetrationPercent: 20,
    rockPulseEnabled: false,
    rockPulseShrinkPercent: 5,
    rockPulseBpm: 60,
    rockMinWidthVw: DEFAULT_ROCK_MIN_WIDTH_VW,
    rockMaxWidthVw: DEFAULT_ROCK_MAX_WIDTH_VW,
    preclickHopGuardClickCount: 1,
    preclickPopupDelayMs: 200,
    preclickPopupWidthViewportFraction: 0.2,
    preclickPopupArtworkMode: "shuffle",
    preclickPopupArtworkId: DEFAULT_PRECLICK_POPUP_ARTWORK_ID,
    rockEchoTrailEnabled: true,
    rockEchoTrailCopies: 16,
    rockEchoTrailIntervalMs: 50,
    rockEchoTrailOpacity: 0.55,
    rockEchoTrailLifetimeMs: 900,
    birchBackgroundEnabled: false,
    birchScalePercent: 100,
    preclickHopActivationRadiusPercent: 50,
    preclickHopMaxDistancePercent: 62.5,
    preclickHopMissProbabilityPercent: 10,
    preclickHopSpeedPxPerSecond: 1200,
    preclickHopSpeedEasing: DEFAULT_PRECLICK_HOP_SPEED_EASING,
    customCursorEnabled: false,
    customCursorSizePx: 32,
    handVisibilityMode: "always",
    handImageChangeDelayMs: 0,
    rockGrabRadiusVh: 0,
    handWidthVw: 14.375,
    heightGates: Object.freeze([]),
    handForceDeficitEasing: DEFAULT_HAND_FORCE_DEFICIT_EASING,
    sceneTwoBarrierEnabled: false,
    sceneTwoBarrierHeightVh: 1250,
    sceneTwoBarrierHopActivationRadiusPercent: 50,
    sceneTwoBarrierHopMaxDistancePercent: 62.5,
    sceneTwoBarrierHopMissProbabilityPercent: 10,
    sceneTwoBarrierHopSpeedPxPerSecond: 1200,
    sceneTwoBarrierHopSpeedEasing: DEFAULT_PRECLICK_HOP_SPEED_EASING,
    sceneTwoGlassEnabled: false,
    sceneTwoGlassStrips: Object.freeze([]),
    sceneTwoGlassZIndex: 8,
    sceneTwoGlassOpacity: 0.42,
    sceneTwoGlassBlurPx: 18,
    sceneTwoGlassRefractionPercent: 100,
    sceneTwoGlassBorderRadiusPx: 24,
    sceneTwoGlassBounce: 0.55,
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
    summitTimerFontFamily: "sf-pro-display-bold",
    summitTimerFontSizeRem: 32,
    trailEnabled: true,
    trailReset: false,
    lineDelay: 0.5,
    trailAnchorHeightPercent: 100,
    trailMaxPoints: 10000,
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

  function parseRockLensConfig(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value;
    }
    if (typeof value !== "string") {
      return null;
    }
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  function sanitizeRockLensConfig(input, fallback = DEFAULT_ROCK_LENS_CONFIG) {
    const source = parseRockLensConfig(input) || {};
    const fallbackSource = parseRockLensConfig(fallback) || DEFAULT_ROCK_LENS_CONFIG;
    const effect = ROCK_LENS_EFFECTS.includes(source.effect)
      ? source.effect
      : ROCK_LENS_EFFECTS.includes(fallbackSource.effect)
        ? fallbackSource.effect
        : DEFAULT_ROCK_LENS_CONFIG.effect;
    const preset = ROCK_LENS_PRESETS[effect];
    const sameEffectFallback = fallbackSource.effect === effect
      ? fallbackSource
      : preset;
    const bounded = (key, limits) => clamp(
      finiteNumber(
        source[key],
        finiteNumber(sameEffectFallback[key], preset[key]),
      ),
      limits[0],
      limits[1],
    );
    return {
      effect,
      radius: bounded("radius", ROOM_SETTINGS_LIMITS.rockLensRadius),
      strength: bounded("strength", ROOM_SETTINGS_LIMITS.rockLensStrength),
      softness: bounded("softness", ROOM_SETTINGS_LIMITS.rockLensSoftness),
      twistDegrees: bounded(
        "twistDegrees",
        ROOM_SETTINGS_LIMITS.rockLensTwistDegrees,
      ),
      trail: bounded("trail", ROOM_SETTINGS_LIMITS.rockLensTrail),
      dissipation: bounded(
        "dissipation",
        ROOM_SETTINGS_LIMITS.rockLensDissipation,
      ),
      activation: ROCK_LENS_ACTIVATION_MODES.includes(source.activation)
        ? source.activation
        : ROCK_LENS_ACTIVATION_MODES.includes(sameEffectFallback.activation)
          ? sameEffectFallback.activation
          : preset.activation,
    };
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

  function sanitizeSceneTwoGlassStrips(input, fallback = []) {
    const source = Array.isArray(input)
      ? input
      : Array.isArray(fallback)
        ? fallback
        : [];
    const [heightMin, heightMax] =
      ROOM_SETTINGS_LIMITS.sceneTwoGlassStripHeightPercent;
    const [xMin, xMax] = ROOM_SETTINGS_LIMITS.sceneTwoGlassStripXPercent;
    const [widthMin, widthMax] =
      ROOM_SETTINGS_LIMITS.sceneTwoGlassStripWidthPercent;
    const [stripHeightMin, stripHeightMax] =
      ROOM_SETTINGS_LIMITS.sceneTwoGlassStripHeightVh;
    const usedIds = new Set();
    const strips = [];

    source.slice(0, MAX_SCENE_TWO_GLASS_STRIPS).forEach((candidate, index) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        return;
      }
      const heightPercent = Math.round(
        clamp(finiteNumber(candidate.heightPercent, 20), heightMin, heightMax)
      );
      const widthPercent = clamp(
        finiteNumber(candidate.widthPercent, 55),
        widthMin,
        widthMax
      );
      const xPercent = clamp(
        finiteNumber(candidate.xPercent, index % 2 === 0 ? 0 : 45),
        xMin,
        Math.min(xMax, 100 - widthPercent)
      );
      const heightVh = clamp(
        finiteNumber(candidate.heightVh, 3),
        stripHeightMin,
        stripHeightMax
      );
      const rawId = String(candidate.id || "").trim();
      const safeId = /^[A-Za-z0-9_-]{1,64}$/.test(rawId)
        ? rawId
        : `glass-strip-${index + 1}-${heightPercent}`;
      let id = safeId;
      let suffix = 2;
      while (usedIds.has(id)) {
        const suffixText = `-${suffix}`;
        id = `${safeId.slice(0, 64 - suffixText.length)}${suffixText}`;
        suffix += 1;
      }
      usedIds.add(id);
      strips.push({
        id,
        enabled: candidate.enabled !== false,
        heightPercent,
        xPercent,
        widthPercent,
        heightVh,
      });
    });

    return strips;
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

  function goghArtworkIdSetting(source, fallbackSource) {
    const validId = (value) => {
      const normalized = String(value || "").trim();
      return normalized.length <= 255 &&
        /^[^\\/\0]+\.(?:avif|gif|jpe?g|png|webp)$/i.test(normalized)
        ? normalized
        : "";
    };
    return validId(source.preclickPopupArtworkId) ||
      validId(fallbackSource.preclickPopupArtworkId) ||
      DEFAULT_PRECLICK_POPUP_ARTWORK_ID;
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
    const [cameraFollowUpLerpMin, cameraFollowUpLerpMax] =
      ROOM_SETTINGS_LIMITS.cameraFollowUpLerp;
    const [cameraFollowDownLerpMin, cameraFollowDownLerpMax] =
      ROOM_SETTINGS_LIMITS.cameraFollowDownLerp;
    const [foldPositionMin, foldPositionMax] =
      ROOM_SETTINGS_LIMITS.foldPositionPercent;
    const [foldPanelHeightMin, foldPanelHeightMax] =
      ROOM_SETTINGS_LIMITS.foldPanelHeightVh;
    const [foldAngleMin, foldAngleMax] =
      ROOM_SETTINGS_LIMITS.foldAngle;
    const [foldZoneMin, foldZoneMax] =
      ROOM_SETTINGS_LIMITS.foldZoneSize;
    const [finalFallDelayMin, finalFallDelayMax] =
      ROOM_SETTINGS_LIMITS.finalFallDelaySeconds;
    const [rockJumpIntervalMin, rockJumpIntervalMax] =
      ROOM_SETTINGS_LIMITS.rockJumpIntervalSeconds;
    const [rockJumpAngleSpreadMin, rockJumpAngleSpreadMax] =
      ROOM_SETTINGS_LIMITS.rockJumpAngleSpreadDegrees;
    const [rockJumpSpreadMin, rockJumpSpreadMax] =
      ROOM_SETTINGS_LIMITS.rockJumpInertiaSpreadPercent;
    const [preclickHopGuardClickMin, preclickHopGuardClickMax] =
      ROOM_SETTINGS_LIMITS.preclickHopGuardClickCount;
    const [preclickHopRadiusMin, preclickHopRadiusMax] =
      ROOM_SETTINGS_LIMITS.preclickHopActivationRadiusPercent;
    const [preclickHopDistanceMin, preclickHopDistanceMax] =
      ROOM_SETTINGS_LIMITS.preclickHopMaxDistancePercent;
    const [preclickHopMissMin, preclickHopMissMax] =
      ROOM_SETTINGS_LIMITS.preclickHopMissProbabilityPercent;
    const [preclickHopSpeedMin, preclickHopSpeedMax] =
      ROOM_SETTINGS_LIMITS.preclickHopSpeedPxPerSecond;
    const [drizzleVolumeMin, drizzleVolumeMax] =
      ROOM_SETTINGS_LIMITS.drizzleVolume;
    const [handMin, handMax] = ROOM_SETTINGS_LIMITS.handWidthVw;
    const [rockGrabRadiusMin, rockGrabRadiusMax] =
      ROOM_SETTINGS_LIMITS.rockGrabRadiusVh;
    const [rockPressShrinkMin, rockPressShrinkMax] =
      ROOM_SETTINGS_LIMITS.rockPressShrinkPercent;
    const [rockWallPenetrationMin, rockWallPenetrationMax] =
      ROOM_SETTINGS_LIMITS.rockWallPenetrationPercent;
    const [rockPulseShrinkMin, rockPulseShrinkMax] =
      ROOM_SETTINGS_LIMITS.rockPulseShrinkPercent;
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
    const [summitTimerFontSizeMin, summitTimerFontSizeMax] =
      ROOM_SETTINGS_LIMITS.summitTimerFontSizeRem;
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
    const preclickHopRadiusSource = migratePreclickHopSettings(source);
    const preclickHopFallbackSource = migratePreclickHopSettings(fallbackSource);
    const preclickHopActivationRadiusPercent = finiteSetting(
      preclickHopRadiusSource,
      preclickHopFallbackSource,
      "preclickHopActivationRadiusPercent",
      preclickHopRadiusMin,
      preclickHopRadiusMax
    );
    const preclickHopDistanceSource = Object.hasOwn(
      preclickHopRadiusSource,
      "preclickHopMaxDistancePercent"
    )
      ? preclickHopRadiusSource
      : Object.hasOwn(
          preclickHopRadiusSource,
          "preclickHopActivationRadiusPercent"
        )
        ? {
            ...preclickHopRadiusSource,
            preclickHopMaxDistancePercent:
              preclickHopActivationRadiusPercent * 1.25,
          }
        : preclickHopRadiusSource;

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
      cameraFollowUpEnabled: boolSetting(
        source,
        fallbackSource,
        "cameraFollowUpEnabled"
      ),
      cameraFollowUpLerp: finiteSetting(
        source,
        fallbackSource,
        "cameraFollowUpLerp",
        cameraFollowUpLerpMin,
        cameraFollowUpLerpMax
      ),
      cameraFollowDownEnabled: boolSetting(
        source,
        fallbackSource,
        "cameraFollowDownEnabled"
      ),
      cameraFollowDownLerp: finiteSetting(
        source,
        fallbackSource,
        "cameraFollowDownLerp",
        cameraFollowDownLerpMin,
        cameraFollowDownLerpMax
      ),
      summitTimerFontFamily: enumSetting(
        source,
        fallbackSource,
        "summitTimerFontFamily",
        SUMMIT_TIMER_FONT_FAMILIES
      ),
      summitTimerFontSizeRem: finiteSetting(
        source,
        fallbackSource,
        "summitTimerFontSizeRem",
        summitTimerFontSizeMin,
        summitTimerFontSizeMax
      ),
      rockAccelerationEnabled: false,
      sceneTwoOverflowYVisible: boolSetting(
        source,
        fallbackSource,
        "sceneTwoOverflowYVisible"
      ),
      gachiClickSoundFilename: enumSetting(
        source,
        fallbackSource,
        "gachiClickSoundFilename",
        GACHI_SOUND_FILENAMES
      ),
      foldPositionPercent: integerSetting(
        source,
        fallbackSource,
        "foldPositionPercent",
        foldPositionMin,
        foldPositionMax
      ),
      foldPanelHeightVh: integerSetting(
        source,
        fallbackSource,
        "foldPanelHeightVh",
        foldPanelHeightMin,
        foldPanelHeightMax
      ),
      foldAngle: integerSetting(
        source,
        fallbackSource,
        "foldAngle",
        foldAngleMin,
        foldAngleMax
      ),
      foldZoneSize: integerSetting(
        source,
        fallbackSource,
        "foldZoneSize",
        foldZoneMin,
        foldZoneMax
      ),
      foldBlendEnabled: boolSetting(
        source,
        fallbackSource,
        "foldBlendEnabled"
      ),
      foldBlendCurve: cubicBezierSetting(
        source,
        fallbackSource,
        "foldBlendCurve"
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
      rockLensConfig: sanitizeRockLensConfig(
        source.rockLensConfig,
        fallbackSource.rockLensConfig
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
      rockImageId: enumSetting(
        source,
        fallbackSource,
        "rockImageId",
        ROCK_IMAGE_IDS
      ),
      foldRockImageId: enumSetting(
        source,
        fallbackSource,
        "foldRockImageId",
        ROCK_IMAGE_IDS
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
      rockPressShrinkPercent: integerSetting(
        source,
        fallbackSource,
        "rockPressShrinkPercent",
        rockPressShrinkMin,
        rockPressShrinkMax
      ),
      rockWallPenetrationPercent: integerSetting(
        source,
        fallbackSource,
        "rockWallPenetrationPercent",
        rockWallPenetrationMin,
        rockWallPenetrationMax
      ),
      rockPulseEnabled: boolSetting(
        source,
        fallbackSource,
        "rockPulseEnabled"
      ),
      rockPulseShrinkPercent: integerSetting(
        source,
        fallbackSource,
        "rockPulseShrinkPercent",
        rockPulseShrinkMin,
        rockPulseShrinkMax
      ),
      rockPulseBpm: finiteSetting(
        source,
        fallbackSource,
        "rockPulseBpm",
        ROOM_SETTINGS_LIMITS.rockPulseBpm[0],
        ROOM_SETTINGS_LIMITS.rockPulseBpm[1]
      ),
      preclickHopGuardClickCount: integerSetting(
        preclickHopRadiusSource,
        preclickHopFallbackSource,
        "preclickHopGuardClickCount",
        preclickHopGuardClickMin,
        preclickHopGuardClickMax
      ),
      preclickPopupDelayMs: integerSetting(
        source,
        fallbackSource,
        "preclickPopupDelayMs",
        ROOM_SETTINGS_LIMITS.preclickPopupDelayMs[0],
        ROOM_SETTINGS_LIMITS.preclickPopupDelayMs[1]
      ),
      preclickPopupWidthViewportFraction: finiteSetting(
        source,
        fallbackSource,
        "preclickPopupWidthViewportFraction",
        ROOM_SETTINGS_LIMITS.preclickPopupWidthViewportFraction[0],
        ROOM_SETTINGS_LIMITS.preclickPopupWidthViewportFraction[1]
      ),
      preclickPopupArtworkMode: enumSetting(
        source,
        fallbackSource,
        "preclickPopupArtworkMode",
        PRECLICK_POPUP_ARTWORK_MODES
      ),
      preclickPopupArtworkId: goghArtworkIdSetting(source, fallbackSource),
      rockEchoTrailEnabled: boolSetting(
        source,
        fallbackSource,
        "rockEchoTrailEnabled"
      ),
      rockEchoTrailCopies: integerSetting(
        source,
        fallbackSource,
        "rockEchoTrailCopies",
        ROOM_SETTINGS_LIMITS.rockEchoTrailCopies[0],
        ROOM_SETTINGS_LIMITS.rockEchoTrailCopies[1]
      ),
      rockEchoTrailIntervalMs: integerSetting(
        source,
        fallbackSource,
        "rockEchoTrailIntervalMs",
        ROOM_SETTINGS_LIMITS.rockEchoTrailIntervalMs[0],
        ROOM_SETTINGS_LIMITS.rockEchoTrailIntervalMs[1]
      ),
      rockEchoTrailOpacity: finiteSetting(
        source,
        fallbackSource,
        "rockEchoTrailOpacity",
        ROOM_SETTINGS_LIMITS.rockEchoTrailOpacity[0],
        ROOM_SETTINGS_LIMITS.rockEchoTrailOpacity[1]
      ),
      rockEchoTrailLifetimeMs: integerSetting(
        source,
        fallbackSource,
        "rockEchoTrailLifetimeMs",
        ROOM_SETTINGS_LIMITS.rockEchoTrailLifetimeMs[0],
        ROOM_SETTINGS_LIMITS.rockEchoTrailLifetimeMs[1]
      ),
      birchBackgroundEnabled: boolSetting(
        source,
        fallbackSource,
        "birchBackgroundEnabled"
      ),
      birchScalePercent: integerSetting(
        source,
        fallbackSource,
        "birchScalePercent",
        ROOM_SETTINGS_LIMITS.birchScalePercent[0],
        ROOM_SETTINGS_LIMITS.birchScalePercent[1]
      ),
      preclickHopActivationRadiusPercent,
      preclickHopMaxDistancePercent: finiteSetting(
        preclickHopDistanceSource,
        preclickHopFallbackSource,
        "preclickHopMaxDistancePercent",
        preclickHopDistanceMin,
        preclickHopDistanceMax
      ),
      preclickHopMissProbabilityPercent: finiteSetting(
        preclickHopRadiusSource,
        preclickHopFallbackSource,
        "preclickHopMissProbabilityPercent",
        preclickHopMissMin,
        preclickHopMissMax
      ),
      preclickHopSpeedPxPerSecond: finiteSetting(
        preclickHopRadiusSource,
        preclickHopFallbackSource,
        "preclickHopSpeedPxPerSecond",
        preclickHopSpeedMin,
        preclickHopSpeedMax
      ),
      preclickHopSpeedEasing: cubicBezierSetting(
        preclickHopRadiusSource,
        preclickHopFallbackSource,
        "preclickHopSpeedEasing"
      ),
      customCursorEnabled: boolSetting(
        source,
        fallbackSource,
        "customCursorEnabled"
      ),
      customCursorSizePx: integerSetting(
        source,
        fallbackSource,
        "customCursorSizePx",
        ROOM_SETTINGS_LIMITS.customCursorSizePx[0],
        ROOM_SETTINGS_LIMITS.customCursorSizePx[1]
      ),
      handVisibilityMode: enumSetting(
        source,
        fallbackSource,
        "handVisibilityMode",
        HAND_VISIBILITY_MODES
      ),
      handImageChangeDelayMs: integerSetting(
        source,
        fallbackSource,
        "handImageChangeDelayMs",
        ROOM_SETTINGS_LIMITS.handImageChangeDelayMs[0],
        ROOM_SETTINGS_LIMITS.handImageChangeDelayMs[1]
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
      sceneTwoBarrierEnabled: boolSetting(
        source,
        fallbackSource,
        "sceneTwoBarrierEnabled"
      ),
      sceneTwoBarrierHeightVh: integerSetting(
        source,
        fallbackSource,
        "sceneTwoBarrierHeightVh",
        ROOM_SETTINGS_LIMITS.sceneTwoBarrierHeightVh[0],
        ROOM_SETTINGS_LIMITS.sceneTwoBarrierHeightVh[1]
      ),
      sceneTwoBarrierHopActivationRadiusPercent: finiteSetting(
        source,
        fallbackSource,
        "sceneTwoBarrierHopActivationRadiusPercent",
        ROOM_SETTINGS_LIMITS.sceneTwoBarrierHopActivationRadiusPercent[0],
        ROOM_SETTINGS_LIMITS.sceneTwoBarrierHopActivationRadiusPercent[1]
      ),
      sceneTwoBarrierHopMaxDistancePercent: finiteSetting(
        source,
        fallbackSource,
        "sceneTwoBarrierHopMaxDistancePercent",
        ROOM_SETTINGS_LIMITS.sceneTwoBarrierHopMaxDistancePercent[0],
        ROOM_SETTINGS_LIMITS.sceneTwoBarrierHopMaxDistancePercent[1]
      ),
      sceneTwoBarrierHopMissProbabilityPercent: finiteSetting(
        source,
        fallbackSource,
        "sceneTwoBarrierHopMissProbabilityPercent",
        ROOM_SETTINGS_LIMITS.sceneTwoBarrierHopMissProbabilityPercent[0],
        ROOM_SETTINGS_LIMITS.sceneTwoBarrierHopMissProbabilityPercent[1]
      ),
      sceneTwoBarrierHopSpeedPxPerSecond: finiteSetting(
        source,
        fallbackSource,
        "sceneTwoBarrierHopSpeedPxPerSecond",
        ROOM_SETTINGS_LIMITS.sceneTwoBarrierHopSpeedPxPerSecond[0],
        ROOM_SETTINGS_LIMITS.sceneTwoBarrierHopSpeedPxPerSecond[1]
      ),
      sceneTwoBarrierHopSpeedEasing: cubicBezierSetting(
        source,
        fallbackSource,
        "sceneTwoBarrierHopSpeedEasing"
      ),
      sceneTwoGlassEnabled: boolSetting(
        source,
        fallbackSource,
        "sceneTwoGlassEnabled"
      ),
      sceneTwoGlassStrips: sanitizeSceneTwoGlassStrips(
        source.sceneTwoGlassStrips,
        fallbackSource.sceneTwoGlassStrips
      ),
      sceneTwoGlassZIndex: integerSetting(
        source,
        fallbackSource,
        "sceneTwoGlassZIndex",
        ROOM_SETTINGS_LIMITS.sceneTwoGlassZIndex[0],
        ROOM_SETTINGS_LIMITS.sceneTwoGlassZIndex[1]
      ),
      sceneTwoGlassOpacity: finiteSetting(
        source,
        fallbackSource,
        "sceneTwoGlassOpacity",
        ROOM_SETTINGS_LIMITS.sceneTwoGlassOpacity[0],
        ROOM_SETTINGS_LIMITS.sceneTwoGlassOpacity[1]
      ),
      sceneTwoGlassBlurPx: finiteSetting(
        source,
        fallbackSource,
        "sceneTwoGlassBlurPx",
        ROOM_SETTINGS_LIMITS.sceneTwoGlassBlurPx[0],
        ROOM_SETTINGS_LIMITS.sceneTwoGlassBlurPx[1]
      ),
      sceneTwoGlassRefractionPercent: finiteSetting(
        source,
        fallbackSource,
        "sceneTwoGlassRefractionPercent",
        ROOM_SETTINGS_LIMITS.sceneTwoGlassRefractionPercent[0],
        ROOM_SETTINGS_LIMITS.sceneTwoGlassRefractionPercent[1]
      ),
      sceneTwoGlassBorderRadiusPx: finiteSetting(
        source,
        fallbackSource,
        "sceneTwoGlassBorderRadiusPx",
        ROOM_SETTINGS_LIMITS.sceneTwoGlassBorderRadiusPx[0],
        ROOM_SETTINGS_LIMITS.sceneTwoGlassBorderRadiusPx[1]
      ),
      sceneTwoGlassBounce: finiteSetting(
        source,
        fallbackSource,
        "sceneTwoGlassBounce",
        ROOM_SETTINGS_LIMITS.sceneTwoGlassBounce[0],
        ROOM_SETTINGS_LIMITS.sceneTwoGlassBounce[1]
      ),
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

  function migrateFoldSettings(input) {
    const source = input && typeof input === "object" ? { ...input } : {};
    [
      ["foldAngle", "draftFoldAngle"],
      ["foldZoneSize", "draftFoldZoneSize"],
      ["foldBlendEnabled", "draftFoldBlendEnabled"],
      ["foldBlendCurve", "draftFoldBlendCurve"],
    ].forEach(([currentKey, legacyKey]) => {
      if (!Object.hasOwn(source, currentKey) && Object.hasOwn(source, legacyKey)) {
        source[currentKey] = source[legacyKey];
      }
      delete source[legacyKey];
    });
    return source;
  }

  function migratePreclickHopSettings(input) {
    const source = input && typeof input === "object" ? { ...input } : {};
    if (!Object.hasOwn(source, "preclickHopActivationRadiusPercent")) {
      const previousHopRadius = Number(source.preclickHopActivationRadiusVw);
      const previousRadiusVw = Number(source.preclickParallaxActivationRadiusVw);
      const previousRadiusPx = Number(source.preclickParallaxActivationRadiusPx);
      source.preclickHopActivationRadiusPercent = Number.isFinite(
        previousHopRadius
      )
        ? previousHopRadius
        : Number.isFinite(previousRadiusVw)
          ? previousRadiusVw
          : Number.isFinite(previousRadiusPx)
            ? previousRadiusPx / PRECLICK_PARALLAX_RADIUS_PX_PER_VW
            : DEFAULT_ROOM_SETTINGS.preclickHopActivationRadiusPercent;
    }
    if (!Object.hasOwn(source, "preclickHopMaxDistancePercent")) {
      const previousHopDistance = Number(source.preclickHopMaxDistanceVw);
      const radiusPercent = Number(source.preclickHopActivationRadiusPercent);
      const [minDistance, maxDistance] =
        ROOM_SETTINGS_LIMITS.preclickHopMaxDistancePercent;
      source.preclickHopMaxDistancePercent = Number.isFinite(
        previousHopDistance
      )
        ? clamp(previousHopDistance, minDistance, maxDistance)
        : clamp(
            (Number.isFinite(radiusPercent)
              ? radiusPercent
              : DEFAULT_ROOM_SETTINGS.preclickHopActivationRadiusPercent) *
              1.25,
            minDistance,
            maxDistance
          );
    }
    if (!Object.hasOwn(source, "preclickHopGuardClickCount")) {
      source.preclickHopGuardClickCount =
        DEFAULT_ROOM_SETTINGS.preclickHopGuardClickCount;
    }
    delete source.preclickHopActivationRadiusVw;
    delete source.preclickHopMaxDistanceVw;
    LEGACY_PRECLICK_PARALLAX_SETTING_KEYS.forEach((key) => {
      delete source[key];
    });
    return source;
  }

  function migrateRockVisualSettings(input) {
    const source = input && typeof input === "object" ? { ...input } : {};
    if (!Object.hasOwn(source, "rockImageId")) {
      source.rockImageId = DEFAULT_ROOM_SETTINGS.rockImageId;
    }
    if (!Object.hasOwn(source, "foldRockImageId")) {
      source.foldRockImageId = DEFAULT_ROOM_SETTINGS.foldRockImageId;
    }
    if (!Object.hasOwn(source, "rockPulseShrinkPercent")) {
      source.rockPulseShrinkPercent = Object.hasOwn(
        source,
        "rockPressShrinkPercent"
      )
        ? source.rockPressShrinkPercent
        : DEFAULT_ROOM_SETTINGS.rockPulseShrinkPercent;
    }
    return source;
  }

  function migrateHandDisplaySettings(input) {
    const source = input && typeof input === "object" ? { ...input } : {};
    if (!Object.hasOwn(source, "handVisibilityMode")) {
      source.handVisibilityMode = Object.hasOwn(source, "handAlwaysVisible")
        ? boolSetting(source, DEFAULT_ROOM_SETTINGS, "handAlwaysVisible")
          ? "always"
          : "hover"
        : DEFAULT_ROOM_SETTINGS.handVisibilityMode;
    }
    if (!Object.hasOwn(source, "handImageChangeDelayMs")) {
      source.handImageChangeDelayMs =
        DEFAULT_ROOM_SETTINGS.handImageChangeDelayMs;
    }
    delete source.handAlwaysVisible;
    return source;
  }

  function migrateFoldLayoutSettings(input) {
    const source = input && typeof input === "object" ? { ...input } : {};
    if (!Object.hasOwn(source, "foldPositionPercent")) {
      source.foldPositionPercent = DEFAULT_ROOM_SETTINGS.foldPositionPercent;
    }
    if (!Object.hasOwn(source, "foldPanelHeightVh")) {
      const previousZoneSize = Number(source.foldZoneSize);
      const [minHeight, maxHeight] = ROOM_SETTINGS_LIMITS.foldPanelHeightVh;
      source.foldPanelHeightVh = Number.isFinite(previousZoneSize)
        ? clamp(previousZoneSize, minHeight, maxHeight)
        : DEFAULT_ROOM_SETTINGS.foldPanelHeightVh;
    }
    return source;
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
    if (finiteNumber(version, 1) < 25) {
      if (!Object.hasOwn(source, "handAlwaysVisible")) {
        source.handAlwaysVisible = true;
      }
      if (!Object.hasOwn(source, "cameraFollowLerp")) {
        source.cameraFollowLerp = DEFAULT_ROOM_SETTINGS.cameraFollowUpLerp;
      }
      delete source.positionScrollEnabled;
      delete source.positionScrollZonePercent;
      delete source.positionScrollStartSpeedVh;
      delete source.positionScrollEndSpeedVh;
      delete source.positionScrollEasing;
      delete source.manualVerticalScrollEnabled;
    }
    if (finiteNumber(version, 1) < 26) {
      if (!Object.hasOwn(source, "rockGrabRadiusVh")) {
        source.rockGrabRadiusVh = DEFAULT_ROOM_SETTINGS.rockGrabRadiusVh;
      }
    }
    if (finiteNumber(version, 1) < 30) {
      ["customCursorEnabled", "customCursorSizePx"].forEach((key) => {
        if (!Object.hasOwn(source, key)) {
          source[key] = DEFAULT_ROOM_SETTINGS[key];
        }
      });
    }
    const foldMigrated = finiteNumber(version, 1) < 31
      ? migrateFoldSettings(source)
      : source;
    const rockMigrated = finiteNumber(version, 1) < 33
      ? migrateRockVisualSettings(foldMigrated)
      : foldMigrated;
    const hopMigrated = finiteNumber(version, 1) < 34
      ? migratePreclickHopSettings(rockMigrated)
      : rockMigrated;
    const handDisplayMigrated = finiteNumber(version, 1) < 35
      ? migrateHandDisplaySettings(hopMigrated)
      : hopMigrated;
    const foldLayoutMigrated = finiteNumber(version, 1) < 36
      ? migrateFoldLayoutSettings(handDisplayMigrated)
      : handDisplayMigrated;
    const current = finiteNumber(version, 1) < 38
      ? migratePreclickHopSettings(foldLayoutMigrated)
      : foldLayoutMigrated;
    if (finiteNumber(version, 1) < 41) {
      if (current.trailUnlimited === true) {
        current.trailMaxPoints = ROOM_SETTINGS_LIMITS.trailMaxPoints[1];
      }
      delete current.trailUnlimited;
    }
    if (finiteNumber(version, 1) < 42) {
      [
        "preclickHopMissProbabilityPercent",
        "preclickHopSpeedPxPerSecond",
        "preclickHopSpeedEasing",
      ].forEach((key) => {
        if (!Object.hasOwn(current, key)) {
          current[key] = DEFAULT_ROOM_SETTINGS[key];
        }
      });
    }
    if (finiteNumber(version, 1) < 43) {
      [
        "cameraFollowDownEnabled",
        "gachiClickSoundFilename",
      ].forEach((key) => {
        if (!Object.hasOwn(current, key)) {
          current[key] = DEFAULT_ROOM_SETTINGS[key];
        }
      });
    }
    if (finiteNumber(version, 1) < 44) {
      if (!Object.hasOwn(current, "sceneTwoOverflowYVisible")) {
        current.sceneTwoOverflowYVisible =
          DEFAULT_ROOM_SETTINGS.sceneTwoOverflowYVisible;
      }
    }
    if (finiteNumber(version, 1) < 46) {
      if (!Object.hasOwn(current, "preclickPopupDelayMs")) {
        current.preclickPopupDelayMs =
          DEFAULT_ROOM_SETTINGS.preclickPopupDelayMs;
      }
    }
    if (finiteNumber(version, 1) < 47) {
      if (!Object.hasOwn(current, "sceneTwoBarrierEnabled")) {
        current.sceneTwoBarrierEnabled = Boolean(current.windowObstacleEnabled);
      }
      current.sceneTwoBarrierHeightVh =
        DEFAULT_ROOM_SETTINGS.sceneTwoBarrierHeightVh;
      [
        [
          "sceneTwoBarrierHopActivationRadiusPercent",
          "preclickHopActivationRadiusPercent",
        ],
        [
          "sceneTwoBarrierHopMaxDistancePercent",
          "preclickHopMaxDistancePercent",
        ],
        [
          "sceneTwoBarrierHopMissProbabilityPercent",
          "preclickHopMissProbabilityPercent",
        ],
        [
          "sceneTwoBarrierHopSpeedPxPerSecond",
          "preclickHopSpeedPxPerSecond",
        ],
        ["sceneTwoBarrierHopSpeedEasing", "preclickHopSpeedEasing"],
      ].forEach(([nextKey, previousKey]) => {
        if (!Object.hasOwn(current, nextKey)) {
          current[nextKey] = Object.hasOwn(current, previousKey)
            ? current[previousKey]
            : DEFAULT_ROOM_SETTINGS[nextKey];
        }
      });
      [
        "windowObstacleEnabled",
        "windowObstacleMinHeightVh",
        "windowObstacleMaxHeightVh",
        "windowObstacleMinIntervalSeconds",
        "windowObstacleMaxIntervalSeconds",
        "windowObstacleMinWidthPx",
        "windowObstacleMaxWidthPx",
        "windowObstacleMinHeightPx",
        "windowObstacleMaxHeightPx",
      ].forEach((key) => delete current[key]);
    }
    if (finiteNumber(version, 1) < 48) {
      [
        "preclickPopupSizeMultiplier",
        "birchBackgroundEnabled",
        "birchScalePercent",
      ].forEach((key) => {
        if (!Object.hasOwn(current, key)) {
          current[key] = DEFAULT_ROOM_SETTINGS[key];
        }
      });
    }
    if (finiteNumber(version, 1) < 49) {
      const legacyCameraFollowLerp = clamp(
        finiteNumber(
          current.cameraFollowLerp,
          DEFAULT_ROOM_SETTINGS.cameraFollowUpLerp
        ),
        ROOM_SETTINGS_LIMITS.cameraFollowUpLerp[0],
        ROOM_SETTINGS_LIMITS.cameraFollowUpLerp[1]
      );
      if (!Object.hasOwn(current, "cameraFollowUpEnabled")) {
        current.cameraFollowUpEnabled =
          DEFAULT_ROOM_SETTINGS.cameraFollowUpEnabled;
      }
      if (!Object.hasOwn(current, "cameraFollowUpLerp")) {
        current.cameraFollowUpLerp = legacyCameraFollowLerp;
      }
      if (!Object.hasOwn(current, "cameraFollowDownEnabled")) {
        current.cameraFollowDownEnabled =
          DEFAULT_ROOM_SETTINGS.cameraFollowDownEnabled;
      }
      if (!Object.hasOwn(current, "cameraFollowDownLerp")) {
        current.cameraFollowDownLerp = legacyCameraFollowLerp;
      }
      current.rockAccelerationEnabled = false;
      delete current.cameraFollowLerp;
      delete current.upperZoneAutoScrollEnabled;
    }
    if (finiteNumber(version, 1) < 50) {
      ["summitTimerFontFamily", "summitTimerFontSizeRem"].forEach((key) => {
        if (!Object.hasOwn(current, key)) {
          current[key] = DEFAULT_ROOM_SETTINGS[key];
        }
      });
    }
    if (finiteNumber(version, 1) < 51) {
      [
        "sceneTwoGlassEnabled",
        "sceneTwoGlassStrips",
        "sceneTwoGlassZIndex",
        "sceneTwoGlassOpacity",
        "sceneTwoGlassBlurPx",
        "sceneTwoGlassRefractionPercent",
        "sceneTwoGlassBorderRadiusPx",
        "sceneTwoGlassBounce",
      ].forEach((key) => {
        if (!Object.hasOwn(current, key)) {
          current[key] = DEFAULT_ROOM_SETTINGS[key];
        }
      });
    }
    if (finiteNumber(version, 1) < 52) {
      if (!Object.hasOwn(current, "preclickPopupWidthViewportFraction")) {
        current.preclickPopupWidthViewportFraction = Object.hasOwn(
          current,
          "preclickPopupSizeMultiplier"
        )
          ? Math.round(
              clamp(
                (finiteNumber(
                  current.rockActivatedWidthVw,
                  DEFAULT_ROOM_SETTINGS.rockActivatedWidthVw
                ) /
                  100) *
                  finiteNumber(current.preclickPopupSizeMultiplier, 2),
                ROOM_SETTINGS_LIMITS.preclickPopupWidthViewportFraction[0],
                ROOM_SETTINGS_LIMITS.preclickPopupWidthViewportFraction[1]
              ) * 100
            ) / 100
          : DEFAULT_ROOM_SETTINGS.preclickPopupWidthViewportFraction;
      }
      delete current.preclickPopupSizeMultiplier;
      [
        "rockEchoTrailEnabled",
        "rockEchoTrailCopies",
        "rockEchoTrailIntervalMs",
        "rockEchoTrailOpacity",
        "rockEchoTrailLifetimeMs",
      ].forEach((key) => {
        if (!Object.hasOwn(current, key)) {
          current[key] = DEFAULT_ROOM_SETTINGS[key];
        }
      });
    }
    if (finiteNumber(version, 1) < 53) {
      ["preclickPopupArtworkMode", "preclickPopupArtworkId"].forEach((key) => {
        if (!Object.hasOwn(current, key)) {
          current[key] = DEFAULT_ROOM_SETTINGS[key];
        }
      });
    }
    return current;
  }

  function sceneMotionMultiplier(settings) {
    const clean = sanitizeRoomSettings(settings);
    return (
      (SCENE_MOTION_REFERENCE_SCREENS / clean.sceneHeightScreens) *
      SCENE_MOTION_COMPENSATION_BOOST
    );
  }

  function sceneTwoBarrierCanonicalY(settings, worldHeight = 2000) {
    const clean = sanitizeRoomSettings(settings);
    const totalHeightVh = Math.max(100, clean.sceneHeightScreens * 100);
    const progress = clamp(
      clean.sceneTwoBarrierHeightVh / totalHeightVh,
      0,
      1
    );
    return Math.max(0, finiteNumber(worldHeight, 2000)) * (1 - progress);
  }

  function stateAboveSceneTwoBarrier(state, settings, worldHeight = 2000) {
    if (!sanitizeRoomSettings(settings).sceneTwoBarrierEnabled) {
      return false;
    }
    return (
      finiteNumber(state?.y, worldHeight) <=
      sceneTwoBarrierCanonicalY(settings, worldHeight)
    );
  }

  function sceneTwoGlassCanonicalRects(
    settings,
    worldWidth = 1000,
    worldHeight = 2000
  ) {
    const clean = sanitizeRoomSettings(settings);
    if (!clean.sceneTwoGlassEnabled) {
      return [];
    }
    const cleanWorldWidth = Math.max(1, finiteNumber(worldWidth, 1000));
    const cleanWorldHeight = Math.max(1, finiteNumber(worldHeight, 2000));
    const totalHeightVh = Math.max(100, clean.sceneHeightScreens * 100);
    return clean.sceneTwoGlassStrips
      .filter((strip) => strip.enabled)
      .map((strip) => {
        const width = cleanWorldWidth * (strip.widthPercent / 100);
        const height = Math.max(
          1,
          cleanWorldHeight * (strip.heightVh / totalHeightVh)
        );
        const left = cleanWorldWidth * (strip.xPercent / 100);
        const centerY =
          cleanWorldHeight * (1 - strip.heightPercent / 100);
        const top = clamp(centerY - height / 2, 0, cleanWorldHeight - height);
        return {
          id: strip.id,
          left,
          right: left + width,
          top,
          bottom: top + height,
        };
      });
  }

  return Object.freeze({
    DEFAULT_SCENE_HEIGHT_SCREENS,
    SCENE_MOTION_REFERENCE_SCREENS,
    SCENE_MOTION_COMPENSATION_BOOST,
    MAX_HEIGHT_GATES,
    MAX_SCENE_TWO_GLASS_STRIPS,
    PRECLICK_PARALLAX_RADIUS_PX_PER_VW,
    ROCK_IMAGE_IDS,
    HAND_VISIBILITY_MODES,
    SUMMIT_TIMER_FONT_FAMILIES,
    GACHI_SOUND_FILENAMES,
    DEFAULT_GACHI_CLICK_SOUND_FILENAME,
    PRECLICK_POPUP_ARTWORK_MODES,
    DEFAULT_PRECLICK_POPUP_ARTWORK_ID,
    ROCK_LENS_EFFECTS,
    ROCK_LENS_ACTIVATION_MODES,
    ROCK_LENS_PRESETS,
    DEFAULT_ROCK_LENS_CONFIG,
    ROOM_SETTINGS_VERSION,
    ROOM_SETTINGS_KEYS,
    ROOM_SETTINGS_LIMITS,
    DEFAULT_ROOM_SETTINGS,
    normalizeHexColor,
    parseCubicBezier,
    sanitizeHeightGates,
    sanitizeSceneTwoGlassStrips,
    sanitizeRockLensConfig,
    migrateFoldSettings,
    migratePreclickHopSettings,
    migrateRockVisualSettings,
    migrateHandDisplaySettings,
    migrateFoldLayoutSettings,
    migrateRoomSettings,
    sanitizeRoomSettings,
    sceneMotionMultiplier,
    sceneTwoBarrierCanonicalY,
    stateAboveSceneTwoBarrier,
    sceneTwoGlassCanonicalRects,
  });
});
