import "../../shared/physics.js";
import "../../shared/room-settings.js";
import "../../shared/gachi-sounds.js";
import "../../shared/chain-sounds.js";
import drizzleAudioUrl from "../../assets/audio/Капель.mp3?url";
import groundImpactAudioUrl from "../../assets/audio/СимуляцияОргазма.mov?url";
import preclickHopAudioUrl from "../../assets/audio/Смех.mp3?url";
import preclickPopupRockImageUrl from "../../assets/rock/rock.webp?url";
import rainAudioUrl from "../../assets/audio/Дождь.mp3?url";
import rainVendorUrl from "../../assets/raindrop-fx/index.js?url";
import { rockImageUrl } from "../config/rockImages.mjs";
import { createClientId } from "../lib/clientId.mjs";
import {
  cameraFollowDirectionalScrollY,
  cameraTargetScrollY,
} from "../lib/cameraFollow.mjs";
import { createCrossfadedAudioLoop } from "../lib/crossfadedAudioLoop.mjs";
import { drizzleVolumeForY } from "../lib/drizzleVolume.mjs";
import {
  DEFAULT_GLOW_OPTIMIZATION_SETTINGS,
  resolveGlowOptimizationProfile,
  sampleGlowPoints,
  sanitizeGlowOptimizationSettings,
} from "../lib/glowOptimization.mjs";
import {
  canonicalToLocalPosition,
  localToCanonicalPosition,
  rockRelativeToViewportPosition,
  viewportToRockRelativePosition,
} from "../lib/coordinates.mjs";
import {
  getRainVisualProfile,
  MAX_RAIN_FX_OPACITY,
} from "../lib/rainProfile.mjs";
import { rainScrollProfile } from "../lib/rainScrollProfile.mjs";
import { shouldStartRainExit } from "../lib/rainState.mjs";
import {
  calculatePreclickHopTarget,
  preclickHopDurationMs,
  preclickPointerSpeed,
  preclickRadiusHopDecision,
  wrapPreclickHopCenter,
} from "../lib/preclickHop.mjs";
import { cursorCircleIntersectsRect } from "../lib/rockGrab.mjs";
import { deriveSessionStatus } from "../lib/sessionStatus.mjs";
import { formatSummitElapsedMs } from "../lib/summitTimer.mjs";
import {
  normalizeRainSettings,
  normalizeRockScaleSettings,
  normalizeThemeMode,
} from "../lib/settingsModel.mjs";
import {
  cubicBezierYForX,
  rockActivationScaleFactor,
  rockHorizontalWallCompensation,
  rockLocalXForVisualGrab,
  rockPressScaleFactor,
  rockScaleForY,
  rockWallPenetrationPixels,
} from "../lib/rockScale.mjs";
import { trailAnchorPoint } from "../lib/trailAnchor.mjs";
import {
  rockPulseProgress,
  rockPulseScaleFactor,
} from "../lib/rockPulse.mjs";
import {
  canonicalVisualTrailPointToLocal,
  localVisualTrailPointToCanonical,
  normalizeStoredTrailPoint,
} from "../lib/trailPersistence.mjs";
import {
  DEFAULT_TRAIL_RENDER_SETTINGS,
  HARD_TRAIL_LIMIT,
  calculateTrailHistoryWindow,
  effectiveCanvasPixelRatio,
  resolveTrailRenderProfile,
  sampleTrailRuns,
} from "../lib/trailOptimization.mjs";
import {
  settings as productionSettings,
} from "../config/production-preset.mjs";
import { createSettingsController } from "./createSettingsController.js";
import { createWindowObstacleController } from "./createWindowObstacleController.js";

const ROLE_AUDIO_FADE_IN_MS = 300;
const ROLE_AUDIO_VOLUME = 1;
const AUDIO_TOGGLE_FADE_OUT_MS = 250;
const TRAIL_NETWORK_BATCH_POINTS = 16;
const TRAIL_NETWORK_FLUSH_MS = 50;
const ROCK_ACTIVATION_SCALE_DURATION_MS = 300;
const PRECLICK_HOP_EASING_CURVE = Object.freeze([0.22, 1, 0.36, 1]);
const PRECLICK_POPUP_ROCK_FALLBACK_ASPECT_RATIO = 2048 / 1692;
const PRECLICK_GACHI_CLICK_SOUND_FILENAME = "Camen.mp3";
const SECOND_UI_MS_SETTING_KEYS = new Set(["rainEnterMs", "rainExitMs"]);
const THEME_BACKGROUND_SETTING_KEYS = [
  "lightBackgroundColor",
  "lightBackgroundDeepColor",
  "lightBackgroundLowColor",
  "darkBackgroundColor",
  "darkBackgroundDeepColor",
  "darkBackgroundLowColor",
];

const chainAudioLoaders = import.meta.glob(
  "../../assets/audio/Кандалы_*.mp3",
  {
    import: "default",
    query: "?url",
  },
);
const CHAIN_AUDIO_LOADERS_BY_FILENAME = new Map(
  Object.entries(chainAudioLoaders).map(([modulePath, loader]) => [
    modulePath.split("/").at(-1),
    loader,
  ]),
);
const gachiAudioLoaders = import.meta.glob(
  "../../assets/audio/gachi/*.mp3",
  {
    import: "default",
    query: "?url",
  },
);
const GACHI_AUDIO_LOADERS_BY_FILENAME = new Map(
  Object.entries(gachiAudioLoaders).map(([modulePath, loader]) => [
    modulePath.split("/").at(-1),
    loader,
  ]),
);
const audioUrlPromises = new Map();

function loadAudioUrl(scope, loadersByFilename, filename) {
  const loader = loadersByFilename.get(filename);
  if (!loader) {
    return Promise.resolve(null);
  }
  const key = `${scope}:${filename}`;
  if (!audioUrlPromises.has(key)) {
    audioUrlPromises.set(
      key,
      Promise.resolve(loader())
        .then((url) => (typeof url === "string" ? url : null))
        .catch(() => null),
    );
  }
  return audioUrlPromises.get(key);
}

export function createSisyphusRuntime(elements = {}) {
  // При обновлении страницы всегда открываем заданную игровую позицию сами:
  // запрещаем браузеру восстанавливать прежнюю прокрутку.
  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }

  const body = document.body;
  const initialDocumentOverflowY = document.documentElement.style.overflowY;
  const world = elements.world || document.querySelector(".world");
  const topInscription =
    elements.topInscription || document.querySelector(".top-inscription");
  const summitTimerElement =
    elements.summitTimer || document.querySelector(".summit-timer");
  const summitLeaderboardElement =
    elements.summitLeaderboard || document.querySelector(".summit-leaderboard");
  const rock = elements.rock || document.querySelector(".rock");
  const rockImprint = elements.rockImprint || document.querySelector(".rock-imprint");
  const handCursor = elements.handCursor || document.querySelector(".hand-cursor");
  const settingsToggle =
    elements.settingsToggle || document.querySelector(".settings-toggle");
  const settingsLink =
    elements.settingsLink || document.querySelector(".settings-link");
  const settingsPanel =
    elements.settingsPanel || document.querySelector(".settings-panel");
  const sessionPanel =
    elements.sessionPanel || document.querySelector(".session-panel--toolbar");
  const heightGateStatus =
    elements.heightGateStatus || document.querySelector(".height-gate-status");
  const remoteCursorLayer = elements.remoteCursorLayer || document.querySelector(".remote-cursors");
  const trailCanvas = elements.trailCanvas || document.querySelector(".trail");
  const trailCtx = trailCanvas.getContext("2d");
  const trailSessionCanvas =
    elements.trailSessionCanvas || document.querySelector(".trail-session");
  const trailSessionCtx = trailSessionCanvas.getContext("2d");
  const trailGlowCanvas =
    elements.trailGlowCanvas || document.querySelector(".trail-glow");
  const trailGlowCtx = trailGlowCanvas.getContext("2d");
  const rainLayer = elements.rainLayer || document.querySelector(".weather-rain");
  const rainFxCanvas = elements.rainFxCanvas || document.querySelector(".weather-rain__canvas--fx");
  const rainFallbackCanvas = elements.rainFallbackCanvas || document.querySelector(".weather-rain__canvas--fallback");
  const sessionStatus = elements.sessionStatus || document.querySelector("[data-session-status]");
  const sessionRestartButton =
    elements.sessionRestartButton || document.querySelector(".session-restart");
  const finePointer = window.matchMedia("(pointer: fine)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const SharedPhysics = window.SisyphusPhysics;
  const SharedRoomSettings = window.SisyphusRoomSettings;
  const SharedGachiSounds = window.SisyphusGachiSounds;
  const SharedChainSounds = window.SisyphusChainSounds;
  const listenerDisposers = [];
  let disposed = false;
  const productionRuntime = import.meta.env.PROD;

  function measureDebugRender(name, startedAt) {
    if (productionRuntime || typeof performance?.measure !== "function") {
      return;
    }
    try {
      performance.measure(`sisyphus.${name}`, {
        start: startedAt,
        end: performance.now(),
      });
    } catch {
      // User Timing is diagnostic only and must never affect rendering.
    }
  }
  let reloadViewportRestorePending = true;

  function listen(target, type, listener, options) {
    if (!target || typeof target.addEventListener !== "function") {
      return;
    }
    target.addEventListener(type, listener, options);
    listenerDisposers.push(() => {
      target.removeEventListener(type, listener, options);
    });
  }

  function requestFoldSync() {
    window.dispatchEvent(new Event("sisyphus:fold-sync"));
  }

  const trail = {
    points: [],
    canonicalPoints: [],
    historyPoints: [],
    historyCanonical: [],
    sessionPoints: [],
    sessionCanonical: [],
    lastX: null,
    lastY: null,
    followX: null,
    followY: null,
    pixelRatio: 1,
    sessionPixelRatio: 1,
    glowPixelRatio: 1,
    dirty: true,
    sessionDirty: true,
    glowDirty: true,
    baseRevision: 0,
    sessionRevision: 0,
    glowRevision: 0,
    historyWindowTop: 0,
    historyWindowHeight: 0,
    historyRenderPasses: 0,
    historyStrokeBatches: 0,
    sessionRenderPasses: 0,
    sessionStrokeBatches: 0,
    renderFrameId: null,
    networkPoints: [],
    networkTimerId: null,
    glowRendered: false,
    glowAnimationFrameId: null,
    glowTimerId: null,
    glowLastRenderedAt: -Infinity,
    glowSampledPointCount: 0,
    glowRenderPasses: 0,
    adaptiveQuality: 1,
    adaptiveFrameTimeMs: 1000 / 60,
    adaptiveMeasuredAt: 0,
    skipNextRecord: false,
  };
  const summitTimer = {
    elapsedMs: 0,
    running: false,
    serverTime: 0,
    lastText: "",
  };

  const PHASES = SharedPhysics.PHASES;

  // DOM-сцена по умолчанию равна 1000vh, но UI может менять высоту комнаты.
  // Физика остаётся в каноническом мире, а скорость компенсируется отдельно.
  const FLOOR_INSET = 0;
  const MAX_FRAME_SECONDS = 0.032;
  const RAIN_VENDOR_SRC = rainVendorUrl;
  const RAIN_SCRIPT_ID = "sisyphus-raindrop-fx";
  const DEFAULT_RAIN_ENTER_EASING = "cubic-bezier(0.2, 0, 0, 1)";
  const DEFAULT_RAIN_EXIT_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
  const DEFAULT_RAIN_ENTER_MS = 1100;
  const DEFAULT_RAIN_EXIT_MS = 2000;
  const DEFAULT_RAIN_Z_INDEX = 5;
  const DEFAULT_RAIN_BACKGROUND_BLUR_STEPS = 3;
  const DEFAULT_RAIN_BLUR_PX = 14;
  const DEFAULT_RAIN_BLUR_OPACITY = 0.2;
  const DEFAULT_RAIN_BLUR_SATURATION = 1.1;
  const DEFAULT_RAIN_BLEND_MODE = "multiply";
  const DEFAULT_RAIN_BLUR_BLEND_MODE = "normal";
  const DEFAULT_THEME_TRANSITION_MS = 420;
  const DEFAULT_THEME_MODE = SharedRoomSettings.DEFAULT_ROOM_SETTINGS.themeMode;
  const DEFAULT_RETURN_SCROLL_EASING =
    SharedRoomSettings.DEFAULT_ROOM_SETTINGS.returnScrollEasing;
  const DEFAULT_RETURN_SCROLL_DURATION_SECONDS =
    SharedRoomSettings.DEFAULT_ROOM_SETTINGS.returnScrollDurationSeconds;
  const SUMMIT_IMPRINT_TOP_VIEWPORT_FRACTION = 0.5;

  const params = {
    themeMode: DEFAULT_THEME_MODE,
    lightBackgroundColor:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.lightBackgroundColor,
    lightBackgroundDeepColor:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.lightBackgroundDeepColor,
    lightBackgroundLowColor:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.lightBackgroundLowColor,
    darkBackgroundColor:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.darkBackgroundColor,
    darkBackgroundDeepColor:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.darkBackgroundDeepColor,
    darkBackgroundLowColor:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.darkBackgroundLowColor,
    returnScrollDurationSeconds: DEFAULT_RETURN_SCROLL_DURATION_SECONDS,
    returnScrollEasing: DEFAULT_RETURN_SCROLL_EASING,
    cameraFollowLerp:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.cameraFollowLerp,
    sceneTwoOverflowYVisible:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.sceneTwoOverflowYVisible,
    foldPositionPercent:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.foldPositionPercent,
    foldPanelHeightVh:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.foldPanelHeightVh,
    foldAngle:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.foldAngle,
    foldZoneSize:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.foldZoneSize,
    foldBlendEnabled:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.foldBlendEnabled,
    foldBlendCurve:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.foldBlendCurve,
    finalFallEnabled:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.finalFallEnabled,
    finalFallDelaySeconds:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.finalFallDelaySeconds,
    randomDropEnabled:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.randomDropEnabled,
    rockJumpEnabled:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rockJumpEnabled,
    rockJumpIntervalSeconds:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rockJumpIntervalSeconds,
    rockJumpAngleSpreadDegrees:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rockJumpAngleSpreadDegrees,
    rockJumpInertiaSpreadPercent:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS
        .rockJumpInertiaSpreadPercent,
    mass: SharedPhysics.DEFAULT_PHYSICS.mass,
    gravity: SharedPhysics.DEFAULT_PHYSICS.gravity,
    firstFallVelocity: SharedPhysics.DEFAULT_PHYSICS.firstFallVelocity,
    handForce: 50,
    pointerInfluence: 1,
    bounce: 0.35,
    inertia: SharedPhysics.DEFAULT_PHYSICS.inertia,
    horizontalInertia: SharedPhysics.DEFAULT_PHYSICS.horizontalInertia,
    groundFriction: 0.35,
    turbulence: 0.4,
    rockScaleEasing: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rockScaleEasing,
    rockActivatedWidthVw:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rockActivatedWidthVw,
    rockPressShrinkPercent:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rockPressShrinkPercent,
    rockWallPenetrationPercent:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rockWallPenetrationPercent,
    rockImageId: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rockImageId,
    foldRockImageId:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.foldRockImageId,
    rockPulseEnabled:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rockPulseEnabled,
    rockPulseShrinkPercent:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rockPulseShrinkPercent,
    rockPulseBpm: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rockPulseBpm,
    preclickHopGuardClickCount:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.preclickHopGuardClickCount,
    preclickHopActivationRadiusPercent:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS
        .preclickHopActivationRadiusPercent,
    preclickHopMaxDistancePercent:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.preclickHopMaxDistancePercent,
    preclickHopMissProbabilityPercent:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS
        .preclickHopMissProbabilityPercent,
    preclickHopSpeedPxPerSecond:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.preclickHopSpeedPxPerSecond,
    preclickHopSpeedEasing:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.preclickHopSpeedEasing,
    customCursorEnabled:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.customCursorEnabled,
    customCursorSizePx:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.customCursorSizePx,
    handVisibilityMode:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.handVisibilityMode,
    handImageChangeDelayMs:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.handImageChangeDelayMs,
    rockMinWidthVw: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rockMinWidthVw,
    rockMaxWidthVw: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rockMaxWidthVw,
    sceneHeightScreens:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.sceneHeightScreens,
    handWidthVw: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.handWidthVw,
    handForceDeficitEasing:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.handForceDeficitEasing,

    // Капель
    drizzleStartVolume:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.drizzleStartVolume,
    drizzleEndVolume:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.drizzleEndVolume,
    drizzleVolumeEasing:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.drizzleVolumeEasing,

    // Дождь
    rainEnabled: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rainEnabled,
    rainStrength: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rainStrength,
    rainMaxVolume: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rainMaxVolume,
    rainDropColor: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rainDropColor,
    rainHighlightColor:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rainHighlightColor,
    rainBlendMode: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rainBlendMode,
    rainBlurBlendMode: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rainBlurBlendMode,
    rainBackgroundBlurSteps:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rainBackgroundBlurSteps,
    rainBlurPx: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rainBlurPx,
    rainBlurOpacity: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rainBlurOpacity,
    rainBlurSaturation:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rainBlurSaturation,
    rainZIndex: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rainZIndex,
    rainEnterEasing: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rainEnterEasing,
    rainExitEasing: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rainExitEasing,
    rainEnterMs: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rainEnterMs,
    rainExitMs: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rainExitMs,

    // След
    trailEnabled: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.trailEnabled,
    trailReset: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.trailReset,
    lineDelay: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.lineDelay,
    trailAnchorHeightPercent:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.trailAnchorHeightPercent,
    trailMaxPoints: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.trailMaxPoints,
    trailSampleDist: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.trailSampleDist,

    // След — стиль
    blendMode: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.blendMode,
    lineColor: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.lineColor,
    lineColorTail: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.lineColorTail,
    useGradient: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.useGradient,
    lineWidth: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.lineWidth,
    lineOpacity: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.lineOpacity,
    linePassOpacity: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.linePassOpacity,
    dashStyle: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.dashStyle,
    dashLength: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.dashLength,
    dashGap: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.dashGap,
    lineCap: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.lineCap,
    lineJoin: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.lineJoin,
    glow: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.glow,
    glowColor: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.glowColor,
    ...DEFAULT_TRAIL_RENDER_SETTINGS,
    ...DEFAULT_GLOW_OPTIMIZATION_SETTINGS,
  };
  if (productionRuntime) {
    Object.assign(params, productionSettings);
  }
  if (elements.foldSettingsRef) {
    elements.foldSettingsRef.current = params;
  }
  let handForceDeficitCurve =
    SharedRoomSettings.parseCubicBezier(params.handForceDeficitEasing) ||
    SharedPhysics.DEFAULT_FORCE_DEFICIT_CURVE;

  const bounds = {
    worldWidth: 0,
    worldHeight: 0,
    rockWidth: 0,
    rockHeight: 0,
    maxX: 0,
    maxY: 0,
  };

  const motion = {
    phase: PHASES.INTRO,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    grabX: 0,
    grabY: 0,
    dragTargetX: 0,
    dragTargetY: 0,
    dragging: false,
    suspended: false,
    activePointerId: null,
    firstFallTriggered: false,
    firstFallTouchY: null,
    introFallTimerId: null,
    sceneReady: false,
    rockScale: 1,
    rockPressActive: false,
    rockPulseScaleFactor: 1,
    rockPulseAnimationId: null,
    rockPulseStartedAt: 0,
    sceneTwoSizeState: "ground",
    sceneTwoSizeCycleArmed: false,
    sceneTwoPressTimerId: null,
    wallContact: null,
    rockActivationArmed: false,
    physicsActivated: false,
    rockActivationScaleFactor: 1,
    rockActivationScaleTimerId: null,
    animationId: null,
    lastFrameAt: null,
    lastPointerX: 0,
    lastPointerY: 0,
    lastPointerAt: 0,
    pointerVx: 0,
    pointerVy: 0,
    alternateHand: false,
    handImageChangeTimerId: null,
    turbTime: 0,
    imprint: null,
    wasAtReturnPlace: false,
  };
  const preclickRockGuidance = {
    completed: false,
    pointerX: null,
    pointerY: null,
    directionX: null,
    directionY: null,
    insideRadius: false,
    outsideRadius: false,
    hopCount: 0,
    radiusHopCount: 0,
    forcedRadiusMissConsumed: false,
    lastRadiusDecision: null,
    guardClicksUsed: 0,
    hopAnimationId: null,
    hopSampleAtMs: null,
    hopSampleX: null,
    hopSampleY: null,
    hopSpeedPxPerSecond: 0,
  };
  const preclickHopAudio = {
    elements: new Set(),
    lastFilename: null,
    playCount: 0,
    stopCount: 0,
  };
  const preclickPopupRockImage = typeof Image === "function" ? new Image() : null;
  if (preclickPopupRockImage) {
    preclickPopupRockImage.decoding = "async";
    preclickPopupRockImage.src = preclickPopupRockImageUrl;
  }
  body.classList.toggle(
    "hand-always-visible",
    params.handVisibilityMode === "always",
  );
  body.classList.toggle(
    "hand-hidden",
    params.handVisibilityMode === "hidden",
  );
  applyCustomCursorSettings();
  resetPreclickRockGuidance();
  const finalFallGate = {
    enteredAt: null,
    ready: false,
  };

  const SHARED_PHYSICS_KEYS = [
    "mass",
    "gravity",
    "firstFallVelocity",
    "handForce",
    "pointerInfluence",
    "bounce",
    "wallBounce",
    "inertia",
    "horizontalInertia",
    "groundFriction",
    "turbulence",
  ];
  const SHARED_ROOM_SETTING_KEYS = SharedRoomSettings.ROOM_SETTINGS_KEYS;
  const RAIN_SETTING_KEYS = SHARED_ROOM_SETTING_KEYS.filter((key) =>
    key.startsWith("rain"),
  );
  const TRAIL_BASE_RENDER_SETTING_KEYS = [
    "trailEnabled",
    "trailMaxPoints",
    "lineColor",
    "lineColorTail",
    "useGradient",
    "linePassOpacity",
    "dashStyle",
    "dashLength",
    "dashGap",
    "lineCap",
    "lineJoin",
    "lineWidth",
    "trailRenderProfile",
  ];
  const TRAIL_GLOW_RENDER_SETTING_KEYS = [
    "trailEnabled",
    "linePassOpacity",
    "dashStyle",
    "dashLength",
    "dashGap",
    "lineCap",
    "lineJoin",
    "lineWidth",
    "glow",
    "glowColor",
    ...Object.keys(DEFAULT_GLOW_OPTIMIZATION_SETTINGS),
  ];
  const NUMERIC_ROOM_SETTING_KEYS = new Set(
    SHARED_ROOM_SETTING_KEYS.filter(
      (key) => typeof SharedRoomSettings.DEFAULT_ROOM_SETTINGS[key] === "number",
    ),
  );
  const BOOLEAN_ROOM_SETTING_KEYS = new Set(
    SHARED_ROOM_SETTING_KEYS.filter(
      (key) => typeof SharedRoomSettings.DEFAULT_ROOM_SETTINGS[key] === "boolean",
    ),
  );
  const RECONNECT_DELAYS = [500, 1000, 2000, 5000];
  const SNAPSHOT_DELAY_MS = 90;
  const POINTER_SEND_INTERVAL_MS = 1000 / 30;
  const POINTER_VELOCITY_MAX_AGE_MS = 150;
  const RELEASE_HANDOFF_MS = 150;
  const RELEASE_HANDOFF_MAX_STEP_PX = 150;

  function getClientId() {
    try {
      const stored = sessionStorage.getItem("sisyphus-client-id");
      if (stored) {
        return stored;
      }
      const created = createClientId();
      sessionStorage.setItem("sisyphus-client-id", created);
      return created;
    } catch {
      return createClientId();
    }
  }

  function removeLegacySessionParam() {
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has("session")) {
        return;
      }
      url.searchParams.delete("session");
      window.history.replaceState(
        null,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    } catch {
      // Старые shared-ссылки не должны ломать запуск, даже если History API недоступен.
    }
  }

  removeLegacySessionParam();

  const collab = {
    enabled: false,
    sessionId: "",
    clientId: getClientId(),
    leaveToken: null,
    leaving: false,
    socket: null,
    connected: false,
    expired: false,
    sequence: 0,
    reconnectAttempt: 0,
    reconnectTimerId: null,
    pingTimerId: null,
    statusResetTimerId: null,
    renderId: null,
    snapshots: [],
    lastRevision: -1,
    clockOffset: 0,
    clockOffsetReady: false,
    hasControl: false,
    pendingControl: false,
    releasePending: false,
    lastControlSlip: null,
    clientRole: "master",
    holderId: null,
    remoteControllerId: null,
    participants: 1,
    applyingRemotePhysics: false,
    physicsSignature: "",
    pendingPhysicsChanges: Object.create(null),
    stagedPhysicsChangeKeys: new Set(),
    applyingRemoteRoomSettings: false,
    roomSettingsSignature: "",
    pendingRoomSettingsChanges: Object.create(null),
    stagedRoomSettingsChangeKeys: new Set(),
    settingsRevision: 0,
    settingsUpdateTimerId: null,
    settingsUpdateInFlight: null,
    settingsUpdateQueued: false,
    sessionCreateInFlight: false,
    sessionCreateAbortController: null,
    restoringStoredSession: false,
    lastRoomSettingsSnapshotHeight: null,
    trailCursor: 0,
    trailWriterId: null,
    firstFallRequestSent: false,
    lastMoveSentAt: 0,
    lastPointerSentAt: 0,
    lastRenderAt: 0,
    imprint: null,
    groundTouchSeq: null,
    heightGateState: {
      passedGateIds: new Set(),
      activeGate: null,
    },
    heightGateDeadlineAt: 0,
    heightGateTickerId: null,
    releaseHandoff: {
      active: false,
      fromX: 0,
      fromY: 0,
      startedAt: 0,
    },
    localPointer: {
      x: SharedPhysics.WORLD_WIDTH / 2,
      y: 0,
      rockOffsetX: 0,
      rockOffsetY: 0,
      mode: "grab",
      visible: false,
    },
    remotePointers: new Map(),
  };
  collab.enabled = window.location.protocol !== "file:";
  body.dataset.clientRole = "master";

  function currentSummitElapsedMs() {
    if (!summitTimer.running) {
      return summitTimer.elapsedMs;
    }
    const estimatedServerTime = Date.now() - collab.clockOffset;
    return Math.min(
      Number.MAX_SAFE_INTEGER,
      summitTimer.elapsedMs +
        Math.max(0, estimatedServerTime - summitTimer.serverTime),
    );
  }

  function renderSummitTimer() {
    if (!summitTimerElement) {
      return;
    }
    const text = formatSummitElapsedMs(currentSummitElapsedMs());
    if (text !== summitTimer.lastText) {
      summitTimerElement.textContent = text;
      summitTimer.lastText = text;
    }
  }

  function renderSummitLeaderboard(payload = {}) {
    if (!summitLeaderboardElement) {
      return;
    }
    const current = payload.current && typeof payload.current === "object"
      ? payload.current
      : null;
    const currentId = typeof current?.id === "string" ? current.id : null;
    const top = Array.isArray(payload.top) ? payload.top.slice(0, 9) : [];
    const currentInTop = currentId && top.some((entry) => entry?.id === currentId);
    const entries = [...top, ...(current && !currentInTop ? [current] : [])];
    const fragment = document.createDocumentFragment();
    entries.forEach((entry) => {
      if (!entry || typeof entry.name !== "string") {
        return;
      }
      const row = document.createElement("li");
      row.className = "summit-leaderboard__row";
      if (entry.id === currentId) {
        row.classList.add("is-current");
        row.setAttribute("aria-current", "true");
      }
      const rank = document.createElement("span");
      rank.className = "summit-leaderboard__rank";
      rank.textContent = Number.isSafeInteger(entry.rank) ? `#${entry.rank}` : "—";
      const name = document.createElement("span");
      name.className = "summit-leaderboard__name";
      name.textContent = entry.name;
      const score = document.createElement("time");
      score.className = "summit-leaderboard__score";
      score.textContent = formatSummitElapsedMs(entry.scoreMs);
      row.append(rank, name, score);
      fragment.append(row);
    });
    summitLeaderboardElement.replaceChildren(fragment);
    requestFoldSync();
  }

  function applySummitTimerSnapshot(payload) {
    const wasRunning = summitTimer.running;
    summitTimer.elapsedMs = Math.min(
      Number.MAX_SAFE_INTEGER,
      Math.max(0, Number(payload.summitElapsedMs) || 0),
    );
    summitTimer.running = Boolean(payload.summitTimerRunning);
    summitTimer.serverTime = Number(payload.serverTime) || Date.now();
    if (summitTimerElement) {
      summitTimerElement.dataset.running = String(summitTimer.running);
    }
    renderSummitTimer();
    if (wasRunning && !summitTimer.running && payload.dragging === false) {
      armSummitRainScroll();
    }
  }

  function currentViewport() {
    return {
      width: Math.max(
        1,
        Math.round(window.innerWidth || document.documentElement.clientWidth || 1),
      ),
      height: Math.max(
        1,
        Math.round(window.innerHeight || document.documentElement.clientHeight || 1),
      ),
    };
  }

  function localCanEditSettings() {
    return true;
  }

  function stageControlChange(key, value) {
    if (
      !collab.enabled ||
      !localCanEditSettings() ||
      collab.applyingRemotePhysics ||
      collab.applyingRemoteRoomSettings
    ) {
      return;
    }
    if (SHARED_PHYSICS_KEYS.includes(key)) {
      collab.pendingPhysicsChanges[key] = value;
      collab.stagedPhysicsChangeKeys.add(key);
    }
    if (SHARED_ROOM_SETTING_KEYS.includes(key)) {
      collab.pendingRoomSettingsChanges[key] = value;
      collab.stagedRoomSettingsChangeKeys.add(key);
    }
  }

  function scaledVisualPixel(value) {
    return Number(value);
  }

  const rain = {
    active: false,
    fallback: null,
    lastProfile: null,
    hideTimerId: null,
    rainFx: null,
    renderToken: 0,
    returnRequested: false,
    resizeHandler: null,
    scrollArmed: false,
    scrollCompleted: false,
    scrollStarted: false,
    scrollUnlocked: false,
    lastScrollY: 0,
    touchY: null,
    userIntentUntil: 0,
  };

  const chainHoverAudio = {
    elements: [],
    filenames: SharedChainSounds.CHAIN_SOUND_FILENAMES.filter((filename) =>
      CHAIN_AUDIO_LOADERS_BY_FILENAME.has(filename),
    ),
    lastPlayedIndex: -1,
  };
  const sessionRoleAudio = {
    elements: new Map(),
    latest: null,
    seenEventIds: new Set(),
    timerIds: new Set(),
  };
  const roleAudioFade = {
    entries: new Map(),
    latest: null,
  };
  const gachiClickAudio = {
    elements: new Set(),
    lastFilename: null,
    playCount: 0,
    playToken: 0,
    stopCount: 0,
  };
  const groundImpactAudio = {
    armed: false,
    elements: new Set(),
    lastFilename: null,
    playCount: 0,
  };
  const wallImpactAudio = {
    elements: new Set(),
    lastFilename: null,
    playCount: 0,
  };
  const drizzleLoopController = createCrossfadedAudioLoop({
    src: drizzleAudioUrl,
  });
  const drizzleLoopAudio = {
    fadeDurationMs: 0,
    fadeFrameId: null,
    fadeTargetVolume: 0,
    fadeToken: 0,
    playing: false,
    requestToken: 0,
    volume: 0,
  };
  const rainLoopController = createCrossfadedAudioLoop({
    src: rainAudioUrl,
  });
  const rainLoopAudio = {
    fadeDurationMs: 0,
    fadeFrameId: null,
    fadeMode: null,
    fadeTargetVolume: 0,
    fadeToken: 0,
    playing: false,
    volume: 0,
  };

  let rainFxScriptPromise = null;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function secondsOutput(seconds) {
    const value = Number(seconds);
    return `${Number.isFinite(value) ? value.toFixed(1) : "0.0"} s`;
  }

  function settingValueToControlValue(key, value) {
    if (key === "heightGates") {
      return JSON.stringify(SharedRoomSettings.sanitizeHeightGates(value));
    }
    if (SECOND_UI_MS_SETTING_KEYS.has(key)) {
      const seconds = Number(value) / 1000;
      return Number.isFinite(seconds) ? String(seconds) : "0";
    }
    return String(value);
  }

  function controlValueToSettingValue(input, key) {
    if (!input) {
      return undefined;
    }
    if (input.type === "checkbox") {
      return Boolean(input.checked);
    }
    if (key === "heightGates") {
      try {
        return SharedRoomSettings.sanitizeHeightGates(
          JSON.parse(input.value || "[]"),
        );
      } catch {
        return [];
      }
    }
    if (SECOND_UI_MS_SETTING_KEYS.has(key)) {
      const seconds = Number(input.value);
      return Number.isFinite(seconds)
        ? Math.round(seconds * 1000)
        : input.value;
    }
    return input.value;
  }

  const settingsController = createSettingsController({
    SharedPhysics,
    SharedRoomSettings,
    clamp,
    collab,
    controlValueToSettingValue,
    hintEl: elements.hint,
    listen,
    localCanEditSettings,
    onDeleteSettingsTemplate: deleteSettingsTemplate,
    onImportSettingsTemplates: importSettingsTemplates,
    onListSettingsTemplates: listSettingsTemplates,
    onSaveSettingsTemplate: saveSettingsTemplate,
    onSelectProductionPreset: selectProductionPreset,
    params,
    readControls,
    resetTrail,
    secondsOutput,
    settingValueToControlValue,
    settingsPanel: elements.settingsPanel,
    stageControlChange,
  });
  const preclickPopupController = createWindowObstacleController();
  const settingsUiEnabled = settingsController.enabled;

  function fitTopInscription() {
    if (!topInscription) {
      return;
    }
    topInscription.style.fontSize = "";
    const maximumFontSize = Number.parseFloat(
      window.getComputedStyle(topInscription).fontSize,
    );
    const availableWidth = Math.max(0, topInscription.clientWidth - 2);
    const range = document.createRange();
    range.selectNodeContents(topInscription);
    const textWidth = range.getBoundingClientRect().width;
    range.detach();
    if (
      Number.isFinite(maximumFontSize) &&
      availableWidth > 0 &&
      textWidth > availableWidth
    ) {
      topInscription.style.fontSize = `${
        (maximumFontSize * availableWidth) / textWidth
      }px`;
    }
  }

  function cancelRoleAudioFade(audio) {
    const state = roleAudioFade.entries.get(audio);
    if (!state) {
      return;
    }
    if (state.frameId !== null) {
      window.cancelAnimationFrame(state.frameId);
      state.frameId = null;
    }
    roleAudioFade.entries.delete(audio);
  }

  function finishRoleAudioStop(audio, state) {
    if (roleAudioFade.entries.get(audio) === state) {
      roleAudioFade.entries.delete(audio);
    }
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {
      // Media element может стать недоступен во время закрытия страницы.
    }
    audio.volume = 0;
  }

  function fadeOutRoleAudio(audio, role, immediate = false) {
    cancelRoleAudioFade(audio);
    const startVolume = clamp(Number(audio.volume) || 0, 0, ROLE_AUDIO_VOLUME);
    const state = {
      audio,
      durationMs: immediate ? 0 : AUDIO_TOGGLE_FADE_OUT_MS,
      frameId: null,
      role,
      targetVolume: 0,
    };
    roleAudioFade.entries.set(audio, state);
    roleAudioFade.latest = state;
    if (immediate || startVolume <= 0.001) {
      finishRoleAudioStop(audio, state);
      return;
    }

    const startedAt = performance.now();
    const step = (now) => {
      if (roleAudioFade.entries.get(audio) !== state) {
        return;
      }
      const progress = clamp(
        (now - startedAt) / AUDIO_TOGGLE_FADE_OUT_MS,
        0,
        1,
      );
      audio.volume = startVolume * (1 - progress);
      if (progress < 1) {
        state.frameId = window.requestAnimationFrame(step);
        return;
      }
      state.frameId = null;
      finishRoleAudioStop(audio, state);
    };
    state.frameId = window.requestAnimationFrame(step);
  }

  function stopHandInteractionSounds({ immediate = false } = {}) {
    sessionRoleAudio.timerIds.forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    sessionRoleAudio.timerIds.clear();
    const elements = new Set([
      ...chainHoverAudio.elements.filter(Boolean),
      ...sessionRoleAudio.elements.values(),
    ]);
    elements.forEach((audio) => {
      fadeOutRoleAudio(audio, "master", immediate);
    });
  }

  function fadeInRoleAudio(audio, role) {
    cancelRoleAudioFade(audio);
    const state = {
      audio,
      durationMs: ROLE_AUDIO_FADE_IN_MS,
      frameId: null,
      role,
      targetVolume: ROLE_AUDIO_VOLUME,
    };
    const startedAt = performance.now();
    const step = (now) => {
      if (roleAudioFade.entries.get(audio) !== state) {
        return;
      }
      const progress = clamp(
        (now - startedAt) / ROLE_AUDIO_FADE_IN_MS,
        0,
        1,
      );
      audio.volume = ROLE_AUDIO_VOLUME * progress;
      if (progress < 1) {
        state.frameId = window.requestAnimationFrame(step);
        return;
      }
      state.frameId = null;
    };

    audio.volume = 0;
    roleAudioFade.entries.set(audio, state);
    roleAudioFade.latest = state;
    state.frameId = window.requestAnimationFrame(step);
  }

  function playRoleAudio(audio, role) {
    if (!params.handAudioEnabled) {
      return;
    }
    cancelRoleAudioFade(audio);
    try {
      audio.currentTime = 0;
      audio.volume = 0;
      const promise = audio.play();
      fadeInRoleAudio(audio, role);
      if (promise && typeof promise.catch === "function") {
        promise.catch(() => {
          cancelRoleAudioFade(audio);
          audio.volume = 0;
        });
      }
    } catch {
      audio.volume = 0;
    }
  }

  function chooseChainHoverAudioIndex() {
    const count = chainHoverAudio.filenames.length;
    if (count === 0) {
      return -1;
    }
    if (count === 1 || chainHoverAudio.lastPlayedIndex < 0) {
      return Math.floor(Math.random() * count);
    }
    const offset = 1 + Math.floor(Math.random() * (count - 1));
    return (chainHoverAudio.lastPlayedIndex + offset) % count;
  }

  function playChainHoverSound() {
    if (
      !params.handAudioEnabled ||
      typeof Audio !== "function" ||
      motion.phase !== PHASES.PLAY ||
      motion.dragging
    ) {
      return;
    }

    const index = chooseChainHoverAudioIndex();
    if (index < 0) {
      return;
    }

    chainHoverAudio.lastPlayedIndex = index;
    const filename = chainHoverAudio.filenames[index];
    loadAudioUrl("chain", CHAIN_AUDIO_LOADERS_BY_FILENAME, filename).then(
      (url) => {
        if (
          disposed ||
          !params.handAudioEnabled ||
          !url ||
          motion.phase !== PHASES.PLAY ||
          motion.dragging
        ) {
          return;
        }
        let audio = chainHoverAudio.elements[index];
        if (!audio) {
          audio = new Audio(url);
          audio.preload = "auto";
          chainHoverAudio.elements[index] = audio;
        }
        playRoleAudio(audio, "master");
      },
    );
  }

  function sessionRoleAudioAvailable(role, filename) {
    return (
      role === "master" &&
      SharedChainSounds.isChainSoundFilename(filename) &&
      CHAIN_AUDIO_LOADERS_BY_FILENAME.has(filename)
    );
  }

  function loadSessionRoleAudioUrl(role, filename) {
    if (role === "master" && SharedChainSounds.isChainSoundFilename(filename)) {
      return loadAudioUrl("chain", CHAIN_AUDIO_LOADERS_BY_FILENAME, filename);
    }
    return Promise.resolve(null);
  }

  function ensureSessionRoleAudio(role, filename) {
    if (typeof Audio !== "function") {
      return Promise.resolve(null);
    }
    const key = `${role}:${filename}`;
    const existing = sessionRoleAudio.elements.get(key);
    if (existing) {
      return Promise.resolve(existing);
    }
    return loadSessionRoleAudioUrl(role, filename).then((url) => {
      if (!url) {
        return null;
      }
      const audio = new Audio(url);
      audio.preload = "auto";
      sessionRoleAudio.elements.set(key, audio);
      return audio;
    });
  }

  function playSessionRoleAudio(payload) {
    if (!params.handAudioEnabled || typeof Audio !== "function") {
      return;
    }
    if (!sessionRoleAudioAvailable(payload.role, payload.filename)) {
      return;
    }
    ensureSessionRoleAudio(payload.role, payload.filename).then((audio) => {
      if (disposed || !params.handAudioEnabled || !audio) {
        return;
      }
      sessionRoleAudio.latest = {
        ...payload,
        playedAt: Date.now(),
        scheduled: false,
      };
      playRoleAudio(audio, payload.role);
    });
  }

  function receiveSessionRoleAudio(payload) {
    if (!params.handAudioEnabled) {
      return false;
    }
    const eventId =
      typeof payload.eventId === "string" ? payload.eventId : "";
    const role = payload.role === "master" ? "master" : null;
    const filename =
      typeof payload.filename === "string" ? payload.filename : "";
    const playAt = Number(payload.playAt);
    if (
      !/^[A-Za-z0-9_-]{16,64}$/.test(eventId) ||
      !sessionRoleAudioAvailable(role, filename) ||
      !Number.isFinite(playAt) ||
      sessionRoleAudio.seenEventIds.has(eventId)
    ) {
      return false;
    }

    sessionRoleAudio.seenEventIds.add(eventId);
    if (sessionRoleAudio.seenEventIds.size > 256) {
      sessionRoleAudio.seenEventIds.delete(
        sessionRoleAudio.seenEventIds.values().next().value,
      );
    }
    const normalized = {
      eventId,
      actorId: typeof payload.actorId === "string" ? payload.actorId : null,
      role,
      filename,
      playAt,
    };
    const localPlayAt =
      playAt + (collab.clockOffsetReady ? collab.clockOffset : 0);
    const delayMs = Math.max(0, localPlayAt - Date.now());
    sessionRoleAudio.latest = {
      ...normalized,
      delayMs,
      playedAt: null,
      scheduled: true,
    };
    const play = () => {
      playSessionRoleAudio(normalized);
    };
    if (delayMs <= 0) {
      play();
      return true;
    }
    const timerId = window.setTimeout(() => {
      sessionRoleAudio.timerIds.delete(timerId);
      play();
    }, delayMs);
    sessionRoleAudio.timerIds.add(timerId);
    return true;
  }

  function playRockPointerDownSound() {
    if (!params.handAudioEnabled) {
      return;
    }
    if (collab.enabled && collab.connected) {
      sendShared("audio.play");
      return;
    }
    const role = "master";
    const filename =
      SharedChainSounds.CHAIN_SOUND_FILENAMES[
        Math.floor(
          Math.random() * SharedChainSounds.CHAIN_SOUND_FILENAMES.length,
        )
      ];
    playSessionRoleAudio({
      eventId: `local-${Date.now()}`,
      actorId: collab.clientId,
      role,
      filename,
      playAt: Date.now(),
    });
  }

  function availableGachiClickSounds() {
    return SharedGachiSounds.GACHI_SOUND_FILENAMES.filter((filename) =>
      GACHI_AUDIO_LOADERS_BY_FILENAME.has(filename),
    );
  }

  function pauseAndResetAudio(audio) {
    if (!audio) {
      return;
    }
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {
      // Media element может стать недоступен во время закрытия страницы.
    }
  }

  function stopGachiClickSound() {
    gachiClickAudio.playToken += 1;
    if (gachiClickAudio.elements.size > 0) {
      gachiClickAudio.stopCount += 1;
    }
    gachiClickAudio.elements.forEach(pauseAndResetAudio);
    gachiClickAudio.elements.clear();
  }

  function stopPreclickHopSounds() {
    if (preclickHopAudio.elements.size > 0) {
      preclickHopAudio.stopCount += 1;
    }
    preclickHopAudio.elements.forEach(pauseAndResetAudio);
    preclickHopAudio.elements.clear();
  }

  function playPreclickHopSound() {
    if (typeof Audio !== "function") {
      return;
    }
    const audio = new Audio(preclickHopAudioUrl);
    audio.preload = "auto";
    const releaseAudio = () => {
      preclickHopAudio.elements.delete(audio);
    };
    audio.addEventListener("ended", releaseAudio);
    audio.addEventListener("error", releaseAudio);
    preclickHopAudio.elements.add(audio);
    try {
      audio.currentTime = 0;
      audio.volume = 1;
      const promise = audio.play();
      if (promise && typeof promise.catch === "function") {
        promise.catch(releaseAudio);
      }
      preclickHopAudio.lastFilename = "Смех.mp3";
      preclickHopAudio.playCount += 1;
    } catch {
      releaseAudio();
    }
  }

  function playGachiClickSound(
    requestedFilename = params.gachiClickSoundFilename,
  ) {
    if (typeof Audio !== "function") {
      return;
    }
    const filenames = availableGachiClickSounds();
    if (filenames.length === 0) {
      return;
    }
    const playToken = gachiClickAudio.playToken;
    const requested = String(requestedFilename || "");
    const defaultFilename =
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.gachiClickSoundFilename;
    const filename = filenames.includes(requested)
      ? requested
      : filenames.includes(defaultFilename)
        ? defaultFilename
        : filenames[0];
    loadAudioUrl("gachi", GACHI_AUDIO_LOADERS_BY_FILENAME, filename).then(
      (url) => {
        if (disposed || playToken !== gachiClickAudio.playToken || !url) {
          return;
        }
        const audio = new Audio(url);
        audio.preload = "auto";
        const releaseAudio = () => {
          gachiClickAudio.elements.delete(audio);
        };
        audio.addEventListener("ended", releaseAudio);
        audio.addEventListener("error", releaseAudio);
        gachiClickAudio.elements.add(audio);
        try {
          audio.currentTime = 0;
          audio.volume = 1;
          const promise = audio.play();
          if (promise && typeof promise.catch === "function") {
            promise.catch(releaseAudio);
          }
          gachiClickAudio.lastFilename = filename;
          gachiClickAudio.playCount += 1;
        } catch {
          releaseAudio();
        }
      },
    );
  }

  function playGroundImpactSound() {
    if (typeof Audio !== "function") {
      return;
    }
    const audio = new Audio(groundImpactAudioUrl);
    audio.preload = "auto";
    const releaseAudio = () => {
      groundImpactAudio.elements.delete(audio);
    };
    audio.addEventListener("ended", releaseAudio);
    audio.addEventListener("error", releaseAudio);
    groundImpactAudio.elements.add(audio);
    try {
      audio.currentTime = 0;
      audio.volume = 1;
      const promise = audio.play();
      if (promise && typeof promise.catch === "function") {
        promise.catch(releaseAudio);
      }
      groundImpactAudio.lastFilename = "СимуляцияОргазма.mov";
      groundImpactAudio.playCount += 1;
    } catch {
      releaseAudio();
      // Ошибка отдельного звука не должна останавливать физический цикл.
    }
  }

  function playWallImpactSound() {
    if (typeof Audio !== "function") {
      return;
    }
    const audio = new Audio(groundImpactAudioUrl);
    audio.preload = "auto";
    const releaseAudio = () => {
      wallImpactAudio.elements.delete(audio);
    };
    audio.addEventListener("ended", releaseAudio);
    audio.addEventListener("error", releaseAudio);
    wallImpactAudio.elements.add(audio);
    try {
      audio.currentTime = 0;
      audio.volume = 1;
      const promise = audio.play();
      if (promise && typeof promise.catch === "function") {
        promise.catch(releaseAudio);
      }
      wallImpactAudio.lastFilename = "СимуляцияОргазма.mov";
      wallImpactAudio.playCount += 1;
    } catch {
      releaseAudio();
    }
  }

  function armGroundImpactSound() {
    groundImpactAudio.armed = true;
  }

  function playArmedGroundImpactSound() {
    if (!groundImpactAudio.armed) {
      return false;
    }
    groundImpactAudio.armed = false;
    playGroundImpactSound();
    return true;
  }

  function setDrizzleLoopVolume(value) {
    const volume = clamp(Number(value) || 0, 0, 1);
    drizzleLoopAudio.volume = volume;
    drizzleLoopController.setVolume(volume);
  }

  function cancelDrizzleLoopFade() {
    drizzleLoopAudio.fadeToken += 1;
    if (drizzleLoopAudio.fadeFrameId !== null) {
      window.cancelAnimationFrame(drizzleLoopAudio.fadeFrameId);
      drizzleLoopAudio.fadeFrameId = null;
    }
    drizzleLoopAudio.fadeDurationMs = 0;
  }

  function finishDrizzleLoopSound() {
    drizzleLoopAudio.requestToken += 1;
    drizzleLoopController.stop();
    setDrizzleLoopVolume(0);
    drizzleLoopAudio.fadeTargetVolume = 0;
    drizzleLoopAudio.playing = false;
  }

  function fadeDrizzleLoopVolume(targetVolume, durationMs, onDone = () => {}) {
    cancelDrizzleLoopFade();
    const token = drizzleLoopAudio.fadeToken;
    const startVolume = drizzleLoopAudio.volume;
    const endVolume = clamp(Number(targetVolume) || 0, 0, 1);
    const duration = Math.max(0, Math.round(Number(durationMs) || 0));
    drizzleLoopAudio.fadeDurationMs = duration;
    drizzleLoopAudio.fadeTargetVolume = endVolume;
    if (duration <= 0 || Math.abs(startVolume - endVolume) < 0.001) {
      setDrizzleLoopVolume(endVolume);
      drizzleLoopAudio.fadeDurationMs = 0;
      onDone();
      return;
    }

    const startedAt = performance.now();
    const step = (now) => {
      if (token !== drizzleLoopAudio.fadeToken) {
        return;
      }
      const progress = clamp((now - startedAt) / duration, 0, 1);
      setDrizzleLoopVolume(
        startVolume + (endVolume - startVolume) * progress,
      );
      if (progress < 1) {
        drizzleLoopAudio.fadeFrameId = window.requestAnimationFrame(step);
        return;
      }
      drizzleLoopAudio.fadeFrameId = null;
      drizzleLoopAudio.fadeDurationMs = 0;
      onDone();
    };
    drizzleLoopAudio.fadeFrameId = window.requestAnimationFrame(step);
  }

  function syncDrizzleLoopVolume() {
    if (!params.drizzleEnabled) {
      return drizzleLoopAudio.volume;
    }
    const volume = drizzleVolumeForY(motion.y, bounds.maxY, {
      startVolume: params.drizzleStartVolume,
      endVolume: params.drizzleEndVolume,
      easing: params.drizzleVolumeEasing,
    });
    setDrizzleLoopVolume(volume);
    return volume;
  }

  function playDrizzleLoopSound() {
    if (!params.drizzleEnabled) {
      return;
    }
    if (drizzleLoopAudio.playing) {
      cancelDrizzleLoopFade();
      syncDrizzleLoopVolume();
      return;
    }
    cancelDrizzleLoopFade();
    drizzleLoopAudio.playing = true;
    syncDrizzleLoopVolume();
    const requestToken = ++drizzleLoopAudio.requestToken;
    const promise = drizzleLoopController.start();
    if (promise && typeof promise.then === "function") {
      promise
        .then((started) => {
          if (
            requestToken === drizzleLoopAudio.requestToken &&
            !started &&
            !disposed
          ) {
            drizzleLoopAudio.playing = false;
          }
        })
        .catch(() => {
          if (requestToken === drizzleLoopAudio.requestToken) {
            drizzleLoopAudio.playing = false;
          }
        });
    }
  }

  function stopDrizzleLoopSound({ immediate = false } = {}) {
    drizzleLoopAudio.requestToken += 1;
    if (!drizzleLoopAudio.playing) {
      cancelDrizzleLoopFade();
      finishDrizzleLoopSound();
      return;
    }
    if (immediate) {
      cancelDrizzleLoopFade();
      finishDrizzleLoopSound();
      return;
    }
    fadeDrizzleLoopVolume(
      0,
      AUDIO_TOGGLE_FADE_OUT_MS,
      finishDrizzleLoopSound,
    );
  }

  function setRainLoopVolume(value) {
    const nextVolume = clamp(Number(value) || 0, 0, 3);
    rainLoopAudio.volume = nextVolume;
    rainLoopController.setVolume(nextVolume);
  }

  function cancelRainLoopFade() {
    rainLoopAudio.fadeToken += 1;
    if (rainLoopAudio.fadeFrameId !== null) {
      window.cancelAnimationFrame(rainLoopAudio.fadeFrameId);
      rainLoopAudio.fadeFrameId = null;
    }
    rainLoopAudio.fadeDurationMs = 0;
    rainLoopAudio.fadeMode = null;
  }

  function fadeRainLoopVolume(targetVolume, durationMs, options = {}) {
    const onDone =
      typeof options.onDone === "function" ? options.onDone : () => {};
    cancelRainLoopFade();
    const token = rainLoopAudio.fadeToken;
    const startVolume = clamp(rainLoopAudio.volume, 0, 3);
    const endVolume = clamp(Number(targetVolume) || 0, 0, 3);
    const duration = Math.max(0, Math.round(Number(durationMs) || 0));
    rainLoopAudio.fadeDurationMs = duration;
    rainLoopAudio.fadeMode = options.mode || "volume";
    rainLoopAudio.fadeTargetVolume = endVolume;

    if (duration <= 0 || Math.abs(startVolume - endVolume) < 0.001) {
      setRainLoopVolume(endVolume);
      rainLoopAudio.fadeDurationMs = 0;
      rainLoopAudio.fadeMode = null;
      onDone();
      return;
    }

    const startAt = performance.now();
    const step = (now) => {
      if (token !== rainLoopAudio.fadeToken) {
        return;
      }
      const progress = clamp((now - startAt) / duration, 0, 1);
      setRainLoopVolume(
        startVolume + (endVolume - startVolume) * progress
      );
      if (progress < 1) {
        rainLoopAudio.fadeFrameId = window.requestAnimationFrame(step);
        return;
      }
      rainLoopAudio.fadeFrameId = null;
      rainLoopAudio.fadeDurationMs = 0;
      rainLoopAudio.fadeMode = null;
      onDone();
    };

    rainLoopAudio.fadeFrameId = window.requestAnimationFrame(step);
  }

  function finishRainLoopSound() {
    rainLoopController.stop();
    setRainLoopVolume(0);
    rainLoopAudio.fadeMode = null;
    rainLoopAudio.fadeTargetVolume = 0;
    rainLoopAudio.playing = false;
  }

  function playRainLoopSound() {
    const wasStopped = !rainLoopAudio.playing;
    if (wasStopped) {
      setRainLoopVolume(0);
    }
    rainLoopAudio.playing = true;
    const promise = rainLoopController.start();
    if (promise && typeof promise.catch === "function") {
      promise.then((started) => {
        if (started || !rainLoopAudio.playing) {
          return;
        }
        cancelRainLoopFade();
        setRainLoopVolume(0);
        rainLoopAudio.playing = false;
      }).catch(() => {
        cancelRainLoopFade();
        setRainLoopVolume(0);
        rainLoopAudio.playing = false;
      });
    }
    fadeRainLoopVolume(params.rainMaxVolume, params.rainEnterMs, {
      mode: "enter",
    });
  }

  function stopRainLoopSound({ immediate = false } = {}) {
    if (!rainLoopAudio.playing) {
      rainLoopAudio.playing = false;
      return;
    }

    if (immediate) {
      cancelRainLoopFade();
      finishRainLoopSound();
      return;
    }

    fadeRainLoopVolume(0, params.rainExitMs, {
      mode: "exit",
      onDone: finishRainLoopSound,
    });
  }

  function syncRainLoopFadeTiming(changedKeys) {
    if (!rainLoopAudio.playing) {
      return;
    }
    if (
      changedKeys.has("rainMaxVolume") &&
      rainLoopAudio.fadeMode !== "exit"
    ) {
      fadeRainLoopVolume(params.rainMaxVolume, params.rainEnterMs, {
        mode: "volume",
      });
      return;
    }
    if (rainLoopAudio.fadeFrameId === null) {
      return;
    }
    if (
      changedKeys.has("rainEnterMs") &&
      rainLoopAudio.fadeMode !== "exit"
    ) {
      fadeRainLoopVolume(params.rainMaxVolume, params.rainEnterMs, {
        mode: rainLoopAudio.fadeMode || "enter",
      });
      return;
    }
    if (
      changedKeys.has("rainExitMs") &&
      rainLoopAudio.fadeMode === "exit"
    ) {
      stopRainLoopSound();
    }
  }

  function getRainFxConstructor() {
    const rainFx = window.RaindropFX;
    if (typeof rainFx === "function") {
      return rainFx;
    }
    if (rainFx && typeof rainFx === "object" && typeof rainFx.default === "function") {
      return rainFx.default;
    }
    return null;
  }

  function loadRainFxScript() {
    if (getRainFxConstructor()) {
      return Promise.resolve();
    }
    if (rainFxScriptPromise) {
      return rainFxScriptPromise;
    }

    rainFxScriptPromise = new Promise((resolve, reject) => {
      const existing = document.getElementById(RAIN_SCRIPT_ID);
      if (existing) {
        if (existing.dataset.loaded === "true") {
          resolve();
          return;
        }
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener(
          "error",
          () => {
            rainFxScriptPromise = null;
            reject(new Error("Failed to load raindrop-fx"));
          },
          { once: true }
        );
        return;
      }

      const script = document.createElement("script");
      script.id = RAIN_SCRIPT_ID;
      script.src = RAIN_VENDOR_SRC;
      script.async = true;
      script.addEventListener(
        "load",
        () => {
          script.dataset.loaded = "true";
          resolve();
        },
        { once: true }
      );
      script.addEventListener(
        "error",
        () => {
          rainFxScriptPromise = null;
          reject(new Error("Failed to load raindrop-fx"));
        },
        { once: true }
      );
      document.head.appendChild(script);
    });

    return rainFxScriptPromise;
  }

  function resizeCanvasToCssPixels(canvas) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || window.innerWidth));
    const height = Math.max(1, Math.round(rect.height || window.innerHeight));
    canvas.width = width;
    canvas.height = height;
    return { width, height };
  }

  function createRainBackground(canvas) {
    const background = document.createElement("canvas");
    const width = Math.max(1, canvas.width || window.innerWidth);
    const height = Math.max(1, canvas.height || window.innerHeight);
    const isDark = currentRainTheme() === "dark";
    background.width = width;
    background.height = height;

    const context = background.getContext("2d");
    if (!context) {
      return background;
    }

    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, isDark ? "#202426" : "#f9fbff");
    gradient.addColorStop(0.5, isDark ? "#141819" : "#d9e0ea");
    gradient.addColorStop(1, isDark ? "#252a2c" : "#ffffff");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    context.fillStyle = isDark
      ? "rgba(255, 255, 255, 0.08)"
      : "rgba(255, 255, 255, 0.36)";
    context.fillRect(width * 0.16, 0, width * 0.2, height);
    context.fillStyle = isDark
      ? "rgba(0, 0, 0, 0.22)"
      : "rgba(76, 92, 113, 0.16)";
    context.fillRect(width * 0.58, 0, width * 0.18, height);

    return background;
  }

  function setRainOpacity(canvas, opacity) {
    if (!canvas) {
      return;
    }
    canvas.style.setProperty(
      "--rain-fx-opacity",
      clamp(opacity, 0, MAX_RAIN_FX_OPACITY).toFixed(2)
    );
  }

  function currentRainTheme() {
    return body.classList.contains("theme-dark") ? "dark" : "light";
  }

  function createRainProfile(theme = currentRainTheme()) {
    return getRainVisualProfile({
      rainStrength: params.rainStrength,
      theme,
      backgroundBlurSteps:
        theme === "dark" ? params.rainBackgroundBlurSteps : undefined,
      rainDropColor: params.rainDropColor,
      rainHighlightColor: params.rainHighlightColor,
    });
  }

  function rainFxOptionsForProfile(rainProfile) {
    return {
      dropletsPerSecond: rainProfile.dropletsPerSecond,
      dropletsPerSeconds: rainProfile.dropletsPerSecond,
      spawnInterval: rainProfile.spawnInterval,
      spawnSize: rainProfile.spawnSize,
      spawnLimit: rainProfile.spawnLimit,
      mist: true,
      mistColor: rainProfile.mistColor,
      backgroundBlurSteps: rainProfile.backgroundBlurSteps,
      raindropCompose: rainProfile.raindropCompose,
      raindropDiffuseLight: rainProfile.raindropDiffuseLight,
      raindropSpecularLight: rainProfile.raindropSpecularLight,
    };
  }

  function syncActiveRainProfile({ updateBackground = false } = {}) {
    if (!rain.active) {
      return;
    }

    let rainProfile = createRainProfile();
    rain.lastProfile = rainProfile;
    rain.fallback?.setProfile?.(rainProfile);
    setRainOpacity(rainFxCanvas, rainProfile.fxOpacity);
    setRainOpacity(
      rainFallbackCanvas,
      rain.fallback ? rainProfile.fallbackOpacity : 0
    );

    if (!rain.rainFx?.options) {
      return;
    }

    Object.assign(rain.rainFx.options, rainFxOptionsForProfile(rainProfile));
    if (!updateBackground || typeof rain.rainFx.setBackground !== "function") {
      return;
    }

    const token = rain.renderToken;
    const background = createRainBackground(rainFxCanvas);
    const promise = rain.rainFx.setBackground(background);
    if (promise && typeof promise.catch === "function") {
      promise.catch(() => {});
    }
    if (promise && typeof promise.then === "function") {
      promise.then(() => {
        if (token !== rain.renderToken) {
          background.remove?.();
        }
      });
    }
  }

  function restartRainRenderers() {
    if (!rain.active) {
      return;
    }
    stopRainRenderers();
    startRainRenderers();
  }

  function applyRainSettings({ restartIfActive = false } = {}) {
    if (!rainLayer) {
      return;
    }

    rainLayer.style.setProperty("--rain-enter-duration", `${params.rainEnterMs}ms`);
    rainLayer.style.setProperty("--rain-exit-duration", `${params.rainExitMs}ms`);
    rainLayer.style.setProperty("--rain-enter-easing", params.rainEnterEasing);
    rainLayer.style.setProperty("--rain-exit-easing", params.rainExitEasing);
    rainLayer.style.setProperty("--rain-layer-z-index", String(params.rainZIndex));
    rainLayer.style.setProperty("--rain-canvas-z-index", String(params.rainZIndex + 1));
    rainLayer.style.setProperty("--rain-blend-mode", params.rainBlendMode);
    rainLayer.style.setProperty(
      "--rain-blur-blend-mode",
      params.rainBlurBlendMode,
    );
    rainLayer.style.setProperty(
      "--rain-blur-radius",
      `${scaledVisualPixel(params.rainBlurPx)}px`,
    );
    rainLayer.style.setProperty(
      "--rain-blur-opacity",
      params.rainBlurOpacity.toFixed(2),
    );
    rainLayer.style.setProperty(
      "--rain-blur-saturation",
      params.rainBlurSaturation.toFixed(2),
    );

    if (restartIfActive && rain.active) {
      restartRainRenderers();
    }
  }

  function applyHandSize() {
    document.documentElement.style.setProperty(
      "--hand-width-vw",
      `${params.handWidthVw}vw`
    );
  }

  function applyViewportScaledVisuals() {
    applyHandSize();
    applyRainSettings();
    trail.dirty = true;
    trail.sessionDirty = true;
    trail.glowDirty = true;
    scheduleTrailRender();
  }

  function applySceneHeight() {
    document.documentElement.style.setProperty(
      "--scene-height-vh",
      `${params.sceneHeightScreens * 100}vh`
    );
  }

  function applySceneTwoOverflowY() {
    document.documentElement.style.overflowY =
      rain.scrollUnlocked || params.sceneTwoOverflowYVisible
      ? "auto"
      : "hidden";
  }

  function sceneMotionOptions() {
    return {
      forceDeficitCurve: handForceDeficitCurve,
      motionScale: SharedRoomSettings.sceneMotionMultiplier(params),
    };
  }

  function getRainExitDurationMs() {
    return reducedMotion.matches ? 0 : params.rainExitMs;
  }

  function randomRange(range) {
    const [min, max] = range;
    return min + Math.random() * (max - min);
  }

  function createFallbackDrop(width, height, randomizeY, rainProfile) {
    const length = randomRange(rainProfile.fallbackLength);
    const speed = randomRange(rainProfile.fallbackSpeed);
    return {
      alpha: randomRange(rainProfile.fallbackAlpha),
      drift: 0.24 + Math.random() * 0.18,
      length,
      speed,
      width: randomRange(rainProfile.fallbackWidth),
      x: Math.random() * width,
      y: randomizeY ? Math.random() * height : -length,
    };
  }

  function startFallbackRain(canvas, initialRainProfile) {
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }

    let frameId = 0;
    let previousTime = performance.now();
    let width = 1;
    let height = 1;
    let drops = [];
    let rainProfile = initialRainProfile;
    let fallbackStrokeRgb = rainProfile.fallbackColor.join(", ");

    const syncDropCount = () => {
      const density = clamp((width * height) / (1280 * 720), 0.8, 1.6);
      const count = Math.round(rainProfile.fallbackDropCount * density);
      if (drops.length > count) {
        drops.length = count;
        return;
      }
      while (drops.length < count) {
        drops.push(createFallbackDrop(width, height, true, rainProfile));
      }
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(rect.width || window.innerWidth));
      height = Math.max(1, Math.round(rect.height || window.innerHeight));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      drops = [];
      syncDropCount();
    };

    const render = (time) => {
      const delta = clamp((time - previousTime) / 16.67, 0.5, 2.4);
      previousTime = time;

      context.clearRect(0, 0, width, height);
      context.lineCap = "round";

      for (const drop of drops) {
        context.beginPath();
        context.strokeStyle = `rgba(${fallbackStrokeRgb}, ${drop.alpha})`;
        context.lineWidth = drop.width;
        context.moveTo(drop.x, drop.y);
        context.lineTo(drop.x - drop.length * drop.drift, drop.y + drop.length);
        context.stroke();

        drop.x -= drop.speed * drop.drift * delta;
        drop.y += drop.speed * delta;

        if (drop.y - drop.length > height || drop.x < -drop.length) {
          Object.assign(drop, createFallbackDrop(width, height, false, rainProfile));
          drop.x = Math.random() * (width + 80);
        }
      }

      frameId = window.requestAnimationFrame(render);
    };

    resize();
    frameId = window.requestAnimationFrame(render);

    return {
      resize,
      setProfile: (nextProfile) => {
        rainProfile = nextProfile;
        fallbackStrokeRgb = rainProfile.fallbackColor.join(", ");
        syncDropCount();
      },
      stop: () => window.cancelAnimationFrame(frameId),
    };
  }

  function stopRainRenderers() {
    rain.renderToken += 1;
    if (rain.resizeHandler) {
      window.removeEventListener("resize", rain.resizeHandler);
      rain.resizeHandler = null;
    }
    rain.rainFx?.stop?.();
    rain.rainFx?.destroy?.();
    rain.rainFx = null;
    rain.fallback?.stop?.();
    rain.fallback = null;
    rain.active = false;
    setRainOpacity(rainFxCanvas, 0);
    setRainOpacity(rainFallbackCanvas, 0);
  }

  function startRainRenderers() {
    if (!rainLayer || !rainFxCanvas || !rainFallbackCanvas || rain.active) {
      return;
    }

    let rainProfile = createRainProfile();
    rain.lastProfile = rainProfile;
    rain.active = true;
    const token = ++rain.renderToken;

    const handleResize = () => {
      const size = resizeCanvasToCssPixels(rainFxCanvas);
      if (rain.rainFx) {
        rain.rainFx.resize?.(size.width, size.height);
      }
      rain.fallback?.resize?.();
    };
    rain.resizeHandler = handleResize;
    window.addEventListener("resize", handleResize, { passive: true });

    setRainOpacity(rainFxCanvas, 0);
    setRainOpacity(rainFallbackCanvas, 0);

    window.requestAnimationFrame(async () => {
      try {
        await loadRainFxScript();
        if (token !== rain.renderToken) {
          return;
        }

        const RaindropFX = getRainFxConstructor();
        if (!RaindropFX) {
          throw new Error("RaindropFX constructor is unavailable");
        }

        rainProfile = createRainProfile();
        rain.lastProfile = rainProfile;
        resizeCanvasToCssPixels(rainFxCanvas);
        const instance = new RaindropFX({
          canvas: rainFxCanvas,
          background: createRainBackground(rainFxCanvas),
          ...rainFxOptionsForProfile(rainProfile),
        });
        rain.rainFx = instance;

        setRainOpacity(rainFxCanvas, rainProfile.fxOpacity);
        await instance.start?.();
        if (token !== rain.renderToken) {
          instance.stop?.();
          instance.destroy?.();
          return;
        }

        setRainOpacity(rainFxCanvas, rainProfile.fxOpacity);
        rain.fallback?.stop?.();
        rain.fallback = null;
        setRainOpacity(rainFallbackCanvas, 0);
      } catch {
        if (token !== rain.renderToken) {
          return;
        }
        rain.rainFx?.stop?.();
        rain.rainFx?.destroy?.();
        rain.rainFx = null;
        if (!rain.fallback) {
          resizeCanvasToCssPixels(rainFallbackCanvas);
          rain.fallback = startFallbackRain(rainFallbackCanvas, rainProfile);
        }
        setRainOpacity(rainFxCanvas, 0);
        setRainOpacity(
          rainFallbackCanvas,
          rain.fallback ? rainProfile.fallbackOpacity : 0
        );
      }
    });
  }

  function shouldShowRain() {
    if (rain.scrollCompleted) {
      return false;
    }
    if (rain.scrollArmed || rain.scrollStarted) {
      return rain.scrollStarted;
    }
    return params.rainEnabled || rain.returnRequested;
  }

  function showRainLayer() {
    if (!rainLayer) {
      return;
    }

    const alreadyVisible =
      rainLayer.classList.contains("is-rain-visible") &&
      !rainLayer.classList.contains("is-rain-hiding");
    window.clearTimeout(rain.hideTimerId);
    rain.hideTimerId = null;
    if (alreadyVisible) {
      if (!rainLoopAudio.playing) {
        playRainLoopSound();
      }
      if (!rain.active) {
        startRainRenderers();
      }
      return;
    }

    rainLayer.classList.remove("is-rain-hiding");
    rainLayer.classList.add("is-rain-visible");
    playRainLoopSound();
    startRainRenderers();
  }

  function hideRainLayer({ immediate = false } = {}) {
    if (!rainLayer) {
      return;
    }

    if (immediate) {
      window.clearTimeout(rain.hideTimerId);
      rain.hideTimerId = null;
      rainLayer.classList.remove("is-rain-visible", "is-rain-hiding");
      stopRainLoopSound({ immediate: true });
      stopRainRenderers();
      return;
    }

    if (!shouldStartRainExit({
      isActive: rain.active,
      isHiding: rainLayer.classList.contains("is-rain-hiding"),
      isVisible: rainLayer.classList.contains("is-rain-visible"),
    })) {
      return;
    }

    window.clearTimeout(rain.hideTimerId);
    rain.hideTimerId = null;

    rainLayer.classList.remove("is-rain-visible");
    rainLayer.classList.add("is-rain-hiding");
    stopRainLoopSound();
    rain.hideTimerId = window.setTimeout(() => {
      if (shouldShowRain()) {
        return;
      }
      rainLayer.classList.remove("is-rain-hiding");
      rain.hideTimerId = null;
      stopRainRenderers();
    }, getRainExitDurationMs());
  }

  function syncRainVisibility(options = {}) {
    if (shouldShowRain()) {
      showRainLayer();
    } else {
      hideRainLayer(options);
    }
  }

  function hideReturnRain(options = {}) {
    rain.returnRequested = false;
    syncRainVisibility(options);
  }

  function applySummitRainScrollProfile() {
    if (!rain.scrollStarted || rain.scrollCompleted) {
      return null;
    }
    const profile = rainScrollProfile({
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    });
    rainLayer?.style.setProperty("--rain-scroll-opacity", `${profile.opacity}`);
    cancelRainLoopFade();
    setRainLoopVolume(params.rainMaxVolume * profile.audio);
    if (profile.atBottom) {
      rain.scrollArmed = false;
      rain.scrollCompleted = true;
      rain.scrollStarted = false;
      rain.returnRequested = false;
      rainLayer?.classList.remove("is-rain-scroll-driven");
      hideRainLayer({ immediate: true });
    }
    return profile;
  }

  function startSummitRainScroll() {
    if (!rain.scrollArmed || rain.scrollStarted || rain.scrollCompleted) {
      return false;
    }
    rain.scrollStarted = true;
    rain.returnRequested = true;
    rainLayer?.classList.add("is-rain-scroll-driven");
    showRainLayer();
    applySummitRainScrollProfile();
    return true;
  }

  function armSummitRainScroll() {
    if (rain.scrollCompleted || rain.scrollArmed || rain.scrollStarted) {
      return false;
    }
    rain.scrollArmed = true;
    rain.scrollStarted = false;
    rain.scrollUnlocked = true;
    rain.lastScrollY = window.scrollY;
    rain.returnRequested = false;
    rainLayer?.classList.add("is-rain-scroll-driven");
    rainLayer?.style.setProperty("--rain-scroll-opacity", "0");
    hideRainLayer({ immediate: true });
    applySceneTwoOverflowY();
    return true;
  }

  function resetSummitRainScroll() {
    rain.scrollArmed = false;
    rain.scrollCompleted = false;
    rain.scrollStarted = false;
    rain.scrollUnlocked = false;
    rain.touchY = null;
    rain.userIntentUntil = 0;
    rain.returnRequested = false;
    rainLayer?.classList.remove("is-rain-scroll-driven");
    rainLayer?.style.removeProperty("--rain-scroll-opacity");
    if (params.rainEnabled) {
      showRainLayer();
    } else {
      hideRainLayer({ immediate: true });
    }
    applySceneTwoOverflowY();
  }

  function markSummitRainScrollIntent() {
    rain.userIntentUntil = performance.now() + 750;
  }

  function syncSummitRainScroll() {
    const nextScrollY = window.scrollY;
    const movedDown = nextScrollY > rain.lastScrollY + 0.5;
    if (
      rain.scrollArmed &&
      !rain.scrollStarted &&
      movedDown &&
      performance.now() <= rain.userIntentUntil
    ) {
      startSummitRainScroll();
    } else if (rain.scrollStarted) {
      applySummitRainScrollProfile();
    }
    rain.lastScrollY = nextScrollY;
  }

  function setTheme(theme, options = {}) {
    const requestedDuration = Number(options.durationMs);
    const durationMs = reducedMotion.matches
      ? 0
      : clamp(
          Number.isFinite(requestedDuration)
            ? requestedDuration
            : DEFAULT_THEME_TRANSITION_MS,
          0,
          10000,
        );
    body.style.setProperty("--theme-transition-duration", `${durationMs}ms`);
    const previousRainTheme = currentRainTheme();
    body.classList.toggle("theme-light", theme === "light");
    body.classList.toggle("theme-dark", theme === "dark");
    applyTrailBlendMode();
    requestFoldSync();
    if (currentRainTheme() !== previousRainTheme) {
      syncActiveRainProfile({ updateBackground: true });
    }
  }

  function applyThemeBackgroundSettings() {
    [
      ["--light-background", params.lightBackgroundColor],
      ["--light-background-deep", params.lightBackgroundDeepColor],
      ["--light-background-low", params.lightBackgroundLowColor],
      ["--dark-background", params.darkBackgroundColor],
      ["--dark-background-deep", params.darkBackgroundDeepColor],
      ["--dark-background-low", params.darkBackgroundLowColor],
    ].forEach(([name, value]) => body.style.setProperty(name, value));
  }

  function applyHandVisibilitySetting() {
    body.classList.toggle("hand-always-visible", handIsAlwaysVisible());
    body.classList.toggle("hand-hidden", handIsHidden());
    if (handIsHidden()) {
      setHandToGrab();
      hideHandCursor();
      return;
    }
    if (handIsAlwaysVisible()) {
      showInitialHandCursor();
    } else if (!motion.dragging) {
      hideHandCursor();
    }
  }

  function applyCustomCursorSettings() {
    body.classList.toggle("custom-cursor-enabled", params.customCursorEnabled);
    body.style.setProperty(
      "--custom-cursor-size-px",
      `${params.customCursorSizePx}px`,
    );
  }

  function resolveTheme(autoTheme) {
    return params.themeMode === "auto" ? autoTheme : params.themeMode;
  }

  function returnThemeTransitionDuration(atReturnPlace, options = {}) {
    if (options.immediate === true) {
      return 0;
    }
    if (params.themeMode !== "auto") {
      return DEFAULT_THEME_TRANSITION_MS;
    }
    return atReturnPlace ? params.rainEnterMs : params.rainExitMs;
  }

  function setPhase(phase) {
    motion.phase = phase;
    body.classList.remove(
      "state-intro",
      "state-fallingToBottom",
      "state-play",
      "state-won"
    );
    body.classList.add(`state-${phase}`);
  }

  function settingsChangeContext(options = {}) {
    const changedKey = options.changedKey || "";
    const hasExplicitChangedKeys = Array.isArray(options.changedKeys);
    const acceptsKnownKey = (key) => Object.hasOwn(params, key);
    const changedKeys = new Set(
      hasExplicitChangedKeys
        ? options.changedKeys.filter(acceptsKnownKey)
        : changedKey
          ? acceptsKnownKey(changedKey)
            ? [changedKey]
            : []
          : [],
    );
    const fullRefresh = !hasExplicitChangedKeys && changedKey === "";
    const hasTargetedChanges = hasExplicitChangedKeys || changedKey !== "";
    const shouldHandleChange = (...keys) =>
      fullRefresh || keys.some((key) => changedKeys.has(key));

    return {
      changedKeys,
      fullRefresh,
      hasTargetedChanges,
      shouldHandleChange,
    };
  }

  function normalizeCurrentParams(previousRoomSettings, preservedState) {
    Object.assign(
      params,
      SharedPhysics.sanitizePhysics(params, params),
      SharedRoomSettings.sanitizeRoomSettings(params, params),
      sanitizeGlowOptimizationSettings(params, params),
    );
    handForceDeficitCurve =
      SharedRoomSettings.parseCubicBezier(params.handForceDeficitEasing) ||
      SharedPhysics.DEFAULT_FORCE_DEFICIT_CURVE;
    params.themeMode = normalizeThemeMode(params.themeMode, DEFAULT_THEME_MODE);
    Object.assign(
      params,
      normalizeRockScaleSettings(params, {
        defaults: {
          rockMinWidthVw:
            SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rockMinWidthVw,
          rockMaxWidthVw:
            SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rockMaxWidthVw,
          rockScaleEasing:
            SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rockScaleEasing,
        },
      }),
    );
    if (preservedState && previousRoomSettings) {
      const previousScale =
        SharedRoomSettings.sceneMotionMultiplier(previousRoomSettings);
      const nextScale = SharedRoomSettings.sceneMotionMultiplier(params);
      preservedState.vy *= previousScale > 0 ? nextScale / previousScale : 1;
    }
    Object.assign(
      params,
      normalizeRainSettings(
        params,
        {
          defaults: {
            rainBlendMode: DEFAULT_RAIN_BLEND_MODE,
            rainBlurBlendMode: DEFAULT_RAIN_BLUR_BLEND_MODE,
            rainMaxVolume:
              SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rainMaxVolume,
            rainBackgroundBlurSteps: DEFAULT_RAIN_BACKGROUND_BLUR_STEPS,
            rainBlurPx: DEFAULT_RAIN_BLUR_PX,
            rainBlurOpacity: DEFAULT_RAIN_BLUR_OPACITY,
            rainBlurSaturation: DEFAULT_RAIN_BLUR_SATURATION,
            rainEnterEasing: DEFAULT_RAIN_ENTER_EASING,
            rainExitEasing: DEFAULT_RAIN_EXIT_EASING,
            rainEnterMs: DEFAULT_RAIN_ENTER_MS,
            rainExitMs: DEFAULT_RAIN_EXIT_MS,
            rainZIndex: DEFAULT_RAIN_Z_INDEX,
          },
          isTimingFunctionSupported: (value) =>
            Boolean(
              window.CSS &&
                typeof CSS.supports === "function" &&
                CSS.supports("transition-timing-function", value),
            ),
        },
      ),
    );
  }

  function applyCurrentSettings({
    changedKeys,
    fullRefresh,
    hasTargetedChanges,
    shouldHandleChange,
    previousRoomSettings,
    preservedState,
    preserveBottomScroll,
    preserveSettingsVersionSelection = false,
    syncControls = false,
    updateUi = false,
    persist = false,
    broadcastChanges = false,
  }) {
    normalizeCurrentParams(previousRoomSettings, preservedState);

    if (shouldHandleChange(...THEME_BACKGROUND_SETTING_KEYS)) {
      applyThemeBackgroundSettings();
    }

    if (syncControls) {
      settingsController.syncRoomSettingControls();
      settingsController.syncLocalSettingControls();
    }
    if (
      shouldHandleChange(
        "preclickHopActivationRadiusPercent",
        "preclickHopMaxDistancePercent",
      )
    ) {
      restartPreclickRockHopFromLastPointer();
    }
    if (shouldHandleChange(...RAIN_SETTING_KEYS)) {
      applyRainSettings({
        restartIfActive:
          hasTargetedChanges &&
          (shouldHandleChange("rainStrength") ||
            shouldHandleChange("rainBackgroundBlurSteps") ||
            shouldHandleChange("rainDropColor") ||
            shouldHandleChange("rainHighlightColor")),
      });
    }
    if (shouldHandleChange("rainEnabled")) {
      syncRainVisibility({
        immediate: fullRefresh,
      });
    }
    if (shouldHandleChange("themeMode", "rainEnterMs", "rainExitMs")) {
      syncReturnTheme();
    }
    if (
      hasTargetedChanges &&
      shouldHandleChange("rainMaxVolume", "rainEnterMs", "rainExitMs")
    ) {
      syncRainLoopFadeTiming(changedKeys);
    }

    if (shouldHandleChange("themeMode", "blendMode", "lineOpacity")) {
      applyTrailBlendMode();
    }
    if (shouldHandleChange("handVisibilityMode")) {
      applyHandVisibilitySetting();
    }
    if (shouldHandleChange("customCursorEnabled", "customCursorSizePx")) {
      applyCustomCursorSettings();
    }
    if (shouldHandleChange("rockImageId")) {
      applyRockImageSettings();
    }
    if (
      shouldHandleChange(
        "rockPulseEnabled",
        "rockPulseShrinkPercent",
        "rockPulseBpm",
      )
    ) {
      syncRockPulse();
    }
    if (shouldHandleChange("handAudioEnabled") && !params.handAudioEnabled) {
      stopHandInteractionSounds();
    }
    if (shouldHandleChange("drizzleEnabled")) {
      if (!params.drizzleEnabled) {
        stopDrizzleLoopSound();
      } else if (hasTargetedChanges) {
        playDrizzleLoopSound();
      }
    }
    if (
      shouldHandleChange(
        "drizzleStartVolume",
        "drizzleEndVolume",
        "drizzleVolumeEasing",
        "rainMaxVolume",
      )
    ) {
      syncDrizzleLoopVolume();
    }

    if (updateUi) {
      settingsController.updateControlOutputs();
    }
    trimTrailToLimit();
    if (shouldHandleChange("trailMaxPoints", "trailRenderProfile")) {
      checkpointTrail({ force: true });
    }

    if (persist) {
      settingsController.saveSettings();
    }
    if (
      updateUi &&
      hasTargetedChanges &&
      changedKeys.size > 0 &&
      !preserveSettingsVersionSelection &&
      !collab.applyingRemotePhysics &&
      !collab.applyingRemoteRoomSettings
    ) {
      settingsController.markSettingsVersionDraft();
    }
    if (shouldHandleChange(...TRAIL_BASE_RENDER_SETTING_KEYS)) {
      trail.dirty = true;
      trail.sessionDirty = true;
    }
    if (shouldHandleChange(...TRAIL_GLOW_RENDER_SETTING_KEYS)) {
      trail.glowDirty = true;
    }
    if (shouldHandleChange("glowOptimizationMode")) {
      trail.adaptiveQuality = 1;
      trail.adaptiveMeasuredAt = performance.now();
    }
    if (shouldHandleChange("sceneHeightScreens")) {
      applySceneHeight();
    }
    if (shouldHandleChange("sceneTwoOverflowYVisible")) {
      applySceneTwoOverflowY();
    }
    if (preservedState) {
      applyCanonicalMotion(preservedState);
    } else if (
      shouldHandleChange(
        "rockMinWidthVw",
        "rockMaxWidthVw",
        "rockScaleEasing",
        "rockPressShrinkPercent",
        "rockWallPenetrationPercent",
        "rockPulseShrinkPercent",
      )
    ) {
      applyRockScale();
    }
    if (shouldHandleChange("handWidthVw")) {
      applyHandSize();
    }
    if (
      shouldHandleChange(
        "sceneHeightScreens",
        "rockMinWidthVw",
        "rockMaxWidthVw",
        "rockScaleEasing",
        "rockWallPenetrationPercent",
      )
    ) {
      renderImprint();
    }
    if (
      shouldHandleChange(
        "sceneHeightScreens",
        "rockMinWidthVw",
        "rockMaxWidthVw",
        "rockScaleEasing",
        "rockWallPenetrationPercent",
        "trailAnchorHeightPercent",
      )
    ) {
      reprojectTrail();
    }
    if (trail.dirty || trail.sessionDirty || trail.glowDirty) {
      scheduleTrailRender();
    }
    if (preserveBottomScroll) {
      scrollToSceneBottom();
    }
    if (
      collab.enabled &&
      localCanEditSettings() &&
      !collab.applyingRemotePhysics &&
      broadcastChanges
    ) {
      let hasPhysicsChanges = false;
      changedKeys.forEach((key) => {
        if (SHARED_PHYSICS_KEYS.includes(key)) {
          collab.pendingPhysicsChanges[key] = params[key];
          if (broadcastChanges) {
            collab.stagedPhysicsChangeKeys.delete(key);
          }
          hasPhysicsChanges = true;
        }
      });
      if (hasPhysicsChanges) {
        scheduleSharedPhysicsUpdate();
      }
    }
    if (
      collab.enabled &&
      localCanEditSettings() &&
      !collab.applyingRemoteRoomSettings &&
      broadcastChanges
    ) {
      let hasRoomSettingsChanges = false;
      changedKeys.forEach((key) => {
        if (SHARED_ROOM_SETTING_KEYS.includes(key)) {
          if (
            collab.restoringStoredSession &&
            key === "sceneHeightScreens"
          ) {
            return;
          }
          collab.pendingRoomSettingsChanges[key] = params[key];
          if (broadcastChanges) {
            collab.stagedRoomSettingsChangeKeys.delete(key);
          }
          hasRoomSettingsChanges = true;
        }
      });
      if (hasRoomSettingsChanges) {
        scheduleSharedRoomSettingsUpdate();
      }
    }
  }

  function readControls(options = {}) {
    const {
      changedKeys,
      fullRefresh,
      hasTargetedChanges,
      shouldHandleChange,
    } = settingsChangeContext(options);
    const sceneHeightChanging = shouldHandleChange("sceneHeightScreens");
    const sceneBoundsChanging = shouldHandleChange(
      "sceneHeightScreens",
      "rockWallPenetrationPercent",
    );

    const previousRoomSettings =
      sceneBoundsChanging ? sharedRoomSettingsPayload() : null;
    const preservedState =
      sceneBoundsChanging ? currentSharedState() : null;
    const preserveBottomScroll =
      sceneHeightChanging &&
      Math.abs(
        window.scrollY +
          window.innerHeight -
          document.documentElement.scrollHeight
      ) <= 4;
    const commit = options.commit !== false;

    if (settingsUiEnabled) {
      Object.assign(params, settingsController.readPhysicsControls());
      Object.assign(
        params,
        SharedRoomSettings.sanitizeRoomSettings(
          settingsController.readRoomSettingsControls(),
          params,
        ),
      );
      Object.assign(
        params,
        sanitizeGlowOptimizationSettings(
          settingsController.readLocalSettingsControls(),
          params,
        ),
      );
    }
    applyCurrentSettings({
      changedKeys,
      fullRefresh,
      hasTargetedChanges,
      shouldHandleChange,
      previousRoomSettings,
      preservedState,
      preserveBottomScroll,
      preserveSettingsVersionSelection:
        Boolean(options.preserveSettingsVersionSelection),
      syncControls: settingsUiEnabled,
      updateUi: settingsUiEnabled,
      persist: settingsUiEnabled && commit,
      broadcastChanges: settingsUiEnabled && commit,
    });
  }

  function applyTestSettings(nextSettings = {}, options = {}) {
    const source =
      nextSettings && typeof nextSettings === "object" ? nextSettings : {};
    const changedKeys = Object.keys(source);
    const previousRoomSettings = sharedRoomSettingsPayload();
    const preservedState = currentSharedState();
    Object.assign(
      params,
      SharedPhysics.sanitizePhysics({ ...params, ...source }, params),
      SharedRoomSettings.sanitizeRoomSettings({ ...params, ...source }, params),
      sanitizeGlowOptimizationSettings({ ...params, ...source }, params),
    );
    applyCurrentSettings({
      ...settingsChangeContext({ changedKeys }),
      previousRoomSettings,
      preservedState,
      preserveBottomScroll: false,
      broadcastChanges: Boolean(options.broadcastChanges),
    });
  }

  function canShowPhotoCursor(event) {
    return (
      motion.phase === PHASES.PLAY &&
      finePointer.matches &&
      !handIsHidden() &&
      (!event.pointerType || event.pointerType === "mouse")
    );
  }

  function handIsAlwaysVisible() {
    return params.handVisibilityMode === "always";
  }

  function handIsHidden() {
    return params.handVisibilityMode === "hidden";
  }

  function setHandCursorViewportPosition(position) {
    handCursor.style.setProperty("--cursor-x", `${position.x}px`);
    handCursor.style.setProperty("--cursor-y", `${position.y}px`);
  }

  function moveHandCursor(event) {
    if (!canShowPhotoCursor(event)) {
      return;
    }

    setHandCursorViewportPosition({
      x: event.clientX,
      y: event.clientY,
    });
  }

  function showHandCursor(event) {
    if (!canShowPhotoCursor(event)) {
      return;
    }

    moveHandCursor(event);
    handCursor.classList.add("is-visible");
  }

  function showInitialHandCursor() {
    if (finePointer.matches && handIsAlwaysVisible()) {
      showHandCursor({
        clientX: window.innerWidth / 2,
        clientY: window.innerHeight / 2,
        pointerType: "mouse",
      });
      return;
    }
    hideHandCursor();
  }

  function syncHandCursorForPointer(event) {
    if (!canShowPhotoCursor(event)) {
      return;
    }
    moveHandCursor(event);
    handCursor.classList.toggle(
      "is-visible",
      handIsAlwaysVisible() || motion.dragging || pointerIsOverRock(event),
    );
  }

  function hideHandCursor() {
    handCursor.classList.remove("is-visible", "is-grabbing");
  }

  function setGrabbingCursor(isGrabbing) {
    handCursor.classList.toggle("is-grabbing", isGrabbing);
  }

  function pressAlwaysVisibleHand(event) {
    if (!canShowPhotoCursor(event) || event.button !== 0) {
      return;
    }

    moveHandCursor(event);
    if (!handIsAlwaysVisible() && !pointerIsOverRock(event)) {
      return;
    }
    handCursor.classList.add("is-visible");
    if (!motion.dragging) {
      scheduleGrabbingHandImage();
    }
  }

  function releaseAlwaysVisibleHand(event) {
    if (
      (event.pointerType && event.pointerType !== "mouse") ||
      motion.dragging
    ) {
      return;
    }

    setHandToGrab();
    if (!handIsAlwaysVisible() && !pointerIsOverRock(event)) {
      hideHandCursor();
    }
  }

  function showNativeSettingsCursor() {
    body.classList.add("is-settings-pointer-active");
  }

  function hideNativeSettingsCursor() {
    body.classList.remove("is-settings-pointer-active");
  }

  function clearHandImageChangeTimer() {
    if (motion.handImageChangeTimerId === null) {
      return;
    }
    window.clearTimeout(motion.handImageChangeTimerId);
    motion.handImageChangeTimerId = null;
  }

  function applyGrabbingHandImage() {
    motion.handImageChangeTimerId = null;
    if (handIsHidden()) {
      return;
    }
    motion.alternateHand = true;
    handCursor.classList.add("is-alternate", "is-grabbing");
  }

  function scheduleGrabbingHandImage() {
    clearHandImageChangeTimer();
    if (handIsHidden()) {
      return;
    }
    if (params.handImageChangeDelayMs <= 0) {
      applyGrabbingHandImage();
      return;
    }
    motion.handImageChangeTimerId = window.setTimeout(
      applyGrabbingHandImage,
      params.handImageChangeDelayMs,
    );
  }

  function setHandToGrab() {
    clearHandImageChangeTimer();
    motion.alternateHand = false;
    handCursor.classList.remove("is-alternate", "is-grabbing");
  }

  function setPreclickRockHopOffset(x, y) {
    rock.style.setProperty("--rock-hop-x", `${x}px`);
    rock.style.setProperty("--rock-hop-y", `${y}px`);
  }

  function preclickRockHopOffset() {
    const style = window.getComputedStyle(rock);
    return {
      x: Number.parseFloat(style.getPropertyValue("--rock-hop-x")) || 0,
      y: Number.parseFloat(style.getPropertyValue("--rock-hop-y")) || 0,
    };
  }

  function preclickRockBaseCenter(offset = preclickRockHopOffset()) {
    const rect = rock.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 - offset.x,
      y: rect.top + rect.height / 2 - offset.y,
    };
  }

  function cancelPreclickHopAnimation() {
    if (preclickRockGuidance.hopAnimationId === null) {
      return;
    }
    window.cancelAnimationFrame(preclickRockGuidance.hopAnimationId);
    preclickRockGuidance.hopAnimationId = null;
  }

  function resetPreclickRockHop() {
    cancelPreclickHopAnimation();
    rock.classList.remove("is-preclick-hop");
    setPreclickRockHopOffset(0, 0);
  }

  function resetPreclickRockGuidance() {
    stopPreclickHopSounds();
    resetPreclickRockHop();
    Object.assign(preclickRockGuidance, {
      completed: false,
      pointerX: null,
      pointerY: null,
      directionX: null,
      directionY: null,
      insideRadius: false,
      outsideRadius: false,
      hopCount: 0,
      radiusHopCount: 0,
      forcedRadiusMissConsumed: false,
      lastRadiusDecision: null,
      guardClicksUsed: 0,
      hopAnimationId: null,
      hopSampleAtMs: null,
      hopSampleX: null,
      hopSampleY: null,
      hopSpeedPxPerSecond: 0,
    });
    body.classList.add(
      "preclick-rock-guidance",
      "is-manual-scroll-disabled",
    );
    document.documentElement.classList.add("is-manual-scroll-disabled");
    rock.classList.add("is-preclick-hop");
  }

  function performPreclickRockHop({
    centerX,
    centerY,
    speedPxPerSecond,
  }) {
    cancelPreclickHopAnimation();
    playPreclickHopSound();
    const currentOffset = preclickRockHopOffset();
    const rect = rock.getBoundingClientRect();
    const startCenter = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    const baseCenter = preclickRockBaseCenter(currentOffset);
    const target = calculatePreclickHopTarget({
      pointerX: preclickRockGuidance.pointerX,
      pointerY: preclickRockGuidance.pointerY,
      centerX,
      centerY,
      speedPxPerSecond,
      maxDistancePercent: params.preclickHopMaxDistancePercent,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      activationRadius:
        (params.preclickHopActivationRadiusPercent / 100) * rect.width,
      minStartSeparation: Math.max(2, rect.width * 0.05),
      currentOffsetX: currentOffset.x,
      currentOffsetY: currentOffset.y,
      lastDirectionX: preclickRockGuidance.directionX,
      lastDirectionY: preclickRockGuidance.directionY,
    });
    preclickRockGuidance.directionX = target.directionX;
    preclickRockGuidance.directionY = target.directionY;
    preclickRockGuidance.hopCount += 1;
    const hopDurationMs = preclickHopDurationMs({
      distancePx: Math.hypot(target.deltaX, target.deltaY),
      speedPxPerSecond: params.preclickHopSpeedPxPerSecond,
    });
    rock.classList.add("is-preclick-hop");

    const applyHopProgress = (progress) => {
      const wrappedCenter = wrapPreclickHopCenter({
        x: startCenter.x + target.deltaX * progress,
        y: startCenter.y + target.deltaY * progress,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });
      setPreclickRockHopOffset(
        wrappedCenter.x - baseCenter.x,
        wrappedCenter.y - baseCenter.y,
      );
    };

    if (reducedMotion.matches || hopDurationMs <= 0) {
      applyHopProgress(1);
      return;
    }

    const startedAt = performance.now();
    const renderHop = (now) => {
      const progress = clamp(
        (now - startedAt) / hopDurationMs,
        0,
        1,
      );
      applyHopProgress(
        cubicBezierYForX(
          progress,
          params.preclickHopSpeedEasing || PRECLICK_HOP_EASING_CURVE,
        ),
      );
      if (progress < 1) {
        preclickRockGuidance.hopAnimationId =
          window.requestAnimationFrame(renderHop);
        return;
      }
      preclickRockGuidance.hopAnimationId = null;
    };
    preclickRockGuidance.hopAnimationId =
      window.requestAnimationFrame(renderHop);
  }

  function refreshPreclickRockHop() {
    if (
      preclickRockGuidance.completed ||
      !finePointer.matches ||
      !Number.isFinite(preclickRockGuidance.pointerX) ||
      !Number.isFinite(preclickRockGuidance.pointerY)
    ) {
      return;
    }
    const rockRect = rock.getBoundingClientRect();
    const activationRadius =
      (params.preclickHopActivationRadiusPercent / 100) * rockRect.width;
    if (activationRadius <= 0) {
      preclickRockGuidance.insideRadius = false;
      preclickRockGuidance.outsideRadius = false;
      resetPreclickRockHop();
      return;
    }

    const center = {
      x: rockRect.left + rockRect.width / 2,
      y: rockRect.top + rockRect.height / 2,
    };
    const centerX = center.x;
    const centerY = center.y;
    const deltaX = preclickRockGuidance.pointerX - centerX;
    const deltaY = preclickRockGuidance.pointerY - centerY;
    if (Math.hypot(deltaX, deltaY) > activationRadius) {
      const exitedRadius = preclickRockGuidance.insideRadius;
      preclickRockGuidance.insideRadius = false;
      if (exitedRadius || !preclickRockGuidance.outsideRadius) {
        preclickRockGuidance.outsideRadius = true;
      }
      return;
    }

    const enteredRadius = !preclickRockGuidance.insideRadius;
    preclickRockGuidance.insideRadius = true;
    preclickRockGuidance.outsideRadius = false;
    if (enteredRadius) {
      const decision = preclickRadiusHopDecision({
        successfulHopCount: preclickRockGuidance.radiusHopCount,
        forcedMissConsumed: preclickRockGuidance.forcedRadiusMissConsumed,
        missProbabilityPercent: params.preclickHopMissProbabilityPercent,
      });
      preclickRockGuidance.forcedRadiusMissConsumed =
        decision.forcedMissConsumed;
      preclickRockGuidance.lastRadiusDecision = decision.reason;
      if (!decision.shouldHop) {
        return;
      }
      preclickRockGuidance.radiusHopCount += 1;
      performPreclickRockHop({
        centerX,
        centerY,
        speedPxPerSecond: preclickRockGuidance.hopSpeedPxPerSecond,
      });
    }
  }

  function updatePreclickRockHop(event) {
    if (
      preclickRockGuidance.completed ||
      !finePointer.matches ||
      (event.pointerType && event.pointerType !== "mouse")
    ) {
      return;
    }
    const pointerX = Number(event.clientX);
    const pointerY = Number(event.clientY);
    if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) {
      return;
    }
    const movementAtMs = performance.now();
    preclickRockGuidance.hopSpeedPxPerSecond = preclickPointerSpeed({
      previousX: preclickRockGuidance.hopSampleX,
      previousY: preclickRockGuidance.hopSampleY,
      previousAtMs: preclickRockGuidance.hopSampleAtMs,
      x: pointerX,
      y: pointerY,
      atMs: movementAtMs,
    });
    preclickRockGuidance.pointerX = pointerX;
    preclickRockGuidance.pointerY = pointerY;
    preclickRockGuidance.hopSampleX = pointerX;
    preclickRockGuidance.hopSampleY = pointerY;
    preclickRockGuidance.hopSampleAtMs = movementAtMs;
    syncHandCursorForPointer(event);
    refreshPreclickRockHop();
  }

  function restartPreclickRockHopFromLastPointer() {
    preclickRockGuidance.insideRadius = false;
    preclickRockGuidance.outsideRadius = false;
    cancelPreclickHopAnimation();
    const offset = preclickRockHopOffset();
    const rect = rock.getBoundingClientRect();
    const baseCenter = preclickRockBaseCenter(offset);
    const wrappedCenter = wrapPreclickHopCenter({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setPreclickRockHopOffset(
      wrappedCenter.x - baseCenter.x,
      wrappedCenter.y - baseCenter.y,
    );
  }

  function updatePreclickRockGuidance(event) {
    if (preclickRockGuidance.completed) {
      syncHandCursorForPointer(event);
      return;
    }
    updatePreclickRockHop(event);
  }

  function consumePreclickGuardClick(event) {
    const guardClickCount = Math.max(
      0,
      Math.round(Number(params.preclickHopGuardClickCount) || 0),
    );
    if (
      preclickRockGuidance.completed ||
      preclickRockGuidance.guardClicksUsed >= guardClickCount
    ) {
      return false;
    }
    const pointerX = Number(event.clientX);
    const pointerY = Number(event.clientY);
    if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) {
      return false;
    }
    const rect = rock.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    preclickRockGuidance.pointerX = pointerX;
    preclickRockGuidance.pointerY = pointerY;
    preclickRockGuidance.hopSampleX = pointerX;
    preclickRockGuidance.hopSampleY = pointerY;
    preclickRockGuidance.hopSampleAtMs = performance.now();
    preclickRockGuidance.guardClicksUsed += 1;
    preclickRockGuidance.insideRadius =
      params.preclickHopActivationRadiusPercent > 0;
    preclickRockGuidance.outsideRadius = false;
    syncHandCursorForPointer(event);
    preclickPopupController.openPreclickWindow({
      aspectRatio:
        preclickPopupRockImage?.naturalWidth > 0 &&
        preclickPopupRockImage?.naturalHeight > 0
          ? preclickPopupRockImage.naturalWidth /
            preclickPopupRockImage.naturalHeight
          : PRECLICK_POPUP_ROCK_FALLBACK_ASPECT_RATIO,
      clientX: pointerX,
      clientY: pointerY,
      delayMs: params.preclickPopupDelayMs,
      imageUrl: preclickPopupRockImageUrl,
      width: (window.innerWidth * params.rockActivatedWidthVw) / 100,
    });
    playGachiClickSound(PRECLICK_GACHI_CLICK_SOUND_FILENAME);
    performPreclickRockHop({
      centerX,
      centerY,
      speedPxPerSecond: preclickRockGuidance.hopSpeedPxPerSecond,
    });
    event.preventDefault();
    return true;
  }

  function materializePreclickRockHopPosition() {
    cancelPreclickHopAnimation();
    updateBounds();
    const rect = rock.getBoundingClientRect();
    const targetCenterX = rect.left + rect.width / 2;
    const targetCenterY = rect.top + rect.height / 2;
    const targetY = clamp(
      targetCenterY + window.scrollY - bounds.rockHeight / 2,
      0,
      bounds.maxY,
    );
    const targetScale =
      scaleForLocalY(targetY) *
      rockPressScaleFactor(params.rockPressShrinkPercent);
    const targetX = rockLocalXForVisualGrab(
      targetCenterX,
      bounds.rockWidth / 2,
      bounds.maxX,
      bounds.rockWidth,
      targetScale,
    );
    rock.classList.remove("is-preclick-hop");
    void rock.offsetWidth;
    setPosition(targetX, targetY);
  }

  function completePreclickRockGuidance({ preserveHopPosition = false } = {}) {
    if (preclickRockGuidance.completed) {
      return;
    }
    if (preserveHopPosition) {
      materializePreclickRockHopPosition();
    }
    preclickRockGuidance.completed = true;
    preclickRockGuidance.insideRadius = false;
    body.classList.remove(
      "preclick-rock-guidance",
      "is-manual-scroll-disabled",
    );
    document.documentElement.classList.remove("is-manual-scroll-disabled");
    rock.classList.remove("is-preclick-hop");
    resetPreclickRockHop();
  }

  function updateBounds() {
    bounds.worldWidth = window.innerWidth;
    bounds.rockWidth = rock.offsetWidth;
    bounds.rockHeight = rock.offsetHeight;
    bounds.maxX = Math.max(0, bounds.worldWidth - bounds.rockWidth);
    const bottomScale = rockScaleForY(1, 1, {
      easing: params.rockScaleEasing,
      minWidthVw: params.rockMinWidthVw,
      maxWidthVw: params.rockMaxWidthVw,
      baseWidthPx: bounds.rockWidth,
      viewportWidthPx: bounds.worldWidth,
    });
    const effectiveBottomScale =
      bottomScale * motion.rockActivationScaleFactor;
    const bottomPenetration = rockWallPenetrationPixels(
      bounds.rockHeight * effectiveBottomScale,
      params.rockWallPenetrationPercent,
    );
    const visualBottomOffset =
      (bounds.rockHeight * (1 + effectiveBottomScale)) / 2 + FLOOR_INSET;
    bounds.worldHeight = Math.max(
      window.innerHeight * params.sceneHeightScreens,
      visualBottomOffset
    );
    bounds.maxY = Math.max(
      0,
      bounds.worldHeight - visualBottomOffset + bottomPenetration,
    );
  }

  function heightScaleForLocalY(y) {
    return rockScaleForY(y, bounds.maxY, {
      easing: params.rockScaleEasing,
      minWidthVw: params.rockMinWidthVw,
      maxWidthVw: params.rockMaxWidthVw,
      baseWidthPx: bounds.rockWidth,
      viewportWidthPx: bounds.worldWidth,
    });
  }

  function baseScaleForLocalY(y) {
    if (!preclickRockGuidance.completed) {
      return heightScaleForLocalY(y);
    }
    return heightScaleForLocalY(
      motion.sceneTwoSizeState === "ground" ? bounds.maxY : 0,
    );
  }

  function scaleForLocalY(y) {
    return baseScaleForLocalY(y) * motion.rockActivationScaleFactor;
  }

  function visualShrinkScaleFactor() {
    if (motion.rockPressActive) {
      return rockPressScaleFactor(params.rockPressShrinkPercent);
    }
    return motion.rockPulseScaleFactor;
  }

  function visualScaleForLocalY(y) {
    return scaleForLocalY(y) * visualShrinkScaleFactor();
  }

  function stopRockPulse() {
    if (motion.rockPulseAnimationId !== null) {
      window.cancelAnimationFrame(motion.rockPulseAnimationId);
      motion.rockPulseAnimationId = null;
    }
    motion.rockPulseScaleFactor = 1;
    applyRockScale();
  }

  function renderRockPulse(now) {
    motion.rockPulseAnimationId = null;
    if (
      !params.rockPulseEnabled ||
      document.hidden ||
      motion.sceneTwoSizeState !== "airborne"
    ) {
      motion.rockPulseScaleFactor = 1;
      applyRockScale();
      return;
    }
    motion.rockPulseScaleFactor = rockPulseScaleFactor(
      rockPulseProgress(now, motion.rockPulseStartedAt, params.rockPulseBpm),
      params.rockPulseShrinkPercent,
    );
    applyRockScale();
    motion.rockPulseAnimationId = window.requestAnimationFrame(renderRockPulse);
  }

  function syncRockPulse() {
    if (
      !params.rockPulseEnabled ||
      document.hidden ||
      motion.sceneTwoSizeState !== "airborne"
    ) {
      stopRockPulse();
      return;
    }
    if (motion.rockPulseAnimationId === null) {
      motion.rockPulseStartedAt = performance.now();
      motion.rockPulseAnimationId = window.requestAnimationFrame(renderRockPulse);
    }
  }

  function activateRockPress() {
    if (motion.rockPressActive) {
      return;
    }
    motion.rockPressActive = true;
    applyRockScale();
  }

  function releaseRockPress() {
    if (!motion.rockPressActive) {
      return;
    }
    motion.rockPressActive = false;
    applyRockScale();
  }

  function clearSceneTwoPressTimer() {
    if (motion.sceneTwoPressTimerId !== null) {
      window.clearTimeout(motion.sceneTwoPressTimerId);
      motion.sceneTwoPressTimerId = null;
    }
  }

  function transitionSceneTwoRockScale() {
    clearRockActivationScaleTransition();
    if (!reducedMotion.matches) {
      rock.classList.add("is-activation-scaling");
      void rock.offsetWidth;
    }
    applyRockScale();
    if (!reducedMotion.matches) {
      motion.rockActivationScaleTimerId = window.setTimeout(() => {
        motion.rockActivationScaleTimerId = null;
        rock.classList.remove("is-activation-scaling");
      }, ROCK_ACTIVATION_SCALE_DURATION_MS);
    }
  }

  function beginSceneTwoGrabScale() {
    if (!preclickRockGuidance.completed) {
      activateRockPress();
      return;
    }
    clearSceneTwoPressTimer();
    releaseRockPress();
    stopRockPulse();
    motion.sceneTwoSizeState = "held";
    motion.sceneTwoSizeCycleArmed = true;
    motion.rockActivationArmed = false;
    motion.physicsActivated = false;
    motion.rockActivationScaleFactor = 1;
    transitionSceneTwoRockScale();
    motion.sceneTwoPressTimerId = window.setTimeout(() => {
      motion.sceneTwoPressTimerId = null;
      if (motion.sceneTwoSizeState === "held" && motion.dragging) {
        activateRockPress();
      }
    }, reducedMotion.matches ? 0 : ROCK_ACTIVATION_SCALE_DURATION_MS);
  }

  function beginSceneTwoAirborneScale({ armGroundReset = true } = {}) {
    if (!preclickRockGuidance.completed) {
      releaseRockPress();
      return;
    }
    clearSceneTwoPressTimer();
    releaseRockPress();
    motion.sceneTwoSizeState = "airborne";
    motion.sceneTwoSizeCycleArmed =
      motion.sceneTwoSizeCycleArmed || armGroundReset;
    motion.rockActivationArmed = false;
    motion.physicsActivated = false;
    motion.rockActivationScaleFactor = 1;
    transitionSceneTwoRockScale();
    syncRockPulse();
  }

  function settleSceneTwoRockScaleOnGround() {
    if (!preclickRockGuidance.completed || !motion.sceneTwoSizeCycleArmed) {
      return false;
    }
    clearSceneTwoPressTimer();
    motion.sceneTwoSizeState = "ground";
    motion.sceneTwoSizeCycleArmed = false;
    releaseRockPress();
    stopRockPulse();
    transitionSceneTwoRockScale();
    return true;
  }

  function applyRockImageSettings() {
    const imageId = params.rockImageId;
    const imageSource = rockImageUrl(imageId);
    const imageChanged = rock.dataset.rockImageId !== imageId;
    const resolvedImageSource = new URL(imageSource, window.location.href).href;

    if (imageChanged && rock.src !== resolvedImageSource) {
      rock.addEventListener(
        "load",
        () => {
          if (disposed) {
            return;
          }
          updateBounds();
          applyRockScale();
          renderImprint();
        },
        { once: true },
      );
    }

    rock.dataset.rockImageId = imageId;
    rockImprint.dataset.rockImageId = imageId;
    rock.src = imageSource;
    rockImprint.src = imageSource;
  }

  function clearRockActivationScaleTransition() {
    if (motion.rockActivationScaleTimerId !== null) {
      window.clearTimeout(motion.rockActivationScaleTimerId);
      motion.rockActivationScaleTimerId = null;
    }
    rock.classList.remove("is-activation-scaling");
  }

  function resetRockActivationScale() {
    clearRockActivationScaleTransition();
    motion.rockActivationArmed = false;
    motion.physicsActivated = false;
    motion.rockActivationScaleFactor = 1;
  }

  function armRockActivationScale() {
    if (!motion.physicsActivated) {
      motion.rockActivationArmed = true;
    }
  }

  function maybeActivateRockPhysicsScale({ dragging, suspended, vy }) {
    if (
      !motion.rockActivationArmed ||
      motion.physicsActivated ||
      dragging ||
      suspended ||
      !(Number(vy) > 0)
    ) {
      return false;
    }
    return activateRockPhysicsScale();
  }

  function activateRockPhysicsScale({ immediate = false } = {}) {
    if (motion.physicsActivated) {
      return false;
    }
    updateBounds();
    const baseScale = baseScaleForLocalY(motion.y);
    const factor = rockActivationScaleFactor(baseScale, {
      targetWidthVw: params.rockActivatedWidthVw,
      baseWidthPx: bounds.rockWidth,
      viewportWidthPx: bounds.worldWidth,
    });
    clearRockActivationScaleTransition();
    if (!reducedMotion.matches && !immediate) {
      rock.classList.add("is-activation-scaling");
      void rock.offsetWidth;
    }
    motion.physicsActivated = true;
    motion.rockActivationScaleFactor = factor;
    applyRockScale();
    if (!reducedMotion.matches && !immediate) {
      motion.rockActivationScaleTimerId = window.setTimeout(() => {
        motion.rockActivationScaleTimerId = null;
        rock.classList.remove("is-activation-scaling");
      }, ROCK_ACTIVATION_SCALE_DURATION_MS);
    }
    return true;
  }

  function applyRockScale() {
    updateBounds();
    const baseScale = scaleForLocalY(motion.y);
    const scale = baseScale * visualShrinkScaleFactor();
    const roundedScale = Math.round(scale * 10000) / 10000;
    const wallCompensation = rockHorizontalWallCompensation(
      motion.x,
      bounds.maxX,
      bounds.rockWidth,
      scale,
      params.rockWallPenetrationPercent,
    );
    motion.rockScale = baseScale;
    rock.style.setProperty("--rock-scale", `${roundedScale}`);
    rock.style.setProperty(
      "--rock-wall-compensation",
      `${Math.round(wallCompensation * 10000) / 10000}px`
    );
  }

  function setPosition(x, y) {
    updateBounds();
    motion.x = clamp(x, 0, bounds.maxX);
    motion.y = clamp(y, 0, bounds.maxY);
    const wallContact =
      motion.x <= 0.5 ? "left" : motion.x >= bounds.maxX - 0.5 ? "right" : null;
    if (
      preclickRockGuidance.completed &&
      wallContact &&
      wallContact !== motion.wallContact
    ) {
      playWallImpactSound();
    }
    motion.wallContact = wallContact;
    rock.style.setProperty("--rock-x", `${motion.x}px`);
    rock.style.setProperty("--rock-y", `${motion.y}px`);
    requestFoldSync();
    applyRockScale();
    syncDrizzleLoopVolume();
  }

  function createSummitSharedImprint(input = {}) {
    updateBounds();
    const targetVisualCenterY =
      window.innerHeight * SUMMIT_IMPRINT_TOP_VIEWPORT_FRACTION;
    const targetY = clamp(
      targetVisualCenterY - bounds.rockHeight / 2,
      0,
      bounds.maxY
    );
    const position = localToCanonical(
      bounds.maxX / 2,
      targetY
    );
    const source = input && typeof input === "object" ? input : {};
    return SharedPhysics.createSummitImprint({
      ...source,
      y: position.y,
    });
  }

  function activeLocalImprint() {
    updateBounds();
    if (collab.enabled) {
      const imprint = SharedPhysics.sanitizeImprint(collab.imprint);
      if (!imprint) {
        return null;
      }
      const position = canonicalToLocal(imprint.x, imprint.y);
      return {
        ...position,
        scale: scaleForLocalY(position.y),
        toleranceX:
          (imprint.toleranceX / SharedPhysics.WORLD_WIDTH) * bounds.maxX,
        toleranceY:
          (imprint.toleranceY / SharedPhysics.WORLD_HEIGHT) * bounds.maxY,
      };
    }
    return motion.imprint
      ? {
          ...motion.imprint,
          scale: scaleForLocalY(motion.imprint.y),
        }
      : null;
  }

  function renderImprint() {
    const imprint = activeLocalImprint();
    rockImprint.classList.remove("is-visible");
    if (!imprint) {
      rockImprint.style.setProperty("--imprint-scale", "1");
      return;
    }
    rockImprint.style.setProperty("--imprint-x", `${imprint.x}px`);
    rockImprint.style.setProperty("--imprint-y", `${imprint.y}px`);
    const roundedScale = Math.round(imprint.scale * 10000) / 10000;
    rockImprint.style.setProperty("--imprint-scale", `${roundedScale}`);
    rockImprint.classList.add("is-visible");
  }

  function setGrabPointFromPointer(event) {
    updateBounds();
    const rect = rock.getBoundingClientRect();
    const scaleX =
      bounds.rockWidth > 0 && rect.width > 0 ? rect.width / bounds.rockWidth : 1;
    const scaleY =
      bounds.rockHeight > 0 && rect.height > 0 ? rect.height / bounds.rockHeight : 1;
    motion.grabX = clamp(
      (event.clientX - rect.left) / scaleX,
      0,
      bounds.rockWidth
    );
    motion.grabY = clamp(
      (event.clientY - rect.top) / scaleY,
      0,
      bounds.rockHeight
    );
  }

  function setDragTargetFromPointer(event) {
    updateBounds();
    const targetPointX = event.clientX + window.scrollX;
    const targetPointY = event.clientY + window.scrollY;
    let targetY = motion.dragTargetY;

    for (let index = 0; index < 5; index += 1) {
      const scale = visualScaleForLocalY(targetY);
      const scaledOffsetY = (bounds.rockHeight * (1 - scale)) / 2;
      targetY = clamp(
        targetPointY - scaledOffsetY - motion.grabY * scale,
        0,
        bounds.maxY
      );
    }

    const scale = visualScaleForLocalY(targetY);
    motion.dragTargetX = rockLocalXForVisualGrab(
      targetPointX,
      motion.grabX,
      bounds.maxX,
      bounds.rockWidth,
      scale
    );
    motion.dragTargetY = targetY;
  }

  function applyDragTargetMovement(deltaSeconds) {
    if (!motion.dragging) {
      return;
    }

    const progress = SharedPhysics.dragFollowProgress(params, deltaSeconds, {
      forceDeficitCurve: handForceDeficitCurve,
    });
    const nextX = motion.x + (motion.dragTargetX - motion.x) * progress;
    const desiredY = motion.y + (motion.dragTargetY - motion.y) * progress;
    const nextY = constrainLocalHeightGateY(motion.y, desiredY);
    setPosition(
      nextX,
      nextY,
    );
  }

  function initialLocalPosition() {
    updateBounds();
    const viewportCenterY = bounds.worldHeight - window.innerHeight / 2;
    return {
      x: bounds.maxX / 2,
      y: clamp(viewportCenterY - bounds.rockHeight / 2, 0, bounds.maxY),
    };
  }

  function centerIntroRock() {
    const position = initialLocalPosition();
    setPosition(position.x, position.y);
  }

  function syncAfterScroll() {
    syncSummitRainScroll();
    ensureTrailCanvasSize();
    trail.sessionDirty = true;
    trail.glowDirty = true;
    scheduleTrailRender();
  }

  function scrollToSceneBottom() {
    window.requestAnimationFrame(() => {
      if (disposed) {
        return;
      }
      window.scrollTo(0, document.documentElement.scrollHeight);
      syncAfterScroll();
    });
  }

  function restoreReloadViewportAfterSnapshot(snapshot) {
    if (!reloadViewportRestorePending) {
      return;
    }
    reloadViewportRestorePending = false;
    if (!snapshot?.suspended) {
      return;
    }
    // Высота комнаты приходит с первым snapshot. Прокрутку выполняем один раз
    // после применения настроек и пересчёта геометрии сцены.
    scrollToSceneBottom();
  }

  function updateCameraFollow({ immediate = false } = {}) {
    if (
      !preclickRockGuidance.completed ||
      motion.phase === PHASES.INTRO
    ) {
      return;
    }

    const rect = rock.getBoundingClientRect();
    const targetScrollY = cameraTargetScrollY({
      rockCenterDocumentY:
        window.scrollY + rect.top + rect.height / 2,
      viewportHeight: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
    });
    const nextScrollY = immediate
      ? targetScrollY
      : cameraFollowDirectionalScrollY({
          currentScrollY: window.scrollY,
          targetScrollY,
          lerp: params.cameraFollowLerp,
          followUp: params.upperZoneAutoScrollEnabled,
          followDown: params.cameraFollowDownEnabled,
        });
    if (nextScrollY === window.scrollY) {
      return;
    }

    window.scrollTo(0, nextScrollY);
    syncAfterScroll();
  }

  function setSessionStatus(text, state = "local") {
    if (!sessionStatus) {
      return;
    }
    sessionStatus.textContent = text;
    sessionStatus.dataset.state = state;
  }

  function updateSessionStatus() {
    const status = deriveSessionStatus({
      ...collab,
      holderId: collab.holderId,
      liftReady: Boolean(collab.holderId) && SharedPhysics.canLift(params),
    });
    setSessionStatus(status.text, status.state);
  }

  function appUrl(relativePath) {
    const normalizedPath = String(relativePath || "").replace(/^\/+/, "");
    return new URL(`/${normalizedPath}`, window.location.origin);
  }

  function updateSettingsLink() {
    if (!settingsLink) {
      return;
    }
    const url = appUrl("settings/");
    if (collab.sessionId) {
      url.searchParams.set("session", collab.sessionId);
    }
    settingsLink.href = `${url.pathname}${url.search}`;
  }

  function localToCanonical(x, y) {
    updateBounds();
    return localToCanonicalPosition(
      x,
      y,
      bounds,
      SharedPhysics.WORLD_WIDTH,
      SharedPhysics.WORLD_HEIGHT,
    );
  }

  function canonicalToLocal(x, y) {
    updateBounds();
    return canonicalToLocalPosition(
      x,
      y,
      bounds,
      SharedPhysics.WORLD_WIDTH,
      SharedPhysics.WORLD_HEIGHT,
    );
  }

  function viewportPointToCanonical(clientX, clientY) {
    const rect = world.getBoundingClientRect();
    updateBounds();
    const localY = clientY - rect.top;
    return {
      x:
        rect.width > 0
          ? clamp(
              ((clientX - rect.left) / rect.width) * SharedPhysics.WORLD_WIDTH,
              0,
              SharedPhysics.WORLD_WIDTH
            )
          : SharedPhysics.WORLD_WIDTH / 2,
      y:
        bounds.maxY > 0
          ? clamp(
              (localY / bounds.maxY) * SharedPhysics.WORLD_HEIGHT,
              0,
              SharedPhysics.WORLD_HEIGHT
            )
          : 0,
    };
  }

  function pointerIsOverRock(event) {
    if (!event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      return false;
    }
    const target = document.elementFromPoint(event.clientX, event.clientY);
    return target === rock || rock.contains(target);
  }

  function normalizeHolderId(holderId) {
    const normalized = String(holderId || "");
    return normalized || null;
  }

  function updateSharedHolder(holderId) {
    collab.holderId = normalizeHolderId(holderId);
  }

  function localIsHolder() {
    return collab.holderId === collab.clientId;
  }

  function sharedDragActive() {
    return localIsHolder();
  }

  function updateLocalSharedPointer(event, mode, visible) {
    if (event) {
      const position = viewportPointToCanonical(event.clientX, event.clientY);
      const viewport = currentViewport();
      const rockOffset = viewportToRockRelativePosition(
        event.clientX,
        event.clientY,
        rock.getBoundingClientRect(),
        viewport?.width || window.innerWidth,
        viewport?.height || window.innerHeight,
      );
      collab.localPointer.x = position.x;
      collab.localPointer.y = position.y;
      collab.localPointer.rockOffsetX = rockOffset.x;
      collab.localPointer.rockOffsetY = rockOffset.y;
    }
    collab.localPointer.mode = mode === "grabbing" ? "grabbing" : "grab";
    collab.localPointer.visible = Boolean(visible);
    return { ...collab.localPointer };
  }

  function sendSharedPointer(event, mode, visible, force = false) {
    const payload = updateLocalSharedPointer(event, mode, visible);
    if (!collab.enabled || !collab.connected) {
      return payload;
    }
    const now = performance.now();
    if (!force && now - collab.lastPointerSentAt < POINTER_SEND_INTERVAL_MS) {
      return payload;
    }
    collab.lastPointerSentAt = now;
    sendShared("pointer.update", payload);
    return payload;
  }

  function removeRemotePointer(clientId) {
    const pointer = collab.remotePointers.get(clientId);
    if (!pointer) {
      return;
    }
    pointer.element.remove();
    collab.remotePointers.delete(clientId);
  }

  function clearRemotePointers() {
    collab.remotePointers.forEach((pointer) => pointer.element.remove());
    collab.remotePointers.clear();
  }

  function receiveRemotePointer(payload) {
    if (!payload || payload.clientId === collab.clientId) {
      return;
    }
    const clientId = String(payload.clientId || "");
    const x = Number(payload.x);
    const y = Number(payload.y);
    const rockOffsetX = Number(payload.rockOffsetX);
    const rockOffsetY = Number(payload.rockOffsetY);
    const hasRockOffset =
      Number.isFinite(rockOffsetX) && Number.isFinite(rockOffsetY);
    const mode = payload.mode;
    if (
      !clientId ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      x > SharedPhysics.WORLD_WIDTH ||
      y < 0 ||
      y > SharedPhysics.WORLD_HEIGHT ||
      !["grab", "grabbing"].includes(mode)
    ) {
      return;
    }
    if (!payload.visible) {
      removeRemotePointer(clientId);
      return;
    }

    let pointer = collab.remotePointers.get(clientId);
    if (!pointer) {
      const element = document.createElement("div");
      element.className = "hand-cursor is-remote is-visible";
      element.dataset.remoteCursor = clientId;
      element.dataset.testid = "remote-cursor";
      remoteCursorLayer.appendChild(element);
      pointer = {
        element,
        x,
        y,
        targetX: x,
        targetY: y,
        rockOffsetX: hasRockOffset ? rockOffsetX : null,
        rockOffsetY: hasRockOffset ? rockOffsetY : null,
        targetRockOffsetX: hasRockOffset ? rockOffsetX : null,
        targetRockOffsetY: hasRockOffset ? rockOffsetY : null,
      };
      collab.remotePointers.set(clientId, pointer);
    }
    pointer.targetX = x;
    pointer.targetY = y;
    pointer.targetRockOffsetX = hasRockOffset ? rockOffsetX : null;
    pointer.targetRockOffsetY = hasRockOffset ? rockOffsetY : null;
    if (
      hasRockOffset &&
      (!Number.isFinite(pointer.rockOffsetX) ||
        !Number.isFinite(pointer.rockOffsetY))
    ) {
      pointer.rockOffsetX = rockOffsetX;
      pointer.rockOffsetY = rockOffsetY;
    }
    pointer.element.classList.toggle("is-grabbing", mode === "grabbing");
  }

  function syncRemotePointers(pointers) {
    const visibleIds = new Set();
    if (Array.isArray(pointers)) {
      pointers.forEach((pointer) => {
        if (pointer && pointer.visible && pointer.clientId !== collab.clientId) {
          visibleIds.add(String(pointer.clientId));
        }
        receiveRemotePointer(pointer);
      });
    }
    [...collab.remotePointers.keys()].forEach((clientId) => {
      if (!visibleIds.has(clientId)) {
        removeRemotePointer(clientId);
      }
    });
  }

  function renderRemotePointers() {
    if (collab.remotePointers.size === 0) {
      return;
    }
    const rect = world.getBoundingClientRect();
    const viewport = currentViewport();
    updateBounds();
    collab.remotePointers.forEach((pointer) => {
      pointer.x += (pointer.targetX - pointer.x) * 0.42;
      pointer.y += (pointer.targetY - pointer.y) * 0.42;
      let viewportPosition;
      if (
        Number.isFinite(pointer.targetRockOffsetX) &&
        Number.isFinite(pointer.targetRockOffsetY)
      ) {
        pointer.rockOffsetX +=
          (pointer.targetRockOffsetX - pointer.rockOffsetX) * 0.42;
        pointer.rockOffsetY +=
          (pointer.targetRockOffsetY - pointer.rockOffsetY) * 0.42;
        viewportPosition = rockRelativeToViewportPosition(
          pointer.rockOffsetX,
          pointer.rockOffsetY,
          rock.getBoundingClientRect(),
          viewport?.width || window.innerWidth,
          viewport?.height || window.innerHeight,
        );
      } else {
        const local = canonicalToLocal(pointer.x, pointer.y);
        viewportPosition = {
          x: rect.left + local.x,
          y: rect.top + local.y,
        };
      }
      pointer.element.style.setProperty(
        "--cursor-x",
        `${viewportPosition.x}px`,
      );
      pointer.element.style.setProperty(
        "--cursor-y",
        `${viewportPosition.y}px`,
      );
    });
  }

  function localVelocityToCanonical(vx, vy) {
    updateBounds();
    return {
      vx: bounds.maxX > 0 ? (vx / bounds.maxX) * SharedPhysics.WORLD_WIDTH : 0,
      vy: bounds.maxY > 0 ? (vy / bounds.maxY) * SharedPhysics.WORLD_HEIGHT : 0,
    };
  }

  function canonicalVelocityToLocal(vx, vy) {
    updateBounds();
    return {
      vx: (vx / SharedPhysics.WORLD_WIDTH) * bounds.maxX,
      vy: (vy / SharedPhysics.WORLD_HEIGHT) * bounds.maxY,
    };
  }

  function sharedRoomSettingsPayload() {
    return SharedRoomSettings.sanitizeRoomSettings(
      Object.fromEntries(
        SHARED_ROOM_SETTING_KEYS.map((key) => [key, params[key]])
      ),
      params
    );
  }

  function currentSharedState() {
    const position = localToCanonical(motion.x, motion.y);
    const velocity = localVelocityToCanonical(motion.vx, motion.vy);
    return {
      phase: motion.phase,
      x: position.x,
      y: position.y,
      vx: velocity.vx,
      vy: velocity.vy,
      suspended: motion.suspended,
      turbTime: motion.turbTime,
    };
  }

  function applyCanonicalMotion(state) {
    const position = state.suspended
      ? initialLocalPosition()
      : canonicalToLocal(state.x, state.y);
    const velocity = canonicalVelocityToLocal(state.vx, state.vy);
    setPosition(position.x, position.y);
    motion.vx = velocity.vx;
    motion.vy = velocity.vy;
    motion.suspended = Boolean(state.suspended);
    motion.turbTime = state.turbTime;
  }

  function initialSharedState() {
    const position = initialLocalPosition();
    const canonical = localToCanonical(position.x, position.y);
    return {
      phase: PHASES.PLAY,
      x: canonical.x,
      y: canonical.y,
      vx: 0,
      vy: 0,
      suspended: true,
      turbTime: 0,
    };
  }

  function trailProjectionOptions() {
    return {
      viewportWidth: bounds.worldWidth,
      sceneHeight: bounds.worldHeight,
      worldWidth: SharedPhysics.WORLD_WIDTH,
      worldHeight: SharedPhysics.WORLD_HEIGHT,
    };
  }

  function normalizeSharedTrailPoints(points) {
    if (!Array.isArray(points)) {
      return [];
    }
    return points.flatMap((point) => {
      const normalized = normalizeStoredTrailPoint(point, {
        worldWidth: SharedPhysics.WORLD_WIDTH,
        worldHeight: SharedPhysics.WORLD_HEIGHT,
      });
      return normalized ? [normalized] : [];
    });
  }

  function sharedTrailPointToLocal(point) {
    const visualPoint = canonicalVisualTrailPointToLocal(
      point,
      trailProjectionOptions(),
    );
    if (visualPoint) {
      return visualPoint;
    }

    // Legacy points are rock top-left positions. Keep them readable while all
    // newly recorded points use the exact visual anchor (v2).
    const localX =
      (point[0] / SharedPhysics.WORLD_WIDTH) * bounds.maxX;
    const localY =
      (point[1] / SharedPhysics.WORLD_HEIGHT) * bounds.maxY;
    const scale = scaleForLocalY(localY);
    return trailAnchorPoint({
      x:
        localX +
        rockHorizontalWallCompensation(
          localX,
          bounds.maxX,
          bounds.rockWidth,
          scale,
          params.rockWallPenetrationPercent,
        ),
      y: localY,
      width: bounds.rockWidth,
      height: bounds.rockHeight,
      scale,
      heightPercent: params.trailAnchorHeightPercent,
    });
  }

  function sharedTrailPointsToLocal(points) {
    updateBounds();
    return normalizeSharedTrailPoints(points).map(sharedTrailPointToLocal);
  }

  function syncTrailTail() {
    const last = trail.points.at(-1);
    trail.lastX = last ? last.x : null;
    trail.lastY = last ? last.y : null;
    trail.followX = trail.lastX;
    trail.followY = trail.lastY;
  }

  function loadSharedTrail(points) {
    trail.historyCanonical = normalizeSharedTrailPoints(points).slice(
      -effectiveTrailLimit(),
    );
    trail.historyPoints = sharedTrailPointsToLocal(trail.historyCanonical);
    trail.sessionCanonical = [];
    trail.sessionPoints = [];
    trail.canonicalPoints = trail.historyCanonical.slice();
    trail.points = trail.historyPoints.slice();
    trimTrailToLimit();
    syncTrailTail();
    trail.dirty = true;
    trail.sessionDirty = true;
    trail.glowDirty = true;
    scheduleTrailRender();
  }

  function appendSharedTrail(points) {
    const canonicalPoints = normalizeSharedTrailPoints(points);
    if (canonicalPoints.length === 0) {
      return;
    }
    const appended = sharedTrailPointsToLocal(canonicalPoints);
    trail.sessionCanonical.push(...canonicalPoints);
    trail.sessionPoints.push(...appended);
    trail.canonicalPoints.push(...canonicalPoints);
    trail.points.push(...appended);
    trimTrailToLimit();
    syncTrailTail();
    trail.sessionDirty = true;
    trail.glowDirty = true;
    checkpointTrailIfNeeded();
    scheduleTrailRender();
  }

  function reprojectTrail() {
    if (trail.canonicalPoints.length === 0) {
      return;
    }
    trail.historyPoints = sharedTrailPointsToLocal(trail.historyCanonical);
    trail.sessionPoints = sharedTrailPointsToLocal(trail.sessionCanonical);
    trail.points = [...trail.historyPoints, ...trail.sessionPoints];
    trimTrailToLimit();
    syncTrailTail();
    trail.dirty = true;
    trail.sessionDirty = true;
    trail.glowDirty = true;
    scheduleTrailRender();
  }

  function applySharedPhysics(physics) {
    if (!physics || typeof physics !== "object") {
      return;
    }
    const signature = SHARED_PHYSICS_KEYS.map((key) =>
      Number(physics[key])
    ).join(":");
    collab.physicsSignature = signature;
    if (!settingsUiEnabled) {
      const changedKeys = [];
      SHARED_PHYSICS_KEYS.forEach((key) => {
        const remoteValue = Number(physics[key]);
        if (!Number.isFinite(remoteValue)) {
          return;
        }
        if (Math.abs(Number(params[key]) - remoteValue) >= 1e-9) {
          params[key] = remoteValue;
          changedKeys.push(key);
        }
      });
      if (changedKeys.length > 0) {
        collab.applyingRemotePhysics = true;
        try {
          applyCurrentSettings({
            ...settingsChangeContext({ changedKeys }),
            previousRoomSettings: null,
            preservedState: null,
            preserveBottomScroll: false,
          });
        } finally {
          collab.applyingRemotePhysics = false;
        }
      }
      return;
    }
    let controlsChanged = false;
    SHARED_PHYSICS_KEYS.forEach((key) => {
      const remoteValue = Number(physics[key]);
      if (!Number.isFinite(remoteValue)) {
        return;
      }
      if (Object.hasOwn(collab.pendingPhysicsChanges, key)) {
        if (
          Math.abs(
            Number(collab.pendingPhysicsChanges[key]) - remoteValue
          ) < 1e-9
        ) {
          delete collab.pendingPhysicsChanges[key];
          collab.stagedPhysicsChangeKeys.delete(key);
        } else {
          return;
        }
      }
      const input = settingsController.roomSettingControlElement(key);
      if (input && Number(input.value) !== remoteValue) {
        input.value = String(remoteValue);
        controlsChanged = true;
      }
    });
    if (controlsChanged) {
      collab.applyingRemotePhysics = true;
      try {
        readControls();
      } finally {
        collab.applyingRemotePhysics = false;
      }
    }
  }

  function roomSettingValueEqual(key, left, right) {
    if (key === "heightGates") {
      return (
        JSON.stringify(SharedRoomSettings.sanitizeHeightGates(left)) ===
        JSON.stringify(SharedRoomSettings.sanitizeHeightGates(right))
      );
    }
    if (BOOLEAN_ROOM_SETTING_KEYS.has(key)) {
      const leftBool = left === true || left === "true";
      const rightBool = right === true || right === "true";
      return leftBool === rightBool;
    }
    if (NUMERIC_ROOM_SETTING_KEYS.has(key)) {
      return Math.abs(Number(left) - Number(right)) < 1e-9;
    }
    return String(left || "").toLowerCase() === String(right || "").toLowerCase();
  }

  function roomSettingsSignature(settings) {
    const clean = SharedRoomSettings.sanitizeRoomSettings(settings, params);
    return JSON.stringify(clean);
  }

  function applySharedRoomSettings(roomSettings) {
    if (!roomSettings || typeof roomSettings !== "object") {
      return;
    }
    const clean = SharedRoomSettings.sanitizeRoomSettings(roomSettings, params);
    collab.roomSettingsSignature = roomSettingsSignature(clean);
    const changedKeys = [];
    const previousRoomSettings = sharedRoomSettingsPayload();
    const preservedState = !settingsUiEnabled
      ? currentSharedState()
      : null;
    SHARED_ROOM_SETTING_KEYS.forEach((key) => {
      const remoteValue = clean[key];
      if (Object.hasOwn(collab.pendingRoomSettingsChanges, key)) {
        if (
          roomSettingValueEqual(
            key,
            collab.pendingRoomSettingsChanges[key],
            remoteValue
          )
        ) {
          delete collab.pendingRoomSettingsChanges[key];
          collab.stagedRoomSettingsChangeKeys.delete(key);
        } else {
          return;
        }
      }
      if (!settingsUiEnabled) {
        if (!roomSettingValueEqual(key, params[key], remoteValue)) {
          params[key] = remoteValue;
          changedKeys.push(key);
        }
        return;
      }
      const input = settingsController.roomSettingControlElement(key);
      const currentValue = controlValueToSettingValue(input, key);
      if (input && !roomSettingValueEqual(key, currentValue, remoteValue)) {
        if (input.type === "checkbox") {
          input.checked = Boolean(remoteValue);
        } else {
          input.value = settingValueToControlValue(key, remoteValue);
          input.dispatchEvent(new Event("settings-control-sync"));
        }
        changedKeys.push(key);
      }
    });
    if (changedKeys.length > 0) {
      if (!settingsUiEnabled) {
        collab.applyingRemoteRoomSettings = true;
        try {
          applyCurrentSettings({
            ...settingsChangeContext({ changedKeys }),
            previousRoomSettings,
            preservedState,
            preserveBottomScroll: false,
          });
        } finally {
          collab.applyingRemoteRoomSettings = false;
        }
        return;
      }
      collab.applyingRemoteRoomSettings = true;
      try {
        readControls({ changedKeys });
        applyRainSettings({ restartIfActive: true });
      } finally {
        collab.applyingRemoteRoomSettings = false;
      }
    }
  }

  function scheduleSharedPhysicsUpdate() {
    scheduleSharedSettingsUpdate();
  }

  function scheduleSharedRoomSettingsUpdate() {
    scheduleSharedSettingsUpdate();
  }

  function sharedSettingsPayload() {
    return {
      ...SharedRoomSettings.sanitizeRoomSettings(params),
      ...SharedPhysics.sanitizePhysics(params),
    };
  }

  function settingsUpdateRequestId() {
    const random =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    return `settings-${Date.now().toString(36)}-${random}`;
  }

  function scheduleSharedSettingsUpdate() {
    if (
      !collab.enabled ||
      !localCanEditSettings() ||
      collab.applyingRemotePhysics ||
      collab.applyingRemoteRoomSettings
    ) {
      return;
    }
    collab.settingsUpdateQueued = true;
    if (!collab.connected) {
      return;
    }
    window.clearTimeout(collab.settingsUpdateTimerId);
    collab.settingsUpdateTimerId = window.setTimeout(() => {
      collab.settingsUpdateTimerId = null;
      flushSharedSettingsUpdate();
    }, 100);
  }

  function flushSharedSettingsUpdate() {
    if (
      !collab.connected ||
      collab.settingsUpdateInFlight ||
      !collab.settingsUpdateQueued ||
      !Number.isSafeInteger(collab.settingsRevision) ||
      collab.settingsRevision < 1
    ) {
      return false;
    }
    const requestId = settingsUpdateRequestId();
    const payload = {
      requestId,
      baseRevision: collab.settingsRevision,
      settingsSchemaVersion: SharedRoomSettings.ROOM_SETTINGS_VERSION,
      settings: sharedSettingsPayload(),
    };
    collab.settingsUpdateQueued = false;
    collab.settingsUpdateInFlight = { requestId, settings: payload.settings };
    if (!sendShared("settings.update", payload)) {
      collab.settingsUpdateInFlight = null;
      collab.settingsUpdateQueued = true;
      return false;
    }
    return true;
  }

  function settleSharedSettingsUpdate(payload = {}, conflict = false) {
    const requestId = String(payload.requestId || "");
    if (collab.settingsUpdateInFlight?.requestId !== requestId) {
      return false;
    }
    collab.settingsUpdateInFlight = null;
    collab.settingsRevision = Math.max(
      1,
      Number(payload.settingsRevision) || collab.settingsRevision,
    );
    if (!collab.settingsUpdateQueued) {
      Object.keys(collab.pendingPhysicsChanges).forEach((key) => {
        if (!collab.stagedPhysicsChangeKeys.has(key)) {
          delete collab.pendingPhysicsChanges[key];
        }
      });
      Object.keys(collab.pendingRoomSettingsChanges).forEach((key) => {
        if (!collab.stagedRoomSettingsChangeKeys.has(key)) {
          delete collab.pendingRoomSettingsChanges[key];
        }
      });
    }
    if (conflict && payload.settings) {
      applySharedPhysics(payload.settings);
      applySharedRoomSettings(payload.settings);
    }
    if (collab.settingsUpdateQueued) {
      scheduleSharedSettingsUpdate();
    }
    return true;
  }

  function recoverExpiredSharedSession(socket = null) {
    if (socket && collab.socket === socket) {
      collab.socket = null;
    }
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(4004, "session_not_found");
    }

    collab.expired = true;
    collab.restoringStoredSession = false;
    collab.connected = false;
    collab.sessionId = "";
    collab.leaveToken = null;
    collab.sequence = 0;
    collab.lastRevision = -1;
    collab.clockOffset = 0;
    collab.clockOffsetReady = false;
    collab.snapshots = [];
    collab.trailCursor = 0;
    collab.trailWriterId = null;
    clearTrailNetworkQueue();
    collab.groundTouchSeq = null;
    collab.settingsRevision = 0;
    collab.settingsUpdateInFlight = null;
    collab.settingsUpdateQueued =
      collab.settingsUpdateQueued ||
      Object.keys(collab.pendingPhysicsChanges).length > 0 ||
      Object.keys(collab.pendingRoomSettingsChanges).length > 0;
    collab.holderId = null;
    collab.remoteControllerId = null;
    collab.hasControl = false;
    collab.pendingControl = false;
    collab.releasePending = false;
    collab.firstFallRequestSent = false;
    clearSharedReleaseHandoff();
    cancelSharedLocalDrag();
    clearRemotePointers();
    resetHeightGateState();
    try {
      sessionStorage.removeItem("sisyphus-room-session-id");
    } catch {
      /* sessionStorage недоступен */
    }

    if (disposed) {
      return;
    }
    setSessionStatus("Сессия недействительна, создаём новую…", "connecting");
    void createSharedSession();
  }

  async function createSharedSession() {
    if (disposed || collab.sessionCreateInFlight) {
      return;
    }
    if (collab.enabled && collab.connected && !collab.expired) {
      return;
    }
    if (window.location.protocol === "file:") {
      setSessionStatus("Для ссылки запустите приложение через Docker", "error");
      return;
    }

    collab.sessionCreateInFlight = true;
    const abortController = new AbortController();
    collab.sessionCreateAbortController = abortController;
    setSessionStatus("Создаём личную сессию…", "connecting");
    try {
      let storedSessionId = "";
      try {
        storedSessionId = sessionStorage.getItem("sisyphus-room-session-id") || "";
      } catch {
        storedSessionId = "";
      }
      if (/^[A-Za-z0-9_-]{22}$/.test(storedSessionId)) {
        collab.restoringStoredSession = true;
        collab.sessionId = storedSessionId;
        updateSettingsLink();
        connectSharedSession();
        return;
      }
      const response = await fetch(appUrl("api/sessions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: "{}",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const result = await response.json();
      if (
        typeof result.sessionId !== "string" ||
        !/^[A-Za-z0-9_-]{22}$/.test(result.sessionId)
      ) {
        throw new Error("invalid_session_response");
      }
      if (disposed) {
        return;
      }
      collab.enabled = true;
      collab.expired = false;
      collab.restoringStoredSession = false;
      collab.sessionId = result.sessionId;
      try {
        sessionStorage.setItem("sisyphus-room-session-id", collab.sessionId);
      } catch {
        /* sessionStorage недоступен — ссылка всё равно получит query-параметр */
      }
      updateSettingsLink();
      collab.leaveToken = null;
      collab.sequence = 0;
      collab.trailCursor = 0;
      connectSharedSession();
    } catch (error) {
      if (disposed || error?.name === "AbortError") {
        return;
      }
      collab.enabled = false;
      setSessionStatus("Не удалось создать сессию", "error");
    } finally {
      collab.sessionCreateInFlight = false;
      if (collab.sessionCreateAbortController === abortController) {
        collab.sessionCreateAbortController = null;
      }
      if (!disposed) {
        updateSessionStatus();
      }
    }
  }

  function sendShared(type, payload = {}) {
    if (!collab.socket || collab.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    collab.sequence += 1;
    collab.socket.send(
      JSON.stringify({ v: 1, type, seq: collab.sequence, payload })
    );
    return true;
  }

  function selectProductionPreset(selection) {
    return sendShared("productionPreset.select", selection);
  }

  function listSettingsTemplates(payload = {}) {
    return sendShared("settingsTemplates.list", payload);
  }

  function importSettingsTemplates(entries) {
    return sendShared("settingsTemplates.import", { entries });
  }

  function saveSettingsTemplate(entry, baseUpdatedAt = "") {
    return sendShared("settingsTemplates.save", { entry, baseUpdatedAt });
  }

  function deleteSettingsTemplate(id) {
    return sendShared("settingsTemplates.delete", { id });
  }

  function startSharedReleaseHandoff() {
    if (!collab.enabled) {
      return;
    }
    collab.releaseHandoff.active = true;
    collab.releaseHandoff.fromX = motion.x;
    collab.releaseHandoff.fromY = motion.y;
    collab.releaseHandoff.startedAt = 0;
  }

  function clearSharedReleaseHandoff() {
    collab.releaseHandoff.active = false;
    collab.releaseHandoff.startedAt = 0;
  }

  function applySharedReleaseHandoff(local, phase) {
    if (!collab.releaseHandoff.active) {
      return local;
    }
    if (phase === PHASES.INTRO || phase === PHASES.WON) {
      clearSharedReleaseHandoff();
      return local;
    }

    const now = performance.now();
    if (collab.releaseHandoff.startedAt === 0) {
      collab.releaseHandoff.startedAt = now;
    }
    const progress = clamp(
      (now - collab.releaseHandoff.startedAt) / RELEASE_HANDOFF_MS,
      0,
      1
    );
    const eased = progress * progress * (3 - 2 * progress);
    let position = {
      x:
        collab.releaseHandoff.fromX +
        (local.x - collab.releaseHandoff.fromX) * eased,
      y:
        collab.releaseHandoff.fromY +
        (local.y - collab.releaseHandoff.fromY) * eased,
    };
    const stepX = position.x - motion.x;
    const stepY = position.y - motion.y;
    const stepDistance = Math.hypot(stepX, stepY);
    if (stepDistance > RELEASE_HANDOFF_MAX_STEP_PX) {
      const scale = RELEASE_HANDOFF_MAX_STEP_PX / stepDistance;
      position = {
        x: motion.x + stepX * scale,
        y: motion.y + stepY * scale,
      };
    } else if (progress >= 1) {
      clearSharedReleaseHandoff();
    }
    return position;
  }

  function sharedSnapshotAtReturnPlace(snapshot) {
    if (
      (snapshot.phase === PHASES.PLAY || snapshot.phase === PHASES.WON) &&
      SharedPhysics.stateInsideImprint(
        { phase: PHASES.PLAY, x: snapshot.x, y: snapshot.y },
        collab.imprint
      )
    ) {
      return true;
    }
    return false;
  }

  function sharedSnapshotTheme(snapshot) {
    return resolveTheme(sharedSnapshotAtReturnPlace(snapshot) ? "light" : "dark");
  }

  function resetLocalExperience() {
    const pointerId = motion.activePointerId;
    releaseRockPress();
    clearSceneTwoPressTimer();
    motion.sceneTwoSizeState = "ground";
    motion.sceneTwoSizeCycleArmed = false;
    motion.wallContact = null;
    stopRockPulse();
    groundImpactAudio.armed = false;
    resetHeightGateState();
    stopLoop();
    motion.dragging = false;
    motion.activePointerId = null;
    motion.vx = 0;
    motion.vy = 0;
    motion.suspended = true;
    motion.pointerVx = 0;
    motion.pointerVy = 0;
    motion.turbTime = 0;
    motion.imprint = null;
    motion.wasAtReturnPlace = false;
    collab.imprint = createSummitSharedImprint(collab.imprint);
    collab.snapshots = [];
    clearSharedReleaseHandoff();
    collab.hasControl = false;
    collab.pendingControl = false;
    collab.releasePending = false;
    collab.holderId = null;
    collab.remoteControllerId = null;
    resetRockActivationScale();
    rock.classList.remove("is-dragging", "is-falling");
    releasePointerCapture(pointerId);
    setGrabbingCursor(false);
    setHandToGrab();
    hideHandCursor();
    resetPreclickRockGuidance();
    updateLocalSharedPointer(null, "grab", false);
    setPhase(PHASES.PLAY);
    showInitialHandCursor();
    setTheme(resolveTheme("dark"));
    resetSummitRainScroll();
    resetTrail();
    renderImprint();
    centerIntroRock();
    motion.firstFallTriggered = false;
    motion.firstFallTouchY = null;
    collab.firstFallRequestSent = false;
    scrollToSceneBottom();
    updateSessionStatus();
  }

  function restartExperience() {
    if (collab.enabled) {
      if (
        sendShared("session.restart", {
          ...initialSharedState(),
          imprint: createSummitSharedImprint(collab.imprint),
        })
      ) {
        resetLocalExperience();
      } else {
        updateSessionStatus();
      }
      return;
    }
    resetLocalExperience();
  }

  function clearSharedConnectionTimers() {
    window.clearTimeout(collab.reconnectTimerId);
    window.clearTimeout(collab.settingsUpdateTimerId);
    window.clearInterval(collab.pingTimerId);
    collab.reconnectTimerId = null;
    collab.settingsUpdateTimerId = null;
    collab.pingTimerId = null;
  }

  function scheduleSharedReconnect() {
    if (
      disposed ||
      !collab.enabled ||
      collab.expired ||
      collab.leaving ||
      collab.reconnectTimerId !== null
    ) {
      return;
    }
    const delay = RECONNECT_DELAYS[
      Math.min(collab.reconnectAttempt, RECONNECT_DELAYS.length - 1)
    ];
    collab.reconnectAttempt += 1;
    collab.reconnectTimerId = window.setTimeout(() => {
      collab.reconnectTimerId = null;
      connectSharedSession();
    }, delay);
  }

  function connectSharedSession() {
    if (
      disposed ||
      !collab.enabled ||
      !collab.sessionId ||
      collab.expired ||
      collab.leaving
    ) {
      return;
    }
    clearSharedConnectionTimers();
    collab.connected = false;
    collab.firstFallRequestSent = false;
    updateSessionStatus();

    const endpoint = appUrl("realtime");
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    endpoint.searchParams.set("session", collab.sessionId);
    endpoint.searchParams.set("client", collab.clientId);
    const socket = new WebSocket(endpoint);
    collab.socket = socket;

    socket.addEventListener("open", () => {
      if (collab.socket !== socket) {
        return;
      }
      collab.connected = true;
      collab.reconnectAttempt = 0;
      collab.pingTimerId = window.setInterval(() => {
        sendShared("ping", { clientTime: Date.now() });
      }, 20_000);
      sendShared("ping", { clientTime: Date.now() });
      sendSharedPointer(
        null,
        collab.localPointer.mode,
        collab.localPointer.visible,
        true
      );
      updateSessionStatus();
    });

    socket.addEventListener("message", (event) => {
      if (disposed || collab.socket !== socket) {
        return;
      }
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      handleSharedMessage(message);
    });

    socket.addEventListener("close", (event) => {
      if (collab.socket !== socket) {
        return;
      }
      clearSharedConnectionTimers();
      collab.connected = false;
      collab.firstFallRequestSent = false;
      collab.hasControl = false;
      collab.pendingControl = false;
      collab.releasePending = false;
      if (collab.settingsUpdateInFlight) {
        collab.settingsUpdateInFlight = null;
        collab.settingsUpdateQueued = true;
      }
      collab.holderId = null;
      cancelSharedLocalDrag();
      updateLocalSharedPointer(null, "grab", false);
      hideHandCursor();
      clearRemotePointers();
      if (event.code === 4004) {
        recoverExpiredSharedSession(socket);
        return;
      }
      updateSessionStatus();
      scheduleSharedReconnect();
    });
  }

  function handleSharedMessage(message) {
    if (!message || message.v !== 1 || typeof message.type !== "string") {
      return;
    }
    const payload = message.payload || {};
    if (message.type === "session.snapshot") {
      receiveSharedSnapshot(payload);
    } else if (message.type === "trail.history") {
      receiveSharedTrailHistory(payload);
    } else if (message.type === "trail.batch") {
      receiveSharedTrailBatch(payload);
    } else if (message.type === "control.granted") {
      collab.pendingControl = false;
      collab.hasControl = true;
      collab.lastControlSlip = null;
      collab.trailWriterId = normalizeHolderId(
        payload.trailWriterId || payload.holderId || collab.clientId,
      );
      updateSharedHolder(payload.holderId || collab.clientId);
      collab.remoteControllerId = collab.holderId;
      updateSessionStatus();
    } else if (message.type === "control.slipped") {
      collab.pendingControl = false;
      collab.hasControl = false;
      collab.releasePending = false;
      collab.lastControlSlip = { ...payload };
      clearTrailNetworkQueue();
      updateSharedHolder(payload.holderId);
      beginSceneTwoAirborneScale();
      cancelSharedLocalDrag();
    } else if (
      message.type === "heightGate.activated" ||
      message.type === "heightGate.released"
    ) {
      syncHeightGateState(payload, payload.serverTime);
      updateSessionStatus();
    } else if (message.type === "control.denied") {
      collab.pendingControl = false;
      collab.hasControl = false;
      clearTrailNetworkQueue();
      if (payload.reason === "scene_two_barrier") {
        beginSceneTwoAirborneScale();
      }
      cancelSharedLocalDrag();
      updateSessionStatus();
    } else if (message.type === "presence.update") {
      collab.participants = Math.max(1, Number(payload.participants) || 1);
      updateSharedHolder(payload.holderId);
      collab.remoteControllerId = payload.controllerId || null;
      syncRemotePointers(payload.pointers);
      updateSessionStatus();
    } else if (message.type === "pointer.update") {
      receiveRemotePointer(payload);
    } else if (message.type === "audio.play") {
      receiveSessionRoleAudio(payload);
    } else if (message.type === "productionPreset.current") {
      settingsController.setProductionPresetState(payload);
    } else if (message.type === "productionPreset.selected") {
      settingsController.setProductionPresetState({
        canSelect: payload.canSelect ?? localCanEditSettings(),
        selection: payload.selection,
      });
    } else if (message.type === "settings.applied") {
      settleSharedSettingsUpdate(payload);
    } else if (message.type === "settings.conflict") {
      settleSharedSettingsUpdate(payload, true);
      settingsController.setSettingsConflict(payload);
    } else if (message.type === "settingsTemplates.page") {
      settingsController.setSettingsTemplatesPage(payload);
    } else if (message.type === "settingsTemplates.imported") {
      settingsController.setSettingsTemplatesImported(payload);
    } else if (message.type === "settingsTemplates.saved") {
      settingsController.setSettingsTemplateSaved(payload);
    } else if (message.type === "settingsTemplates.deleted") {
      settingsController.setSettingsTemplateDeleted(payload);
    } else if (message.type === "settingsTemplates.changed") {
      settingsController.applySettingsTemplateChange(payload);
    } else if (message.type === "pong") {
      const sample = Date.now() - Number(payload.serverTime || Date.now());
      collab.clockOffset = collab.clockOffsetReady
        ? collab.clockOffset * 0.8 + sample * 0.2
        : sample;
      collab.clockOffsetReady = true;
    } else if (message.type === "error") {
      if (
        payload.code === "invalid_production_preset" ||
        payload.code === "production_preset_store_unavailable"
      ) {
        settingsController.setProductionPresetError(payload.message);
      } else if (
        payload.code === "invalid_settings_template" ||
        payload.code === "settings_template_store_unavailable" ||
        payload.code === "production_template_protected" ||
        payload.code === "invalid_settings_update" ||
        payload.code === "debug_only"
      ) {
        settingsController.setSettingsTemplateError(payload.message);
      } else if (payload.code === "session_not_found") {
        recoverExpiredSharedSession(collab.socket);
      }
    }
  }

  function acknowledgeSharedTrail(cursor) {
    sendShared("trail.ack", { cursor });
  }

  function receiveSharedTrailHistory(payload = {}) {
    const cursor = Number(payload.cursor);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Array.isArray(payload.points)) {
      return;
    }
    loadSharedTrail(payload.points);
    collab.trailCursor = cursor;
    acknowledgeSharedTrail(cursor);
  }

  function receiveSharedTrailBatch(payload = {}) {
    const baseCursor = Number(payload.baseCursor);
    const cursor = Number(payload.cursor);
    if (
      !Number.isSafeInteger(baseCursor) ||
      !Number.isSafeInteger(cursor) ||
      cursor < baseCursor ||
      !Array.isArray(payload.points)
    ) {
      sendShared("trail.resync");
      return;
    }
    if (cursor <= collab.trailCursor) {
      acknowledgeSharedTrail(collab.trailCursor);
      return;
    }
    if (baseCursor !== collab.trailCursor) {
      sendShared("trail.resync");
      return;
    }
    appendSharedTrail(payload.points);
    collab.trailCursor = cursor;
    acknowledgeSharedTrail(cursor);
  }

  function receiveSharedSnapshot(payload) {
    if (payload.roomSettings && typeof payload.roomSettings === "object") {
      const snapshotHeight = Number(payload.roomSettings.sceneHeightScreens);
      collab.lastRoomSettingsSnapshotHeight = Number.isFinite(snapshotHeight)
        ? snapshotHeight
        : null;
    }
    if (
      typeof payload.leaveToken === "string" &&
      /^[A-Za-z0-9_-]{22}$/.test(payload.leaveToken)
    ) {
      collab.leaveToken = payload.leaveToken;
    }
    const settingsRevision = Number(payload.settingsRevision);
    if (Number.isSafeInteger(settingsRevision) && settingsRevision > 0) {
      collab.settingsRevision = Math.max(
        collab.settingsRevision,
        settingsRevision,
      );
    }

    const revision = Number(payload.revision);
    if (!Number.isSafeInteger(revision) || revision <= collab.lastRevision) {
      return;
    }
    if (!Object.values(PHASES).includes(payload.phase)) {
      return;
    }

    const previousPhase = motion.phase;
    const initialSnapshot = collab.lastRevision < 0;
    collab.lastRevision = revision;
    collab.trailWriterId = normalizeHolderId(payload.trailWriterId);
    if (collab.trailWriterId !== collab.clientId) {
      clearTrailNetworkQueue();
    }
    const offsetSample = Date.now() - Number(payload.serverTime || Date.now());
    collab.clockOffset = collab.clockOffsetReady
      ? collab.clockOffset * 0.8 + offsetSample * 0.2
      : offsetSample;
    collab.clockOffsetReady = true;
    applySummitTimerSnapshot(payload);
    renderSummitLeaderboard(payload.leaderboard);
    if (Object.hasOwn(payload, "physics")) {
      applySharedPhysics(payload.physics);
    }
    if (Object.hasOwn(payload, "roomSettings")) {
      if (collab.restoringStoredSession) {
        delete collab.pendingRoomSettingsChanges.sceneHeightScreens;
        collab.stagedRoomSettingsChangeKeys.delete("sceneHeightScreens");
      }
      applySharedRoomSettings(payload.roomSettings);
    }
    if (initialSnapshot) {
      const flushRestoredSettings =
        collab.restoringStoredSession &&
        (Object.keys(collab.pendingPhysicsChanges).length > 0 ||
          Object.keys(collab.pendingRoomSettingsChanges).length > 0);
      collab.restoringStoredSession = false;
      if (flushRestoredSettings) {
        scheduleSharedSettingsUpdate();
      }
    }
    syncHeightGateState(payload.heightGateState, payload.serverTime);
    if (collab.settingsUpdateQueued) {
      scheduleSharedSettingsUpdate();
    }
    const holderId = normalizeHolderId(payload.holderId);
    updateSharedHolder(holderId);
    syncSharedGroundTouchSeq(payload.groundTouchSeq);

    if (Object.hasOwn(payload, "imprint")) {
      collab.imprint = SharedPhysics.sanitizeImprint(payload.imprint);
      renderImprint();
    }

    if (Array.isArray(payload.trail)) {
      loadSharedTrail(payload.trail);
    }
    if (
      payload.phase === PHASES.INTRO &&
      !collab.imprint &&
      Array.isArray(payload.trail)
    ) {
      collab.snapshots = [];
    }

    const snapshot = {
      phase: payload.phase,
      x: Number(payload.x) || 0,
      y: Number(payload.y) || 0,
      vx: Number(payload.vx) || 0,
      vy: Number(payload.vy) || 0,
      dragging: Boolean(payload.dragging),
      controllerId: payload.controllerId || null,
      suspended: Boolean(payload.suspended),
      holderId,
      revision,
      serverTime: Number(payload.serverTime) || Date.now(),
    };
    const restoringActiveSession = initialSnapshot && !snapshot.suspended;
    if (restoringActiveSession) {
      completePreclickRockGuidance();
    }
    const ownsHold = holderId === collab.clientId;
    if (
      collab.releasePending &&
      ownsHold
    ) {
      return;
    }
    if (
      collab.releasePending &&
      !ownsHold
    ) {
      collab.releasePending = false;
    }
    const localControlWasEnding =
      (collab.hasControl || (motion.dragging && !collab.pendingControl)) &&
      !ownsHold &&
      snapshot.phase !== PHASES.INTRO &&
      snapshot.phase !== PHASES.WON;
    if (localControlWasEnding) {
      startSharedReleaseHandoff();
      collab.snapshots = [];
    }
    collab.snapshots.push(snapshot);
    collab.snapshots.sort((left, right) => left.serverTime - right.serverTime);
    if (collab.snapshots.length > 12) {
      collab.snapshots.splice(0, collab.snapshots.length - 12);
    }

    const ownsControl = ownsHold;
    collab.remoteControllerId = snapshot.controllerId;
    if (ownsControl) {
      collab.hasControl = true;
      collab.pendingControl = false;
      collab.releasePending = false;
      if (sharedDragActive()) {
        clearSharedReleaseHandoff();
      }
    } else if (collab.hasControl) {
      // Snapshot, поставленный в очередь до control.granted, не должен
      // отменять ожидающий серверного ответа локальный захват.
      collab.hasControl = false;
      cancelSharedLocalDrag();
    }

    const snapshotAtReturnPlace = sharedSnapshotAtReturnPlace(snapshot);
    setPhase(snapshot.phase);
    setTheme(sharedSnapshotTheme(snapshot), {
      durationMs: returnThemeTransitionDuration(snapshotAtReturnPlace, {
        immediate: snapshot.phase === PHASES.INTRO,
      }),
    });
    if (snapshot.phase === PHASES.INTRO) {
      if (previousPhase !== PHASES.INTRO) {
        clearFirstFallTimer();
        motion.firstFallTriggered = false;
        motion.firstFallTouchY = null;
        collab.firstFallRequestSent = false;
      }
      hideReturnRain({ immediate: true });
    } else {
      collab.firstFallRequestSent = false;
    }

    if (snapshot.phase === PHASES.WON) {
      collab.hasControl = false;
      collab.pendingControl = false;
      cancelSharedLocalDrag();
      collab.snapshots = [snapshot];
      applySharedFrame(snapshot, { previousPhase });
    } else if (collab.snapshots.length === 1 && !motion.dragging) {
      applySharedFrame(snapshot, { previousPhase });
    }
    if (restoringActiveSession && !preclickRockGuidance.completed) {
      armRockActivationScale();
      activateRockPhysicsScale({ immediate: true });
      updateCameraFollow({ immediate: true });
    }
    if (initialSnapshot) {
      restoreReloadViewportAfterSnapshot(snapshot);
    }

    startSharedRenderLoop();
    updateSessionStatus();
  }

  function applySharedFrame(snapshot) {
    if (
      !snapshot ||
      (motion.dragging && (collab.pendingControl || collab.hasControl))
    ) {
      return;
    }
    if (preclickRockGuidance.completed) {
      const snapshotOnGround =
        !snapshot.dragging &&
        Number(snapshot.y) >= SharedPhysics.WORLD_HEIGHT - 0.01;
      if (snapshot.suspended || snapshotOnGround) {
        if (!settleSceneTwoRockScaleOnGround()) {
          motion.sceneTwoSizeState = "ground";
          stopRockPulse();
          releaseRockPress();
        }
      } else if (snapshot.dragging && snapshot.holderId) {
        if (motion.sceneTwoSizeState !== "held") {
          clearSceneTwoPressTimer();
          stopRockPulse();
          motion.sceneTwoSizeState = "held";
          motion.sceneTwoSizeCycleArmed = true;
          motion.rockActivationScaleFactor = 1;
          transitionSceneTwoRockScale();
          activateRockPress();
        }
      } else if (motion.sceneTwoSizeState !== "airborne") {
        beginSceneTwoAirborneScale();
      }
    } else {
      if (snapshot.suspended) {
        if (motion.rockActivationArmed || motion.physicsActivated) {
          resetRockActivationScale();
        }
      } else if (snapshot.dragging && snapshot.holderId) {
        armRockActivationScale();
      }
      maybeActivateRockPhysicsScale(snapshot);
    }
    const local = snapshot.suspended
      ? initialLocalPosition()
      : canonicalToLocal(snapshot.x, snapshot.y);
    const velocity = canonicalVelocityToLocal(snapshot.vx, snapshot.vy);
    if (snapshot.suspended) {
      clearSharedReleaseHandoff();
    }
    const position = snapshot.suspended
      ? local
      : applySharedReleaseHandoff(local, snapshot.phase);
    setPosition(position.x, position.y);
    motion.vx = velocity.vx;
    motion.vy = velocity.vy;
    motion.suspended = Boolean(snapshot.suspended);
    motion.turbTime = 0;

    const visiblyDragging = Boolean(snapshot.dragging && snapshot.holderId);
    const visiblyFalling =
      !visiblyDragging &&
      !motion.suspended &&
      snapshot.phase !== PHASES.INTRO &&
      snapshot.phase !== PHASES.WON &&
      (snapshot.phase === PHASES.FALLING ||
        Math.abs(snapshot.vx) > 0.5 ||
        Math.abs(snapshot.vy) > 0.5);
    rock.classList.toggle("is-dragging", visiblyDragging);
    rock.classList.toggle("is-falling", visiblyFalling);
    syncReturnTheme();
  }

  function renderSharedFrame(now) {
    collab.renderId = null;
    const deltaSeconds = clamp(
      (now - (collab.lastRenderAt || now)) / 1000,
      0,
      MAX_FRAME_SECONDS
    );
    collab.lastRenderAt = now;
    observeGlowFrameTime(deltaSeconds, now);

    const targetServerTime =
      Date.now() - collab.clockOffset - SNAPSHOT_DELAY_MS;
    if (collab.snapshots.length > 0) {
      while (
        collab.snapshots.length > 2 &&
        collab.snapshots[1].serverTime <= targetServerTime
      ) {
        collab.snapshots.shift();
      }

      const first = collab.snapshots[0];
      const second = collab.snapshots[1];
      if (
        second &&
        targetServerTime >= first.serverTime &&
        targetServerTime <= second.serverTime
      ) {
        const range = Math.max(second.serverTime - first.serverTime, 1);
        const factor = clamp((targetServerTime - first.serverTime) / range, 0, 1);
        applySharedFrame({
          ...second,
          x: first.x + (second.x - first.x) * factor,
          y: first.y + (second.y - first.y) * factor,
          vx: first.vx + (second.vx - first.vx) * factor,
          vy: first.vy + (second.vy - first.vy) * factor,
        });
      } else {
        applySharedFrame(second || first);
      }
      if (
        second &&
        targetServerTime >= second.serverTime &&
        collab.snapshots.length === 2
      ) {
        collab.snapshots.shift();
      }
    }

    if (shouldRecordTrailPoint()) {
      recordTrailPoint(deltaSeconds);
    }
    updateCameraFollow();
    renderRemotePointers();
    renderSummitTimer();

    const latest = collab.snapshots.at(-1);
    const needsNextFrame = Boolean(
      collab.hasControl ||
      collab.pendingControl ||
      motion.dragging ||
      collab.releaseHandoff.active ||
      collab.snapshots.length > 1 ||
      latest?.dragging ||
      latest?.phase === PHASES.FALLING ||
      (!latest?.suspended &&
        (Math.abs(latest?.vx || 0) > 0.5 ||
          Math.abs(latest?.vy || 0) > 0.5)),
    );
    if (needsNextFrame && collab.renderId === null) {
      collab.renderId = window.requestAnimationFrame(renderSharedFrame);
    } else if (!needsNextFrame) {
      collab.lastRenderAt = null;
    }
  }

  function startSharedRenderLoop() {
    stopLoop();
    if (collab.renderId === null) {
      collab.lastRenderAt = performance.now();
      collab.renderId = window.requestAnimationFrame(renderSharedFrame);
    }
  }

  function cancelSharedLocalDrag(releaseCapture = true) {
    const pointerId = motion.activePointerId;
    releaseRockPress();
    motion.dragging = false;
    motion.activePointerId = null;
    rock.classList.remove("is-dragging");
    setGrabbingCursor(false);
    setHandToGrab();
    updateLocalSharedPointer(
      null,
      "grab",
      collab.localPointer.visible
    );
    if (releaseCapture) {
      releasePointerCapture(pointerId);
    }
  }

  function beginSharedDrag(event) {
    if (!collab.connected) {
      updateSessionStatus();
      return;
    }
    if (motion.phase !== PHASES.PLAY) {
      return;
    }

    event.preventDefault();
    armGroundImpactSound();
    clearSharedReleaseHandoff();
    collab.releasePending = false;
    scheduleGrabbingHandImage();
    updateBounds();
    const position = localToCanonical(motion.x, motion.y);
    motion.suspended = false;
    motion.dragging = true;
    beginSceneTwoGrabScale();
    motion.activePointerId = event.pointerId;
    setGrabPointFromPointer(event);
    motion.dragTargetX = motion.x;
    motion.dragTargetY = motion.y;
    motion.pointerVx = 0;
    motion.pointerVy = 0;
    motion.lastPointerAt = 0;
    recordPointerVelocity(event);
    showHandCursor(event);
    rock.classList.remove("is-falling");
    rock.classList.add("is-dragging");
    rock.setPointerCapture(event.pointerId);
    collab.pendingControl = true;

    const pointer = updateLocalSharedPointer(
      event,
      "grabbing",
      !handIsHidden(),
    );
    sendShared("control.acquire", {
      ...position,
      pointer,
    });
    updateSessionStatus();
  }

  function moveSharedDrag(event) {
    moveHandCursor(event);
    const pointer = updateLocalSharedPointer(
      event,
      motion.dragging ? "grabbing" : "grab",
      !handIsHidden(),
    );
    if (!motion.dragging || (!collab.hasControl && !collab.pendingControl)) {
      sendSharedPointer(event, "grab", !handIsHidden());
      return;
    }
    event.preventDefault();
    recordPointerVelocity(event);
    setDragTargetFromPointer(event);
    const activeDrag = sharedDragActive();
    if (activeDrag) {
      applyDragTargetMovement(MAX_FRAME_SECONDS);
      syncReturnTheme();
    }

    const now = performance.now();
    const reachedImprint =
      motion.phase === PHASES.PLAY && rockInsideImprint();
    if (
      !reachedImprint &&
      now - collab.lastMoveSentAt < POINTER_SEND_INTERVAL_MS
    ) {
      return;
    }
    collab.lastMoveSentAt = now;
    const position = localToCanonical(
      motion.dragTargetX,
      motion.dragTargetY,
    );
    const velocity = activeDrag
      ? localVelocityToCanonical(motion.pointerVx, motion.pointerVy)
      : { vx: 0, vy: 0 };
    sendShared("control.move", {
      ...position,
      ...velocity,
      pointer,
    });
  }

  function releaseSharedDrag(event) {
    if (!motion.dragging) {
      releaseRockPress();
      return;
    }
    const releasedInImprint =
      motion.phase === PHASES.PLAY && rockInsideImprint();
    beginSceneTwoAirborneScale();
    const canReleaseWithImpulse = sharedDragActive();
    const pointerVelocity = canReleaseWithImpulse
      ? currentPointerVelocity()
      : { vx: 0, vy: 0 };
    const velocity = canReleaseWithImpulse
      ? localVelocityToCanonical(pointerVelocity.vx, pointerVelocity.vy)
      : { vx: 0, vy: 0 };
    const position = localToCanonical(motion.x, motion.y);
    const pointerVisible =
      !handIsHidden() &&
      event.type !== "pointercancel" &&
      pointerIsOverRock(event);
    const pointer = updateLocalSharedPointer(event, "grab", pointerVisible);
    if (canReleaseWithImpulse) {
      startSharedReleaseHandoff();
    }
    collab.releasePending = true;
    collab.snapshots = [];
    flushTrailNetworkQueue();
    sendShared("control.release", {
      ...position,
      ...velocity,
      pointer,
    });
    collab.pendingControl = false;
    collab.hasControl = false;
    cancelSharedLocalDrag();
    if (releasedInImprint) {
      armSummitRainScroll();
    }
    syncReturnTheme();
    updateSessionStatus();
  }

  function forceReleaseSharedDrag(
    hidePointer = false,
    neutral = false,
    barrierHop = false,
  ) {
    if (!motion.dragging) {
      releaseRockPress();
      return;
    }
    const releasedInImprint =
      motion.phase === PHASES.PLAY && rockInsideImprint();
    const canReleaseWithImpulse = !neutral && sharedDragActive();
    const pointerVelocity = canReleaseWithImpulse
      ? currentPointerVelocity()
      : { vx: 0, vy: 0 };
    const velocity = canReleaseWithImpulse
      ? localVelocityToCanonical(pointerVelocity.vx, pointerVelocity.vy)
      : { vx: 0, vy: 0 };
    const position = localToCanonical(motion.x, motion.y);
    beginSceneTwoAirborneScale();
    const pointer = updateLocalSharedPointer(
      null,
      "grab",
      hidePointer ? false : collab.localPointer.visible
    );
    if (canReleaseWithImpulse) {
      startSharedReleaseHandoff();
    }
    collab.releasePending = true;
    collab.snapshots = [];
    flushTrailNetworkQueue();
    sendShared("control.release", {
      ...position,
      ...velocity,
      barrierHop,
      pointer,
    });
    collab.pendingControl = false;
    collab.hasControl = false;
    cancelSharedLocalDrag();
    if (releasedInImprint) {
      armSummitRainScroll();
    }
    syncReturnTheme();
    if (hidePointer) {
      hideHandCursor();
    }
    updateSessionStatus();
  }

  function clearCanvas(context, canvas) {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.restore();
  }

  function bumpCanvasRevision(canvas, key) {
    trail[key] += 1;
    canvas.dataset.canvasRevision = String(trail[key]);
    requestFoldSync();
  }

  function clearTrailCanvas() {
    clearCanvas(trailCtx, trailCanvas);
    bumpCanvasRevision(trailCanvas, "baseRevision");
    clearCanvas(trailSessionCtx, trailSessionCanvas);
    bumpCanvasRevision(trailSessionCanvas, "sessionRevision");
  }

  function clearGlowCanvas() {
    clearCanvas(trailGlowCtx, trailGlowCanvas);
    trail.glowRendered = false;
    trail.glowSampledPointCount = 0;
    bumpCanvasRevision(trailGlowCanvas, "glowRevision");
  }

  function currentGlowProfile() {
    const glowProfile = resolveGlowOptimizationProfile(
      params,
      trail.adaptiveQuality,
    );
    if (params.glowOptimizationMode !== "auto") {
      return glowProfile;
    }
    const profile = currentTrailProfile();
    return {
      ...glowProfile,
      maxPoints: Math.min(glowProfile.maxPoints, profile.glowMaxPoints),
      updateFps: Math.min(glowProfile.updateFps, profile.glowUpdateFps),
    };
  }

  function trailDeviceCapabilities() {
    return {
      saveData: navigator.connection?.saveData === true,
      deviceMemory: navigator.deviceMemory,
      hardwareConcurrency: navigator.hardwareConcurrency,
      coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    };
  }

  function currentTrailProfile() {
    return resolveTrailRenderProfile(
      params.trailRenderProfile,
      trailDeviceCapabilities(),
    );
  }

  function effectiveTrailLimit() {
    const configured = Math.max(20, Number(params.trailMaxPoints) || 20);
    return Math.min(HARD_TRAIL_LIMIT, Math.floor(configured));
  }

  function ensureTrailCanvasSize() {
    const width = Math.max(
      1,
      Math.round(window.innerWidth || document.documentElement.clientWidth)
    );
    const viewportHeight = Math.max(
      1,
      Math.round(window.innerHeight || document.documentElement.clientHeight)
    );
    const sceneHeight = Math.max(viewportHeight, world.offsetHeight);
    const historyWindow = calculateTrailHistoryWindow(
      window.scrollY,
      viewportHeight,
      sceneHeight,
    );
    const profile = currentTrailProfile();
    const ratio = effectiveCanvasPixelRatio({
      cssWidth: width,
      cssHeight: historyWindow.height,
      devicePixelRatio: window.devicePixelRatio || 1,
      dprCap: profile.dprCap,
      maxPixels: profile.historyMaxPixels,
    });
    const bufferWidth = Math.max(1, Math.round(width * ratio));
    const bufferHeight = Math.max(1, Math.round(historyWindow.height * ratio));
    const windowChanged =
      trail.historyWindowTop !== historyWindow.top ||
      trail.historyWindowHeight !== historyWindow.height;

    if (
      trailCanvas.width !== bufferWidth ||
      trailCanvas.height !== bufferHeight ||
      windowChanged
    ) {
      trail.pixelRatio = ratio;
      trailCanvas.width = bufferWidth;
      trailCanvas.height = bufferHeight;
      trail.historyWindowTop = historyWindow.top;
      trail.historyWindowHeight = historyWindow.height;
      trailCanvas.style.top = `${historyWindow.top}px`;
      trailCanvas.style.left = `${window.scrollX}px`;
      trailCanvas.style.width = `${width}px`;
      trailCanvas.style.height = `${historyWindow.height}px`;
      trailCanvas.style.setProperty(
        "--trail-history-height",
        `${historyWindow.height}px`,
      );
      trail.dirty = true;
    }
    trail.pixelRatio = ratio;
    return windowChanged;
  }

  function ensureSessionCanvasSize() {
    const width = Math.max(1, Math.round(window.innerWidth || 1));
    const height = Math.max(1, Math.round(window.innerHeight || 1));
    const profile = currentTrailProfile();
    const ratio = effectiveCanvasPixelRatio({
      cssWidth: width,
      cssHeight: height,
      devicePixelRatio: window.devicePixelRatio || 1,
      dprCap: profile.dprCap,
      maxPixels: profile.sessionMaxPixels,
    });
    const bufferWidth = Math.max(1, Math.round(width * ratio));
    const bufferHeight = Math.max(1, Math.round(height * ratio));
    if (
      trailSessionCanvas.width !== bufferWidth ||
      trailSessionCanvas.height !== bufferHeight
    ) {
      trailSessionCanvas.width = bufferWidth;
      trailSessionCanvas.height = bufferHeight;
      trail.sessionDirty = true;
    }
    trail.sessionPixelRatio = ratio;
  }

  function ensureGlowCanvasSize(profile = currentGlowProfile()) {
    const width = Math.max(
      1,
      Math.round(window.innerWidth || document.documentElement.clientWidth),
    );
    const height = Math.max(
      1,
      Math.round(window.innerHeight || document.documentElement.clientHeight),
    );
    const trailProfile = currentTrailProfile();
    const baseRatio = effectiveCanvasPixelRatio({
      cssWidth: width,
      cssHeight: height,
      devicePixelRatio: window.devicePixelRatio || 1,
      dprCap: trailProfile.dprCap,
      maxPixels: trailProfile.sessionMaxPixels,
    });
    const ratio = baseRatio * profile.bufferScale;
    const bufferWidth = Math.max(1, Math.round(width * ratio));
    const bufferHeight = Math.max(1, Math.round(height * ratio));
    if (
      trailGlowCanvas.width !== bufferWidth ||
      trailGlowCanvas.height !== bufferHeight
    ) {
      trail.glowPixelRatio = ratio;
      trailGlowCanvas.width = bufferWidth;
      trailGlowCanvas.height = bufferHeight;
      trail.glowDirty = true;
      return true;
    }
    trail.glowPixelRatio = ratio;
    return false;
  }

  function resizeTrailCanvas() {
    trail.dirty = true;
    trail.sessionDirty = true;
    trail.glowDirty = true;
    scheduleTrailRender();
  }

  function applyTrailBlendMode() {
    const blendMode = body.classList.contains("theme-dark")
      ? "normal"
      : params.blendMode;
    [trailGlowCanvas, trailCanvas, trailSessionCanvas].forEach((canvas) => {
      canvas.style.mixBlendMode = blendMode;
      canvas.style.opacity = String(params.lineOpacity);
    });
  }

  function cancelGlowRenderSchedule() {
    if (trail.glowAnimationFrameId !== null) {
      window.cancelAnimationFrame(trail.glowAnimationFrameId);
      trail.glowAnimationFrameId = null;
    }
    if (trail.glowTimerId !== null) {
      window.clearTimeout(trail.glowTimerId);
      trail.glowTimerId = null;
    }
  }

  function resetTrail() {
    trail.points.length = 0;
    trail.canonicalPoints.length = 0;
    trail.historyPoints.length = 0;
    trail.historyCanonical.length = 0;
    trail.sessionPoints.length = 0;
    trail.sessionCanonical.length = 0;
    trail.lastX = null;
    trail.lastY = null;
    trail.followX = null;
    trail.followY = null;
    trail.skipNextRecord = false;
    cancelGlowRenderSchedule();
    clearTrailCanvas();
    clearGlowCanvas();
    trail.dirty = false;
    trail.sessionDirty = false;
    trail.glowDirty = false;
  }

  function resetTrailOnGroundTouch(touchedGround) {
    if (!params.trailReset || !touchedGround) {
      return false;
    }
    resetTrail();
    trail.skipNextRecord = true;
    return true;
  }

  function normalizeGroundTouchSeq(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  }

  function syncSharedGroundTouchSeq(value) {
    const next = normalizeGroundTouchSeq(value);
    if (next === null) {
      return false;
    }
    const previous = collab.groundTouchSeq;
    collab.groundTouchSeq = next;
    const touchedGround = previous !== null && next > previous;
    if (touchedGround) {
      playArmedGroundImpactSound();
      settleSceneTwoRockScaleOnGround();
    }
    return resetTrailOnGroundTouch(touchedGround);
  }

  function trimTrailToLimit() {
    let overflow = trail.points.length - effectiveTrailLimit();
    if (overflow > 0) {
      trail.points.splice(0, overflow);
      trail.canonicalPoints.splice(0, overflow);
      const historyOverflow = Math.min(overflow, trail.historyPoints.length);
      if (historyOverflow > 0) {
        trail.historyPoints.splice(0, historyOverflow);
        trail.historyCanonical.splice(0, historyOverflow);
        overflow -= historyOverflow;
      }
      if (overflow > 0) {
        trail.sessionPoints.splice(0, overflow);
        trail.sessionCanonical.splice(0, overflow);
        trail.sessionDirty = true;
      }
      trail.glowDirty = true;
    }
  }

  function checkpointTrail({ force = false } = {}) {
    if (!force && trail.sessionPoints.length === 0) {
      return false;
    }
    trail.historyCanonical = trail.canonicalPoints.slice(-effectiveTrailLimit());
    trail.historyPoints = trail.points.slice(-effectiveTrailLimit());
    trail.sessionCanonical = [];
    trail.sessionPoints = [];
    trail.canonicalPoints = trail.historyCanonical.slice();
    trail.points = trail.historyPoints.slice();
    trail.dirty = true;
    trail.sessionDirty = true;
    trail.glowDirty = true;
    return true;
  }

  function checkpointTrailIfNeeded() {
    if (trail.sessionPoints.length >= currentTrailProfile().checkpointPoints) {
      checkpointTrail({ force: true });
    }
  }

  function clearTrailNetworkQueue() {
    trail.networkPoints.length = 0;
    if (trail.networkTimerId !== null) {
      window.clearTimeout(trail.networkTimerId);
      trail.networkTimerId = null;
    }
  }

  function flushTrailNetworkQueue() {
    if (trail.networkTimerId !== null) {
      window.clearTimeout(trail.networkTimerId);
      trail.networkTimerId = null;
    }
    if (
      !collab.enabled ||
      collab.trailWriterId !== collab.clientId
    ) {
      clearTrailNetworkQueue();
      return;
    }
    while (trail.networkPoints.length > 0) {
      sendShared("trail.append", {
        points: trail.networkPoints.splice(0, TRAIL_NETWORK_BATCH_POINTS),
      });
    }
  }

  function queueSharedTrailPoint(point) {
    if (
      !collab.enabled ||
      collab.trailWriterId !== collab.clientId
    ) {
      return;
    }
    trail.networkPoints.push(point);
    if (trail.networkPoints.length >= TRAIL_NETWORK_BATCH_POINTS) {
      flushTrailNetworkQueue();
      return;
    }
    if (trail.networkTimerId === null) {
      trail.networkTimerId = window.setTimeout(
        flushTrailNetworkQueue,
        TRAIL_NETWORK_FLUSH_MS,
      );
    }
  }

  function trailFollowFactor(deltaSeconds) {
    // Базовая доля «догоняния» камня за кадр (0..1) из параметра задержки:
    // 0 — линия точно повторяет путь, больше — сильнее инерция и сглаживание.
    const base = Math.max(0.03, Math.pow(1 - params.lineDelay, 2));
    // Нормируем под реальный dt, чтобы поведение не зависело от частоты кадров.
    const frames = Math.max(deltaSeconds, 0) * 60;
    return 1 - Math.pow(1 - base, frames || 1);
  }

  function recordTrailPoint(deltaSeconds) {
    const wallCompensation = rockHorizontalWallCompensation(
      motion.x,
      bounds.maxX,
      bounds.rockWidth,
      motion.rockScale,
      params.rockWallPenetrationPercent,
    );
    const anchor = trailAnchorPoint({
      x: motion.x + wallCompensation,
      y: motion.y,
      width: bounds.rockWidth,
      height: bounds.rockHeight,
      scale: motion.rockScale,
      heightPercent: params.trailAnchorHeightPercent,
    });
    recordTrailAnchorPoint(anchor, deltaSeconds);
  }

  function recordTrailAnchorPoint(anchor, deltaSeconds) {
    const rockX = Number(anchor?.x);
    const rockY = Number(anchor?.y);
    if (!Number.isFinite(rockX) || !Number.isFinite(rockY)) {
      return;
    }

    // Ведомая точка инерционно догоняет камень — линия параллельно следует
    // за путём камня с задержкой, плавно подтягиваясь и сглаживая траекторию.
    if (trail.followX === null) {
      trail.followX = rockX;
      trail.followY = rockY;
    } else {
      const f = trailFollowFactor(deltaSeconds || 0);
      trail.followX += (rockX - trail.followX) * f;
      trail.followY += (rockY - trail.followY) * f;
    }

    const x = trail.followX;
    const y = trail.followY;

    if (trail.lastX !== null) {
      const dx = x - trail.lastX;
      const dy = y - trail.lastY;
      const sampleDistance = scaledVisualPixel(params.trailSampleDist);
      const threshold = sampleDistance * sampleDistance;
      if (dx * dx + dy * dy < threshold) {
        return;
      }
    }

    const canonicalPoint = localVisualTrailPointToCanonical(
      { x, y },
      trailProjectionOptions(),
    );
    if (!canonicalPoint) {
      return;
    }

    trail.points.push({ x, y });
    trail.canonicalPoints.push(canonicalPoint);
    trail.sessionPoints.push({ x, y });
    trail.sessionCanonical.push(canonicalPoint);
    trail.lastX = x;
    trail.lastY = y;
    queueSharedTrailPoint(canonicalPoint);
    if (params.trailEnabled) {
      trail.sessionDirty = true;
      trail.glowDirty = true;
    }

    trimTrailToLimit();
    checkpointTrailIfNeeded();
    scheduleTrailRender();
  }

  function shouldRecordTrailPoint() {
    if (trail.skipNextRecord) {
      trail.skipNextRecord = false;
      return false;
    }
    if (motion.suspended) {
      return false;
    }
    return (
      motion.dragging ||
      motion.phase === PHASES.FALLING ||
      (motion.phase === PHASES.PLAY &&
        (motion.y < bounds.maxY - 0.75 ||
          Math.abs(motion.vx) >= 0.5 ||
          Math.abs(motion.vy) >= 0.5))
    );
  }

  function trailDashArray() {
    const scale = 1;
    if (params.dashStyle === "dashed") {
      return [params.dashLength * scale, params.dashGap * scale];
    }
    if (params.dashStyle === "dotted") {
      return [scale, Math.max(params.dashGap * scale, 2 * scale)];
    }
    return [];
  }

  function drawTrailStartPoint(context, point, color) {
    context.fillStyle = color;
    context.beginPath();
    context.arc(
      point.x,
      point.y,
      Math.max(
        scaledVisualPixel(2.5),
        scaledVisualPixel(params.lineWidth) * 0.75,
      ),
      0,
      Math.PI * 2
    );
    context.fill();
  }

  function quadraticSegmentLength(start, control, end) {
    let length = 0;
    let previousX = start.x;
    let previousY = start.y;
    for (let step = 1; step <= 8; step += 1) {
      const t = step / 8;
      const inverse = 1 - t;
      const x =
        inverse * inverse * start.x +
        2 * inverse * t * control.x +
        t * t * end.x;
      const y =
        inverse * inverse * start.y +
        2 * inverse * t * control.y +
        t * t * end.y;
      length += Math.hypot(x - previousX, y - previousY);
      previousX = x;
      previousY = y;
    }
    return length;
  }

  function trailSegments(points) {
    if (points.length < 2) {
      return [];
    }
    const segments = [];
    let start = points[0];
    for (let index = 1; index < points.length - 1; index += 1) {
      const control = points[index];
      const end = {
        x: (control.x + points[index + 1].x) / 2,
        y: (control.y + points[index + 1].y) / 2,
      };
      segments.push({ start, control, end });
      start = end;
    }
    segments.push({ start, control: null, end: points.at(-1) });
    return segments;
  }

  function strokeTrailBatches(context, points, maxSegments = 256) {
    const segments = trailSegments(points);
    let dashOffset = 0;
    let strokes = 0;
    for (let offset = 0; offset < segments.length; offset += maxSegments) {
      const batch = segments.slice(offset, offset + maxSegments);
      context.lineDashOffset = -dashOffset;
      context.beginPath();
      context.moveTo(batch[0].start.x, batch[0].start.y);
      batch.forEach((segment) => {
        if (segment.control) {
          context.quadraticCurveTo(
            segment.control.x,
            segment.control.y,
            segment.end.x,
            segment.end.y,
          );
          dashOffset += quadraticSegmentLength(
            segment.start,
            segment.control,
            segment.end,
          );
        } else {
          context.lineTo(segment.end.x, segment.end.y);
          dashOffset += Math.hypot(
            segment.end.x - segment.start.x,
            segment.end.y - segment.start.y,
          );
        }
      });
      context.stroke();
      strokes += 1;
    }
    context.setLineDash([]);
    context.lineDashOffset = 0;
    return strokes;
  }

  function visibleTrailRuns(points, top, height) {
    if (points.length < 2) {
      return points.length === 1 ? [points.slice()] : [];
    }
    const margin = Math.max(8, scaledVisualPixel(params.lineWidth) * 2);
    const minY = top - margin;
    const maxY = top + height + margin;
    const runs = [];
    let run = null;
    for (let index = 0; index < points.length - 1; index += 1) {
      const first = points[index];
      const second = points[index + 1];
      const visible =
        Math.max(first.y, second.y) >= minY &&
        Math.min(first.y, second.y) <= maxY;
      if (!visible) {
        run = null;
        continue;
      }
      if (!run) {
        run = [first, second];
        runs.push(run);
      } else {
        run.push(second);
      }
    }
    return runs;
  }

  function sampleVisibleTrailRuns(runs, maxPoints) {
    return sampleTrailRuns(runs, maxPoints);
  }

  function traceGlowPath(context, points) {
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    let segmentStart = points[0];
    for (let index = 1; index < points.length - 1; index += 1) {
      const segmentEnd = {
        x: (points[index].x + points[index + 1].x) / 2,
        y: (points[index].y + points[index + 1].y) / 2,
      };
      context.quadraticCurveTo(
        points[index].x,
        points[index].y,
        segmentEnd.x,
        segmentEnd.y,
      );
      segmentStart = segmentEnd;
    }
    const last = points.at(-1);
    if (segmentStart !== last) {
      context.lineTo(last.x, last.y);
    }
  }

  function renderGlow(now = performance.now()) {
    const startedAt = performance.now();
    trail.glowAnimationFrameId = null;
    const profile = currentGlowProfile();
    ensureGlowCanvasSize(profile);
    if (!trail.glowDirty) {
      return;
    }
    trail.glowDirty = false;
    clearCanvas(trailGlowCtx, trailGlowCanvas);
    trail.glowLastRenderedAt = now;

    if (!params.trailEnabled || params.glow <= 0 || trail.points.length === 0) {
      if (trail.glowRendered || trail.glowRevision === 0) {
        clearGlowCanvas();
      }
      return;
    }

    const points = sampleGlowPoints(
      trail.points,
      profile.maxPoints,
      profile.decimation,
    );
    trail.glowSampledPointCount = points.length;
    trailGlowCtx.save();
    trailGlowCtx.setTransform(
      trail.glowPixelRatio,
      0,
      0,
      trail.glowPixelRatio,
      -window.scrollX * trail.glowPixelRatio,
      -window.scrollY * trail.glowPixelRatio,
    );
    trailGlowCtx.globalAlpha = params.linePassOpacity;
    trailGlowCtx.globalCompositeOperation = "lighter";
    trailGlowCtx.lineCap = params.lineCap;
    trailGlowCtx.lineJoin = params.lineJoin;
    trailGlowCtx.lineWidth = scaledVisualPixel(params.lineWidth);
    trailGlowCtx.strokeStyle = params.glowColor;
    trailGlowCtx.fillStyle = params.glowColor;
    trailGlowCtx.shadowBlur =
      scaledVisualPixel(params.glow) * profile.bufferScale;
    trailGlowCtx.shadowColor = params.glowColor;
    trailGlowCtx.setLineDash(trailDashArray());

    if (points.length === 1) {
      trailGlowCtx.beginPath();
      trailGlowCtx.arc(
        points[0].x,
        points[0].y,
        Math.max(
          scaledVisualPixel(2.5),
          scaledVisualPixel(params.lineWidth) * 0.75,
        ),
        0,
        Math.PI * 2,
      );
      trailGlowCtx.fill();
    } else {
      traceGlowPath(trailGlowCtx, points);
      trailGlowCtx.stroke();
    }
    trailGlowCtx.restore();
    trail.glowRendered = true;
    trail.glowRenderPasses += 1;
    bumpCanvasRevision(trailGlowCanvas, "glowRevision");
    measureDebugRender("trail.glow", startedAt);
  }

  function scheduleGlowRender() {
    if (!trail.glowDirty) {
      return;
    }
    if (!params.trailEnabled || params.glow <= 0) {
      cancelGlowRenderSchedule();
      if (trail.glowRendered) {
        renderGlow(performance.now());
      } else {
        trail.glowDirty = false;
        trail.glowSampledPointCount = 0;
      }
      return;
    }
    if (
      trail.glowAnimationFrameId !== null ||
      trail.glowTimerId !== null
    ) {
      return;
    }
    const profile = currentGlowProfile();
    const intervalMs = 1000 / Math.max(profile.updateFps, 1);
    const delayMs = Math.max(
      0,
      intervalMs - (performance.now() - trail.glowLastRenderedAt),
    );
    const requestFrame = () => {
      trail.glowTimerId = null;
      trail.glowAnimationFrameId = window.requestAnimationFrame(renderGlow);
    };
    if (delayMs <= 1) {
      requestFrame();
    } else {
      trail.glowTimerId = window.setTimeout(requestFrame, delayMs);
    }
  }

  function observeGlowFrameTime(deltaSeconds, now) {
    if (params.glowOptimizationMode !== "auto") {
      if (trail.adaptiveQuality !== 1) {
        trail.adaptiveQuality = 1;
        trail.glowDirty = true;
        scheduleGlowRender();
      }
      trail.adaptiveMeasuredAt = now;
      return;
    }
    const frameTimeMs = Math.max(deltaSeconds * 1000, 1);
    trail.adaptiveFrameTimeMs =
      trail.adaptiveFrameTimeMs * 0.9 + frameTimeMs * 0.1;
    if (now - trail.adaptiveMeasuredAt < 500) {
      return;
    }
    trail.adaptiveMeasuredAt = now;
    const targetMs = 1000 / params.glowTargetFps;
    let quality = trail.adaptiveQuality;
    if (trail.adaptiveFrameTimeMs > targetMs * 1.08) {
      quality -= 0.1;
    } else if (trail.adaptiveFrameTimeMs < targetMs * 0.78) {
      quality += 0.05;
    }
    quality = Math.round(clamp(quality, 0.5, 1.5) * 20) / 20;
    if (quality !== trail.adaptiveQuality) {
      trail.adaptiveQuality = quality;
      trail.glowDirty = true;
      scheduleGlowRender();
    }
  }

  function renderHistoryTrail() {
    const startedAt = performance.now();
    trail.dirty = false;
    clearCanvas(trailCtx, trailCanvas);
    const points = trail.historyPoints;
    trail.historyStrokeBatches = 0;
    if (params.trailEnabled && points.length > 0) {
      const profile = currentTrailProfile();
      const visibleRuns = sampleVisibleTrailRuns(
        visibleTrailRuns(
          points,
          trail.historyWindowTop,
          trail.historyWindowHeight,
        ),
        profile.historyMaxPoints,
      );
      trailCtx.save();
      trailCtx.setTransform(
        trail.pixelRatio,
        0,
        0,
        trail.pixelRatio,
        -window.scrollX * trail.pixelRatio,
        -trail.historyWindowTop * trail.pixelRatio,
      );
      trailCtx.globalAlpha = params.linePassOpacity;
      trailCtx.globalCompositeOperation = "lighter";
      trailCtx.lineCap = params.lineCap;
      trailCtx.lineJoin = params.lineJoin;
      trailCtx.lineWidth = scaledVisualPixel(params.lineWidth);
      const first = points[0];
      const last = points.at(-1);
      if (params.useGradient && points.length > 1) {
        const gradient = trailCtx.createLinearGradient(
          first.x,
          first.y,
          last.x,
          last.y,
        );
        gradient.addColorStop(0, params.lineColorTail);
        gradient.addColorStop(1, params.lineColor);
        trailCtx.strokeStyle = gradient;
      } else {
        trailCtx.strokeStyle = params.lineColor;
      }
      trailCtx.setLineDash(trailDashArray());
      visibleRuns.forEach((run) => {
        if (run.length === 1) {
          drawTrailStartPoint(
            trailCtx,
            run[0],
            params.useGradient ? params.lineColorTail : params.lineColor,
          );
        } else {
          trail.historyStrokeBatches += strokeTrailBatches(trailCtx, run, 256);
        }
      });
      if (
        first.y >= trail.historyWindowTop &&
        first.y <= trail.historyWindowTop + trail.historyWindowHeight
      ) {
        drawTrailStartPoint(
          trailCtx,
          first,
          params.useGradient ? params.lineColorTail : params.lineColor,
        );
      }
      trailCtx.restore();
    }
    trail.historyRenderPasses += 1;
    bumpCanvasRevision(trailCanvas, "baseRevision");
    measureDebugRender("trail.history", startedAt);
  }

  function renderSessionTrail() {
    const startedAt = performance.now();
    trail.sessionDirty = false;
    clearCanvas(trailSessionCtx, trailSessionCanvas);
    trail.sessionStrokeBatches = 0;
    const anchor = trail.historyPoints.at(-1);
    const points = anchor
      ? [anchor, ...trail.sessionPoints]
      : trail.sessionPoints;
    if (params.trailEnabled && points.length > 0) {
      trailSessionCtx.save();
      trailSessionCtx.setTransform(
        trail.sessionPixelRatio,
        0,
        0,
        trail.sessionPixelRatio,
        -window.scrollX * trail.sessionPixelRatio,
        -window.scrollY * trail.sessionPixelRatio,
      );
      trailSessionCtx.globalAlpha = params.linePassOpacity;
      trailSessionCtx.globalCompositeOperation = "lighter";
      trailSessionCtx.lineCap = params.lineCap;
      trailSessionCtx.lineJoin = params.lineJoin;
      trailSessionCtx.lineWidth = scaledVisualPixel(params.lineWidth);
      trailSessionCtx.strokeStyle = params.lineColor;
      trailSessionCtx.setLineDash(trailDashArray());
      if (points.length === 1) {
        drawTrailStartPoint(trailSessionCtx, points[0], params.lineColor);
      } else {
        trail.sessionStrokeBatches = strokeTrailBatches(
          trailSessionCtx,
          points,
          256,
        );
      }
      trailSessionCtx.restore();
    }
    trail.sessionRenderPasses += 1;
    bumpCanvasRevision(trailSessionCanvas, "sessionRevision");
    measureDebugRender("trail.session", startedAt);
  }

  function drawTrail() {
    if (
      trail.dirty &&
      trail.historyPoints.length === 0 &&
      trail.sessionPoints.length === 0 &&
      trail.points.length > 0
    ) {
      trail.historyPoints = trail.points.slice(-effectiveTrailLimit());
    }
    ensureTrailCanvasSize();
    ensureSessionCanvasSize();
    if (trail.dirty) {
      renderHistoryTrail();
      trail.glowDirty = true;
    }
    if (trail.sessionDirty) {
      renderSessionTrail();
      trail.glowDirty = true;
    }
    scheduleGlowRender();
  }

  function scheduleTrailRender() {
    if (trail.renderFrameId !== null || disposed) {
      return;
    }
    trail.renderFrameId = window.requestAnimationFrame(() => {
      trail.renderFrameId = null;
      drawTrail();
    });
  }

 function startLoop() {
    if (motion.animationId !== null) {
      return;
    }

    motion.lastFrameAt = performance.now();
    motion.animationId = window.requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (motion.animationId === null) {
      return;
    }

    window.cancelAnimationFrame(motion.animationId);
    motion.animationId = null;
    motion.lastFrameAt = null;
  }

  function clearHeightGateTicker() {
    if (collab.heightGateTickerId !== null) {
      window.clearInterval(collab.heightGateTickerId);
      collab.heightGateTickerId = null;
    }
  }

  function activeHeightGateRemainingSeconds(now = performance.now()) {
    if (!collab.heightGateState.activeGate) {
      return 0;
    }
    return Math.max(0, Math.ceil((collab.heightGateDeadlineAt - now) / 1000));
  }

  function renderHeightGateStatus() {
    const active = collab.heightGateState.activeGate;
    const blocked = Boolean(active);
    rock.classList.toggle("is-height-gate-blocked", blocked);
    if (!heightGateStatus) {
      return;
    }
    heightGateStatus.hidden = !blocked;
    heightGateStatus.setAttribute("aria-hidden", String(!blocked));
    heightGateStatus.textContent = blocked
      ? `Остановка на ${active.heightPercent}% · продолжение через ${activeHeightGateRemainingSeconds()} с`
      : "";
  }

  function syncHeightGateState(payload = {}, serverTime = Date.now()) {
    const passedGateIds = Array.isArray(payload.passedGateIds)
      ? payload.passedGateIds.map(String)
      : [];
    const rawActive = payload.activeGate;
    const activeGate =
      rawActive &&
      typeof rawActive.id === "string" &&
      Number.isFinite(Number(rawActive.heightPercent)) &&
      Number.isFinite(Number(rawActive.unlockAt))
        ? {
            id: rawActive.id,
            heightPercent: Number(rawActive.heightPercent),
            unlockAt: Number(rawActive.unlockAt),
          }
        : null;
    collab.heightGateState = {
      passedGateIds: new Set(passedGateIds),
      activeGate,
    };
    clearHeightGateTicker();
    collab.heightGateDeadlineAt = activeGate
      ? performance.now() + Math.max(0, activeGate.unlockAt - Number(serverTime))
      : 0;
    renderHeightGateStatus();
    if (activeGate) {
      collab.heightGateTickerId = window.setInterval(
        renderHeightGateStatus,
        250,
      );
    }
  }

  function resetHeightGateState() {
    clearHeightGateTicker();
    collab.heightGateState = {
      passedGateIds: new Set(),
      activeGate: null,
    };
    collab.heightGateDeadlineAt = 0;
    renderHeightGateStatus();
  }

  function heightGateCanonicalY(gate) {
    return SharedPhysics.WORLD_HEIGHT * (1 - gate.heightPercent / 100);
  }

  function constrainLocalHeightGateY(fromY, desiredY) {
    if (!collab.enabled || desiredY >= fromY) {
      return desiredY;
    }
    const fromCanonicalY = localToCanonical(0, fromY).y;
    const desiredCanonicalY = localToCanonical(0, desiredY).y;
    const active = collab.heightGateState.activeGate;
    const gate =
      active ||
      SharedRoomSettings.sanitizeHeightGates(params.heightGates).find(
        (candidate) => {
          if (collab.heightGateState.passedGateIds.has(candidate.id)) {
            return false;
          }
          const gateY = heightGateCanonicalY(candidate);
          return fromCanonicalY >= gateY && desiredCanonicalY <= gateY;
        },
      );
    if (!gate) {
      return desiredY;
    }
    return canonicalToLocal(0, heightGateCanonicalY(gate)).y;
  }

  function rockInsideImprint() {
    const imprint = activeLocalImprint();
    return Boolean(
      imprint &&
        Math.abs(motion.x - imprint.x) <= imprint.toleranceX &&
        Math.abs(motion.y - imprint.y) <= imprint.toleranceY
    );
  }

  function resetFinalFallGate() {
    finalFallGate.enteredAt = null;
    finalFallGate.ready = false;
  }

  function syncFinalFallGate(now = performance.now()) {
    const insideWhileHeld =
      params.finalFallEnabled &&
      motion.dragging &&
      motion.phase === PHASES.PLAY &&
      rockInsideImprint();
    if (!insideWhileHeld) {
      resetFinalFallGate();
      return false;
    }
    if (finalFallGate.enteredAt === null) {
      finalFallGate.enteredAt = now;
    }
    finalFallGate.ready =
      now - finalFallGate.enteredAt >=
      params.finalFallDelaySeconds * 1000;
    return finalFallGate.ready;
  }

  function beginFinalReturnFall() {
    const state = SharedPhysics.sanitizeState(currentSharedState());
    if (!SharedPhysics.beginFinalFall(state)) {
      return false;
    }
    resetFinalFallGate();
    setPhase(state.phase);
    applyCanonicalMotion(state);
    armSummitRainScroll();
    return true;
  }

  function syncReturnTheme() {
    if (motion.phase === PHASES.INTRO) {
      motion.wasAtReturnPlace = false;
      setTheme(resolveTheme("dark"), { durationMs: 0 });
      hideReturnRain({ immediate: true });
      return;
    }
    const atReturnPlace =
      (motion.phase === PHASES.PLAY || motion.phase === PHASES.WON) &&
      rockInsideImprint();
    syncFinalFallGate();
    const nextTheme = resolveTheme(atReturnPlace ? "light" : "dark");
    motion.wasAtReturnPlace = atReturnPlace;
    setTheme(nextTheme, {
      durationMs: returnThemeTransitionDuration(atReturnPlace),
    });
  }

  function enterPlayPhase() {
    setPhase(PHASES.PLAY);
    setTheme(resolveTheme("dark"));
    rock.classList.remove("is-falling");
  }

  function clearFirstFallTimer() {
    if (motion.introFallTimerId !== null) {
      window.clearTimeout(motion.introFallTimerId);
      motion.introFallTimerId = null;
    }
  }

  function applyPhysics(deltaSeconds) {
    if (motion.dragging || motion.phase === PHASES.WON) {
      return;
    }

    const state = SharedPhysics.sanitizeState(currentSharedState());
    const previousPhase = state.phase;
    const previousY = motion.y;
    const wasAboveGround = state.y < SharedPhysics.WORLD_HEIGHT - 0.01;
    state.turbTime = motion.turbTime;
    SharedPhysics.stepState(
      state,
      SharedPhysics.sanitizePhysics(params),
      deltaSeconds,
      sceneMotionOptions()
    );
    maybeActivateRockPhysicsScale(state);
    const touchedGroundCanonical =
      wasAboveGround && state.y >= SharedPhysics.WORLD_HEIGHT - 0.01;
    applyCanonicalMotion(state);
    const touchedGround =
      touchedGroundCanonical ||
      (previousY < bounds.maxY - 0.75 && motion.y >= bounds.maxY - 0.75);
    if (touchedGround) {
      playArmedGroundImpactSound();
      settleSceneTwoRockScaleOnGround();
    }
    resetTrailOnGroundTouch(touchedGround);
    if (previousPhase === PHASES.FALLING && state.phase === PHASES.PLAY) {
      enterPlayPhase();
    } else {
      syncReturnTheme();
    }
  }

  function tick(now) {
    const deltaSeconds = clamp(
      (now - (motion.lastFrameAt || now)) / 1000,
      0,
      MAX_FRAME_SECONDS
    );
    motion.lastFrameAt = now;
    observeGlowFrameTime(deltaSeconds, now);

    updateBounds();

    if (
      motion.dragging &&
      (motion.phase === PHASES.INTRO || motion.phase === PHASES.PLAY)
    ) {
      applyDragTargetMovement(deltaSeconds);
      if (localRockAboveSceneTwoBarrier()) {
        forceReleaseRock({ barrierHop: true });
      }
      syncReturnTheme();
    }

    if (motion.phase === PHASES.FALLING || motion.phase === PHASES.PLAY) {
      applyPhysics(deltaSeconds);
      if (shouldRecordTrailPoint()) {
        recordTrailPoint(deltaSeconds);
      }
    }

    updateCameraFollow();

    const needsNextFrame =
      motion.phase !== PHASES.WON &&
      (motion.dragging ||
        motion.phase === PHASES.FALLING ||
        (!motion.suspended &&
          (motion.y < bounds.maxY - 0.75 ||
            Math.abs(motion.vx) > 0.5 ||
            Math.abs(motion.vy) > 0.5)));
    if (needsNextFrame) {
      motion.animationId = window.requestAnimationFrame(tick);
    } else {
      motion.animationId = null;
      motion.lastFrameAt = null;
    }
  }

  function recordPointerVelocity(event) {
    const now = performance.now();

    if (motion.lastPointerAt > 0) {
      const deltaSeconds = Math.max((now - motion.lastPointerAt) / 1000, 0.001);
      motion.pointerVx = (event.clientX - motion.lastPointerX) / deltaSeconds;
      motion.pointerVy = (event.clientY - motion.lastPointerY) / deltaSeconds;
    }

    motion.lastPointerX = event.clientX;
    motion.lastPointerY = event.clientY;
    motion.lastPointerAt = now;
  }

  function currentPointerVelocity() {
    if (
      motion.lastPointerAt <= 0 ||
      performance.now() - motion.lastPointerAt > POINTER_VELOCITY_MAX_AGE_MS
    ) {
      return { vx: 0, vy: 0 };
    }
    return { vx: motion.pointerVx, vy: motion.pointerVy };
  }

  function releasePointerCapture(pointerId) {
    if (pointerId !== null && rock.hasPointerCapture(pointerId)) {
      rock.releasePointerCapture(pointerId);
    }
  }

  function applyReleaseImpulse(pointerVelocity = currentPointerVelocity()) {
    const state = SharedPhysics.sanitizeState(currentSharedState());
    const velocity = localVelocityToCanonical(
      pointerVelocity.vx,
      pointerVelocity.vy
    );
    SharedPhysics.applyReleaseImpulse(
      state,
      SharedPhysics.sanitizePhysics(params),
      velocity.vx,
      velocity.vy
    );
    const localVelocity = canonicalVelocityToLocal(state.vx, state.vy);
    motion.vx = localVelocity.vx;
    motion.vy = localVelocity.vy;
    motion.suspended = false;
  }

  function forceReleaseRock(options = {}) {
    const neutral = options.neutral === true;
    if (collab.enabled) {
      forceReleaseSharedDrag(true, neutral, options.barrierHop === true);
      return;
    }

    if (!motion.dragging) {
      return;
    }
    beginSceneTwoAirborneScale();
    const pointerId = motion.activePointerId;
    const phaseAtRelease = motion.phase;
    const releasedInImprint =
      phaseAtRelease === PHASES.PLAY && rockInsideImprint();
    const finalFallReady =
      releasedInImprint && syncFinalFallGate();
    motion.dragging = false;
    motion.activePointerId = null;
    rock.classList.remove("is-dragging");
    setGrabbingCursor(false);
    releasePointerCapture(pointerId);

    resetFinalFallGate();
    if (finalFallReady) {
      beginFinalReturnFall();
    } else if (neutral) {
      motion.vx = 0;
      motion.vy = 0;
      motion.suspended = false;
    } else if (options.barrierHop === true) {
      const state = SharedPhysics.sanitizeState(currentSharedState());
      SharedPhysics.applyBarrierHopImpulse(state, localBarrierHopOptions());
      const velocity = canonicalVelocityToLocal(state.vx, state.vy);
      motion.vx = velocity.vx;
      motion.vy = velocity.vy;
      motion.suspended = false;
    } else {
      applyReleaseImpulse();
    }
    setHandToGrab();
    if (releasedInImprint) {
      armSummitRainScroll();
    }
    rock.classList.add("is-falling");
    syncReturnTheme();
    startLoop();
  }

  function localRockAboveSceneTwoBarrier() {
    if (!preclickRockGuidance.completed || !params.sceneTwoBarrierEnabled) {
      return false;
    }
    const position = localToCanonical(motion.x, motion.y);
    return SharedRoomSettings.stateAboveSceneTwoBarrier(
      position,
      params,
      SharedPhysics.WORLD_HEIGHT,
    );
  }

  function localBarrierHopOptions() {
    return {
      easingPoints: SharedRoomSettings.parseCubicBezier(
        params.sceneTwoBarrierHopSpeedEasing,
      ),
      maxDistancePercent: params.sceneTwoBarrierHopMaxDistancePercent,
      speedPxPerSecond: params.sceneTwoBarrierHopSpeedPxPerSecond,
    };
  }

  function requestSceneTwoBarrierHop(event) {
    if (!localRockAboveSceneTwoBarrier()) {
      return false;
    }
    event.preventDefault();
    updateBounds();
    const position = localToCanonical(motion.x, motion.y);
    if (collab.enabled) {
      if (!collab.connected) {
        updateSessionStatus();
        return true;
      }
      collab.pendingControl = true;
      const pointer = updateLocalSharedPointer(
        event,
        "grab",
        !handIsHidden(),
      );
      sendShared("control.acquire", { ...position, pointer });
      updateSessionStatus();
      return true;
    }

    const missed =
      Math.random() * 100 < params.sceneTwoBarrierHopMissProbabilityPercent;
    if (missed) {
      return true;
    }
    const state = {
      ...position,
      vx: 0,
      vy: 0,
      dragging: false,
      controllerId: null,
      suspended: false,
    };
    SharedPhysics.applyBarrierHopImpulse(state, localBarrierHopOptions());
    const velocity = canonicalVelocityToLocal(state.vx, state.vy);
    motion.vx = velocity.vx;
    motion.vy = velocity.vy;
    motion.suspended = false;
    beginSceneTwoAirborneScale();
    rock.classList.add("is-falling");
    startLoop();
    return true;
  }

  function startDrag(event) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    const sceneTwoActive = preclickRockGuidance.completed;

    if (motion.phase === PHASES.FALLING) {
      if (sceneTwoActive) {
        playGachiClickSound();
      }
      return;
    }

    if (motion.phase !== PHASES.PLAY) {
      if (sceneTwoActive) {
        playGachiClickSound();
      }
      return;
    }

    if (sceneTwoActive && requestSceneTwoBarrierHop(event)) {
      return;
    }

    if (consumePreclickGuardClick(event)) {
      return;
    }

    if (sceneTwoActive) {
      playGachiClickSound();
    }

    completePreclickRockGuidance({ preserveHopPosition: true });
    playDrizzleLoopSound();
    playRockPointerDownSound();

    if (collab.enabled) {
      beginSharedDrag(event);
      return;
    }

    event.preventDefault();
    armGroundImpactSound();
    scheduleGrabbingHandImage();
    updateBounds();
    motion.suspended = false;
    motion.dragging = true;
    beginSceneTwoGrabScale();
    motion.activePointerId = event.pointerId;
    setGrabPointFromPointer(event);
    motion.dragTargetX = motion.x;
    motion.dragTargetY = motion.y;
    motion.pointerVx = 0;
    motion.pointerVy = 0;
    motion.lastPointerAt = 0;
    recordPointerVelocity(event);
    showHandCursor(event);
    rock.classList.remove("is-falling");
    rock.classList.add("is-dragging");
    rock.setPointerCapture(event.pointerId);
    syncReturnTheme();
    startLoop();
  }

  function pointerTargetIsInteractive(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return false;
    }
    return Boolean(
      settingsToggle?.contains(target) ||
        settingsPanel?.contains(target) ||
        target.closest(
          'a, button, input, select, textarea, [contenteditable="true"], [role="button"]',
        ),
    );
  }

  function startExpandedRockDrag(event) {
    const barrierAttempt = localRockAboveSceneTwoBarrier();
    if (
      event.pointerType !== "mouse" ||
      event.button !== 0 ||
      event.isPrimary === false ||
      (!barrierAttempt && params.rockGrabRadiusVh <= 0) ||
      event.composedPath().includes(rock) ||
      pointerTargetIsInteractive(event)
    ) {
      return;
    }

    const rockRect = rock.getBoundingClientRect();
    const radius = barrierAttempt
      ? rockRect.width *
        (params.sceneTwoBarrierHopActivationRadiusPercent / 100)
      : (params.rockGrabRadiusVh / 100) * window.innerHeight;
    if (
      !cursorCircleIntersectsRect({
        x: event.clientX,
        y: event.clientY,
        radius,
        rect: rockRect,
      })
    ) {
      return;
    }

    startDrag(event);
  }

  function moveDrag(event) {
    if (collab.enabled) {
      moveSharedDrag(event);
      return;
    }

    if (!motion.dragging || motion.phase !== PHASES.PLAY) {
      moveHandCursor(event);
      return;
    }

    moveHandCursor(event);

    event.preventDefault();
    recordPointerVelocity(event);
    setDragTargetFromPointer(event);
  }

  function stopDrag(event) {
    if (collab.enabled) {
      releaseSharedDrag(event);
      return;
    }

    if (!motion.dragging) {
      return;
    }
    beginSceneTwoAirborneScale();
    const phaseAtRelease = motion.phase;
    const releasedInImprint =
      phaseAtRelease === PHASES.PLAY && rockInsideImprint();
    const finalFallReady =
      releasedInImprint && syncFinalFallGate();
    motion.dragging = false;
    motion.activePointerId = null;
    rock.classList.remove("is-dragging");
    setGrabbingCursor(false);
    releasePointerCapture(event.pointerId);
    const pointerVelocity = currentPointerVelocity();

    resetFinalFallGate();
    if (finalFallReady) {
      beginFinalReturnFall();
    } else {
      applyReleaseImpulse(pointerVelocity);
    }
    setHandToGrab();
    if (releasedInImprint) {
      armSummitRainScroll();
    }
    rock.classList.add("is-falling");
    syncReturnTheme();
    startLoop();
  }

  function enterRock(event) {
    if (motion.phase !== PHASES.PLAY) {
      return;
    }

    playChainHoverSound();
    showHandCursor(event);
    if (collab.enabled) {
      sendSharedPointer(event, "grab", !handIsHidden(), true);
    }
  }

  function leaveRock(event) {
    if (!motion.dragging) {
      if (!handIsAlwaysVisible()) {
        hideHandCursor();
      }
      if (collab.enabled) {
        sendSharedPointer(
          event,
          "grab",
          handIsAlwaysVisible(),
          true,
        );
      }
    }
  }

  function cancelDragAndCursor() {
    releaseRockPress();
    if (collab.enabled && motion.dragging) {
      forceReleaseSharedDrag(true);
      return;
    }

    motion.dragging = false;
    motion.activePointerId = null;
    rock.classList.remove("is-dragging");
    setHandToGrab();
    hideHandCursor();
    syncReturnTheme();
    if (collab.enabled) {
      sendSharedPointer(null, "grab", false, true);
    }
  }

  settingsController.bind();
  listen(sessionRestartButton, "click", restartExperience);
  listen(document, "visibilitychange", () => {
    if (document.hidden) {
      flushTrailNetworkQueue();
      stopRockPulse();
    } else {
      syncRockPulse();
    }
  });

  // Открытием панели управляет React-хук useSettings.
  listen(window, "pointermove", updatePreclickRockGuidance, { passive: true });
  listen(window, "pointerdown", pressAlwaysVisibleHand);
  listen(window, "pointerdown", startExpandedRockDrag);
  listen(settingsToggle, "pointerenter", showNativeSettingsCursor);
  listen(settingsToggle, "pointerleave", hideNativeSettingsCursor);
  listen(settingsPanel, "pointerenter", showNativeSettingsCursor);
  listen(settingsPanel, "pointerleave", hideNativeSettingsCursor);
  listen(sessionPanel, "pointerenter", showNativeSettingsCursor);
  listen(sessionPanel, "pointerleave", hideNativeSettingsCursor);
  listen(rock, "pointerenter", enterRock);
  listen(rock, "pointerleave", leaveRock);
  listen(rock, "pointerdown", startDrag);
  listen(rock, "pointermove", moveDrag);
  listen(rock, "pointerup", stopDrag);
  listen(rock, "pointercancel", stopDrag);
  listen(rock, "lostpointercapture", () => {
    if (motion.dragging) {
      forceReleaseRock();
    } else {
      releaseRockPress();
    }
  });
  listen(rock, "dragstart", (event) => event.preventDefault());
  listen(window, "pointerup", stopDrag);
  listen(window, "pointercancel", stopDrag);
  listen(window, "pointerup", releaseAlwaysVisibleHand);
  listen(window, "pointercancel", releaseAlwaysVisibleHand);
  listen(window, "wheel", (event) => {
    if (event.deltaY > 0) {
      markSummitRainScrollIntent();
    }
  }, { passive: true });
  listen(window, "touchstart", (event) => {
    rain.touchY = event.touches[0]?.clientY ?? null;
  }, { passive: true });
  listen(window, "touchmove", (event) => {
    const nextTouchY = event.touches[0]?.clientY ?? null;
    if (
      nextTouchY !== null &&
      rain.touchY !== null &&
      nextTouchY < rain.touchY
    ) {
      markSummitRainScrollIntent();
    }
    rain.touchY = nextTouchY;
  }, { passive: true });
  listen(window, "keydown", (event) => {
    if (["ArrowDown", "PageDown", "End", " "].includes(event.key)) {
      markSummitRainScrollIntent();
    }
  });
  listen(window, "blur", cancelDragAndCursor);
  listen(
    window,
    "scroll",
    syncAfterScroll,
    { passive: true }
  );
  listen(window, "resize", () => {
    fitTopInscription();
    updateBounds();
    applyViewportScaledVisuals();
    reprojectTrail();
    resizeTrailCanvas();
    if (collab.enabled && collab.snapshots.length > 0) {
      applySharedFrame(collab.snapshots.at(-1));
    } else if (motion.phase === PHASES.INTRO || motion.suspended) {
      centerIntroRock();
    } else {
      setPosition(motion.x, motion.y);
    }
    renderImprint();
    restartPreclickRockHopFromLastPointer();
  });

  function initScene() {
    fitTopInscription();
    renderSummitTimer();
    centerIntroRock();
    collab.imprint = createSummitSharedImprint();
    renderImprint();
    setPhase(PHASES.PLAY);
    motion.suspended = true;
    motion.wasAtReturnPlace = false;
    setTheme(resolveTheme("dark"));
    resetSummitRainScroll();
    motion.sceneReady = true;
    showInitialHandCursor();
    resizeTrailCanvas();
    updateSessionStatus();
    if (collab.enabled) {
      void createSharedSession();
    }
  }

  let testApi = null;
  if (import.meta.env.DEV) {
    testApi = {
      SharedPhysics,
      applyPhysics,
      applySharedRoomSettings,
      applyDragTargetMovement,
      bounds,
      canonicalToLocal,
      collab,
      currentSharedState,
      initialSharedState,
      motion,
      params,
      updateCameraFollow,
      getLastRainRendererProfile: () => {
        const profile = rain.lastProfile;
        return profile
          ? {
              theme: profile.theme,
              fallbackColor: [...profile.fallbackColor],
              raindropDiffuseLight: [...profile.raindropDiffuseLight],
              raindropSpecularLight: [...profile.raindropSpecularLight],
            }
          : null;
      },
      getViewportScale: () => ({ x: 1, y: 1 }),
      getRenderedVisualSettings: () => ({
        lineWidth: scaledVisualPixel(params.lineWidth),
        rainBlurPx: scaledVisualPixel(params.rainBlurPx),
      }),
      getRockVisualScaleState: () => ({
        pressActive: motion.rockPressActive,
        pressShrinkPercent: params.rockPressShrinkPercent,
        pulseScaleFactor: motion.rockPulseScaleFactor,
        pulseShrinkPercent: params.rockPulseShrinkPercent,
        visualShrinkScaleFactor: visualShrinkScaleFactor(),
        sceneTwoSizeState: motion.sceneTwoSizeState,
        sceneTwoSizeCycleArmed: motion.sceneTwoSizeCycleArmed,
      }),
      beginSceneTwoAirborneScale,
      settleSceneTwoRockScaleOnGround,
      getRoleAudioState: () => {
        const state = roleAudioFade.latest;
        return {
          fadeActive: state?.frameId !== null && state?.frameId !== undefined,
          fadeDurationMs: state?.durationMs ?? 0,
          fadeTargetVolume: state?.targetVolume ?? 0,
          role: state?.role ?? null,
          volume: state?.audio?.volume ?? 0,
        };
      },
      getSessionAudioState: () =>
        sessionRoleAudio.latest ? { ...sessionRoleAudio.latest } : null,
      getGachiClickAudioState: () => ({
        active: gachiClickAudio.elements.size > 0,
        activeCount: gachiClickAudio.elements.size,
        lastFilename: gachiClickAudio.lastFilename,
        playCount: gachiClickAudio.playCount,
        stopCount: gachiClickAudio.stopCount,
      }),
      playGachiClickSound,
      stopGachiClickSound,
      completePreclickRockGuidance,
      getGroundImpactAudioState: () => ({
        armed: groundImpactAudio.armed,
        activeCount: groundImpactAudio.elements.size,
        lastFilename: groundImpactAudio.lastFilename,
        playCount: groundImpactAudio.playCount,
      }),
      getWallImpactAudioState: () => ({
        activeCount: wallImpactAudio.elements.size,
        lastFilename: wallImpactAudio.lastFilename,
        playCount: wallImpactAudio.playCount,
      }),
      getSummitRainScrollState: () => ({
        armed: rain.scrollArmed,
        completed: rain.scrollCompleted,
        started: rain.scrollStarted,
        unlocked: rain.scrollUnlocked,
        opacity: Number(
          rainLayer?.style.getPropertyValue("--rain-scroll-opacity") || 0,
        ),
        maxVolume: params.rainMaxVolume,
        volume: rainLoopAudio.volume,
        visible: Boolean(rainLayer?.classList.contains("is-rain-visible")),
      }),
      armSummitRainScroll,
      armGroundImpactSound,
      applyTestSettings,
      receiveSharedSnapshot,
      syncSharedGroundTouchSeq,
      getPreclickHopState: () => ({
        enabled: true,
        completed: preclickRockGuidance.completed,
        finePointer: finePointer.matches,
        hopCount: preclickRockGuidance.hopCount,
        radiusHopCount: preclickRockGuidance.radiusHopCount,
        forcedRadiusMissConsumed:
          preclickRockGuidance.forcedRadiusMissConsumed,
        lastRadiusDecision: preclickRockGuidance.lastRadiusDecision,
        guardClicksUsed: preclickRockGuidance.guardClicksUsed,
        guardClickCount: params.preclickHopGuardClickCount,
        animating: preclickRockGuidance.hopAnimationId !== null,
        insideRadius: preclickRockGuidance.insideRadius,
        outsideRadius: preclickRockGuidance.outsideRadius,
        pointer: {
          x: preclickRockGuidance.pointerX,
          y: preclickRockGuidance.pointerY,
        },
        speedPxPerSecond: preclickRockGuidance.hopSpeedPxPerSecond,
        activeAudioCount: preclickHopAudio.elements.size,
        audioPlayCount: preclickHopAudio.playCount,
        audioStopCount: preclickHopAudio.stopCount,
        lastFilename: preclickHopAudio.lastFilename,
        offset: preclickRockHopOffset(),
      }),
      getTrailState: () => ({
        enabled: params.trailEnabled,
        pointCount: trail.points.length,
        canonicalPointCount: trail.canonicalPoints.length,
        historyPointCount: trail.historyPoints.length,
        sessionPointCount: trail.sessionPoints.length,
        historyRevision: trail.baseRevision,
        sessionRevision: trail.sessionRevision,
        historyRenderPasses: trail.historyRenderPasses,
        sessionRenderPasses: trail.sessionRenderPasses,
        historyStrokeBatches: trail.historyStrokeBatches,
        sessionStrokeBatches: trail.sessionStrokeBatches,
        historyWindowTop: trail.historyWindowTop,
        historyWindowHeight: trail.historyWindowHeight,
        historyPixelRatio: trail.pixelRatio,
        sessionPixelRatio: trail.sessionPixelRatio,
        networkQueueLength: trail.networkPoints.length,
        renderScheduled: trail.renderFrameId !== null,
        sharedRenderScheduled: collab.renderId !== null,
        profile: { ...currentTrailProfile() },
        lastPoint: trail.points.at(-1) || null,
      }),
      getCollaborationDebugState: () => ({
        lastRevision: collab.lastRevision,
        lastRoomSettingsSnapshotHeight:
          collab.lastRoomSettingsSnapshotHeight,
        lastControlSlip: collab.lastControlSlip
          ? { ...collab.lastControlSlip }
          : null,
        pendingRoomSettingKeys: Object.keys(collab.pendingRoomSettingsChanges),
        pendingPhysicsKeys: Object.keys(collab.pendingPhysicsChanges),
        restoringStoredSession: collab.restoringStoredSession,
        roomSettingsHeight: params.sceneHeightScreens,
        sessionId: collab.sessionId,
        settingsRevision: collab.settingsRevision,
        settingsUpdateInFlight: Boolean(collab.settingsUpdateInFlight),
        settingsUpdateQueued: collab.settingsUpdateQueued,
        settingsUpdateTimerActive: collab.settingsUpdateTimerId !== null,
        stagedRoomSettingKeys: [...collab.stagedRoomSettingsChangeKeys],
      }),
      getDrizzleAudioState: () => {
        const loopState = drizzleLoopController.getState();
        return {
          ...loopState,
          fadeActive: drizzleLoopAudio.fadeFrameId !== null,
          fadeDurationMs: drizzleLoopAudio.fadeDurationMs,
          fadeTargetVolume: drizzleLoopAudio.fadeTargetVolume,
          playing: drizzleLoopAudio.playing,
          volume: drizzleLoopAudio.volume,
        };
      },
      getFinalFallGateState: () => ({
        enteredAt: finalFallGate.enteredAt,
        ready: finalFallGate.ready,
      }),
      getSummitTimerState: () => ({
        elapsedMs: currentSummitElapsedMs(),
        running: summitTimer.running,
        serverTime: summitTimer.serverTime,
        text: summitTimerElement?.textContent || "",
      }),
      getHeightGateState: () => ({
        activeGate: collab.heightGateState.activeGate
          ? { ...collab.heightGateState.activeGate }
          : null,
        passedGateIds: [...collab.heightGateState.passedGateIds],
        remainingSeconds: activeHeightGateRemainingSeconds(),
      }),
      getPreclickPopupState: preclickPopupController.getState,
      fitTopInscription,
      drawTrail,
      getGlowRenderState: () => ({
        adaptiveQuality: trail.adaptiveQuality,
        animationFrameId: trail.glowAnimationFrameId,
        baseRevision: trail.baseRevision,
        sessionRevision: trail.sessionRevision,
        glowRevision: trail.glowRevision,
        profile: { ...currentGlowProfile() },
        renderPasses: trail.glowRenderPasses,
        rendered: trail.glowRendered,
        sampledPointCount: trail.glowSampledPointCount,
        timerId: trail.glowTimerId,
      }),
      getRoomSettings: sharedRoomSettingsPayload,
      getRainAudioState: () => {
        const loopState = rainLoopController.getState();
        return {
          ...loopState,
          elementVolume: loopState.fallbackElementVolume,
          fadeDurationMs: rainLoopAudio.fadeDurationMs,
          fadeActive: rainLoopAudio.fadeFrameId !== null,
          fadeMode: rainLoopAudio.fadeMode,
          fadeTargetVolume: rainLoopAudio.fadeTargetVolume,
          gain: loopState.volume,
          paused: !loopState.running,
          playing: rainLoopAudio.playing,
          volume: rainLoopAudio.volume,
        };
      },
      getRainRenderToken: () => rain.renderToken,
      getSettingsVersions: settingsController.getSettingsVersions,
      getLatestSettingsVersionPreset:
        settingsController.getLatestSettingsVersionPreset,
      receiveRemotePointer,
      restartExperience,
      resetTrail,
      sendShared,
      setPosition,
      syncReturnTheme,
      trail,
      trailGlowCanvas,
      trailSessionCanvas,
      checkpointTrail,
      flushTrailNetworkQueue,
      queueSharedTrailPoint,
      loadSharedTrail,
      appendSharedTrail,
      scheduleTrailRender,
      trimTrailToLimit,
      updateBounds,
    };
    window.__sisyphusTestApi = testApi;
    Object.assign(window, testApi);
  }
  const restoredSettingKeys = settingsController.load({
    loadLatestVersion: false,
    loadVersionedSettings: true,
  });
  let restoringPersistedSession = false;
  try {
    restoringPersistedSession = /^[A-Za-z0-9_-]{22}$/.test(
      sessionStorage.getItem("sisyphus-room-session-id") || "",
    );
  } catch {
    /* sessionStorage недоступен */
  }
  collab.restoringStoredSession = restoringPersistedSession;
  readControls();
  if (restoredSettingKeys.length > 0) {
    settingsController.saveSettings();
  }
  let restoredSharedSettings = false;
  restoredSettingKeys.forEach((key) => {
    if (restoringPersistedSession && key === "sceneHeightScreens") {
      return;
    }
    if (
      SHARED_PHYSICS_KEYS.includes(key) ||
      SHARED_ROOM_SETTING_KEYS.includes(key)
    ) {
      stageControlChange(key, params[key]);
      restoredSharedSettings = true;
    }
  });
  if (restoredSharedSettings && !restoringPersistedSession) {
    scheduleSharedSettingsUpdate();
  }
  settingsController.captureCurrentAsBaseline();
  document.fonts?.ready.then(() => {
    if (!disposed) {
      fitTopInscription();
    }
  });

  if (rock.complete) {
    initScene();
  } else {
    listen(rock, "load", initScene, { once: true });
  }

  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      if (elements.foldSettingsRef?.current === params) {
        elements.foldSettingsRef.current = null;
      }
      collab.leaving = true;
      stopLoop();
      stopRockPulse();
      clearHandImageChangeTimer();
      cancelGlowRenderSchedule();
      clearTrailNetworkQueue();
      if (trail.renderFrameId !== null) {
        window.cancelAnimationFrame(trail.renderFrameId);
        trail.renderFrameId = null;
      }
      settingsController.dispose?.();
      preclickPopupController.dispose();
      document.documentElement.classList.remove(
        "is-manual-scroll-disabled",
      );
      document.documentElement.style.overflowY = initialDocumentOverflowY;
      body.classList.remove(
        "is-manual-scroll-disabled",
        "preclick-rock-guidance",
        "hand-always-visible",
        "hand-hidden",
        "is-settings-pointer-active",
      );
      rock.classList.remove("is-preclick-hop");
      preclickRockGuidance.insideRadius = false;
      resetPreclickRockHop();
      stopRainRenderers();
      resetHeightGateState();
      clearFirstFallTimer();
      clearSharedConnectionTimers();
      clearSharedReleaseHandoff();
      window.clearTimeout(collab.statusResetTimerId);
      window.clearTimeout(collab.settingsUpdateTimerId);
      stopRainLoopSound({ immediate: true });
      rainLoopController.dispose();
      stopDrizzleLoopSound({ immediate: true });
      drizzleLoopController.dispose();
      resetFinalFallGate();
      stopHandInteractionSounds({ immediate: true });
      stopGachiClickSound();
      stopPreclickHopSounds();
      groundImpactAudio.elements.forEach(pauseAndResetAudio);
      groundImpactAudio.elements.clear();
      groundImpactAudio.armed = false;
      collab.sessionCreateAbortController?.abort();
      collab.sessionCreateAbortController = null;
      if (collab.renderId !== null) {
        window.cancelAnimationFrame(collab.renderId);
      }
      listenerDisposers.splice(0).forEach((removeListener) => {
        removeListener();
      });
      const socket = collab.socket;
      collab.socket = null;
      collab.connected = false;
      if (socket && socket.readyState < WebSocket.CLOSING) {
        socket.close(1000, "react_unmount");
      }
      if (import.meta.env.DEV && testApi) {
        if (window.__sisyphusTestApi === testApi) {
          Reflect.deleteProperty(window, "__sisyphusTestApi");
        }
        Object.entries(testApi).forEach(([name, value]) => {
          if (window[name] === value) {
            Reflect.deleteProperty(window, name);
          }
        });
      }
      if (rain.hideTimerId !== null) {
        window.clearTimeout(rain.hideTimerId);
        rain.hideTimerId = null;
      }
    },
  };
}
