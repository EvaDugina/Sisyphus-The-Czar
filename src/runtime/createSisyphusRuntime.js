import "../../shared/physics.js";
import "../../shared/room-settings.js";
import "../../shared/gachi-sounds.js";
import "../../shared/chain-sounds.js";
import drizzleAudioUrl from "../../assets/audio/Капель.mp3?url";
import groundImpactAudioUrl from "../../assets/audio/СимуляцияОргазма.mov?url";
import preclickHopAudioUrl from "../../assets/audio/Смех.mp3?url";
import rainAudioUrl from "../../assets/audio/Дождь.mp3?url";
import rainVendorUrl from "../../assets/raindrop-fx/index.js?url";
import { createClientId } from "../lib/clientId.mjs";
import {
  cameraFollowScrollY,
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
import { shouldStartRainExit } from "../lib/rainState.mjs";
import {
  activePreclickMovementDeltaMs,
  calculatePreclickHopTarget,
  calculatePreclickParallaxOffset,
  calculatePreclickParallaxTransition,
  preclickPointerSpeed,
} from "../lib/preclickParallax.mjs";
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
  parseCubicBezier,
  rockActivationScaleFactor,
  rockHorizontalWallCompensation,
  rockLocalXForVisualGrab,
  rockPressScaleFactor,
  rockScaleForY,
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
  settings as productionSettings,
} from "../config/production-preset.mjs";
import { createSettingsController } from "./createSettingsController.js";
import {
  createWindowObstacleController,
  WINDOW_OBSTACLE_PERMISSION,
  windowObstacleHeightFromStartVh,
} from "./createWindowObstacleController.js";

const ROLE_AUDIO_FADE_IN_MS = 300;
const ROLE_AUDIO_VOLUME = 1;
const AUDIO_TOGGLE_FADE_OUT_MS = 250;
const ROCK_ACTIVATION_SCALE_DURATION_MS = 300;
const PRECLICK_ROCK_HOP_ENABLED =
  import.meta.env.EXPERIMENT_PRECLICK_ROCK_HOP === true;
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
  const world = elements.world || document.querySelector(".world");
  const topInscription =
    elements.topInscription || document.querySelector(".top-inscription");
  const summitTimerElement =
    elements.summitTimer || document.querySelector(".summit-timer");
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
  const trailGlowCanvas =
    elements.trailGlowCanvas || document.querySelector(".trail-glow");
  const trailGlowCtx = trailGlowCanvas.getContext("2d");
  const rainLayer = elements.rainLayer || document.querySelector(".weather-rain");
  const rainFxCanvas = elements.rainFxCanvas || document.querySelector(".weather-rain__canvas--fx");
  const rainFallbackCanvas = elements.rainFallbackCanvas || document.querySelector(".weather-rain__canvas--fallback");
  const sessionStatus = elements.sessionStatus || document.querySelector("[data-session-status]");
  const sessionRestartButton =
    elements.sessionRestartButton || document.querySelector(".session-restart");
  const windowObstaclePopupStatus = document.querySelector(
    "[data-window-obstacle-popup-status]",
  );
  const windowObstaclePopupHelp = document.querySelector(
    "[data-window-obstacle-popup-help]",
  );
  const windowObstaclePopupTest = document.querySelector(
    "[data-window-obstacle-popup-test]",
  );
  const finePointer = window.matchMedia("(pointer: fine)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const SharedPhysics = window.SisyphusPhysics;
  const SharedRoomSettings = window.SisyphusRoomSettings;
  const SharedGachiSounds = window.SisyphusGachiSounds;
  const SharedChainSounds = window.SisyphusChainSounds;
  const listenerDisposers = [];
  let disposed = false;
  const productionRuntime = import.meta.env.PROD;
  const navigationEntry = window.performance
    ?.getEntriesByType?.("navigation")
    ?.at(0);
  let reloadViewportRestorePending = navigationEntry?.type === "reload";

  function listen(target, type, listener, options) {
    if (!target || typeof target.addEventListener !== "function") {
      return;
    }
    target.addEventListener(type, listener, options);
    listenerDisposers.push(() => {
      target.removeEventListener(type, listener, options);
    });
  }

  const trail = {
    points: [],
    canonicalPoints: [],
    lastX: null,
    lastY: null,
    followX: null,
    followY: null,
    pixelRatio: 1,
    glowPixelRatio: 1,
    dirty: true,
    glowDirty: true,
    baseRevision: 0,
    glowRevision: 0,
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
    rockPulseEnabled:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rockPulseEnabled,
    rockPulseBpm: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rockPulseBpm,
    preclickParallaxMaxOffsetVw:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.preclickParallaxMaxOffsetVw,
    preclickParallaxEndMaxOffsetVw:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.preclickParallaxEndMaxOffsetVw,
    preclickParallaxMaxOffsetEasing:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.preclickParallaxMaxOffsetEasing,
    preclickParallaxActivationRadiusVw:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS
        .preclickParallaxActivationRadiusVw,
    preclickParallaxStartDelayMs:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.preclickParallaxStartDelayMs,
    preclickParallaxEndDelayMs:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.preclickParallaxEndDelayMs,
    preclickParallaxDelayEasing:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.preclickParallaxDelayEasing,
    preclickParallaxTransitionDurationSeconds:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS
        .preclickParallaxTransitionDurationSeconds,
    preclickParallaxInverted:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.preclickParallaxInverted,
    preclickParallaxReturnDurationMs:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS
        .preclickParallaxReturnDurationMs,
    preclickParallaxReturnEasing:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.preclickParallaxReturnEasing,
    customCursorEnabled:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.customCursorEnabled,
    customCursorSizePx:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.customCursorSizePx,
    handAlwaysVisible:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.handAlwaysVisible,
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
    trailUnlimited: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.trailUnlimited,
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
    turbTime: 0,
    imprint: null,
    wasAtReturnPlace: false,
  };
  const preclickRockGuidance = {
    activeMovementTimeMs: 0,
    completed: false,
    delayStartedAtMs: null,
    pointerX: null,
    pointerY: null,
    movementSampleAtMs: null,
    movementSampleX: null,
    movementSampleY: null,
    directionX: null,
    directionY: null,
    delayTimerId: null,
    delayReady: false,
    insideRadius: false,
    returnAnimationId: null,
    outsideRadius: false,
    hopCount: 0,
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
  body.classList.toggle("hand-always-visible", params.handAlwaysVisible);
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

  function applySummitTimerSnapshot(payload) {
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
    element: null,
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
  const windowObstacleController = createWindowObstacleController({
    getHeightVh: () => {
      const start = initialLocalPosition();
      return windowObstacleHeightFromStartVh(
        motion.y + bounds.rockHeight / 2,
        start.y + bounds.rockHeight / 2,
        window.innerHeight,
      );
    },
    getSettings: () => SharedRoomSettings.sanitizeRoomSettings(params),
    onActiveWindowsChange: (count) => {
      const blocked = count > 0;
      body.classList.toggle("is-window-obstacle-active", blocked);
      rock.classList.toggle("is-window-obstacle-blocked", blocked);
      if (blocked) {
        rock.setAttribute("aria-disabled", "true");
        if (motion.dragging) {
          forceReleaseRock({ neutral: true });
        }
      } else {
        rock.removeAttribute("aria-disabled");
      }
    },
    onPermissionChange: (permission, label) => {
      if (windowObstaclePopupStatus) {
        windowObstaclePopupStatus.dataset.state = permission;
        windowObstaclePopupStatus.textContent = label;
      }
      if (windowObstaclePopupHelp) {
        windowObstaclePopupHelp.hidden =
          permission !== WINDOW_OBSTACLE_PERMISSION.BLOCKED;
      }
      if (windowObstaclePopupTest) {
        windowObstaclePopupTest.disabled =
          permission === WINDOW_OBSTACLE_PERMISSION.TEST_OPENED;
      }
    },
  });
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
    if (!PRECLICK_ROCK_HOP_ENABLED || typeof Audio !== "function") {
      return;
    }
    const audio = new Audio(preclickHopAudioUrl);
    audio.preload = "auto";
    const releaseAudio = () => {
      preclickHopAudio.elements.delete(audio);
    };
    audio.addEventListener("ended", releaseAudio);
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

  function playGachiClickSound() {
    if (typeof Audio !== "function") {
      return;
    }
    const filenames = availableGachiClickSounds();
    if (filenames.length === 0) {
      return;
    }
    const playToken = gachiClickAudio.playToken;
    const filename =
      filenames[Math.floor(Math.random() * filenames.length)];
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
    if (!groundImpactAudio.element) {
      groundImpactAudio.element = new Audio(groundImpactAudioUrl);
      groundImpactAudio.element.preload = "auto";
    }
    const audio = groundImpactAudio.element;
    try {
      audio.currentTime = 0;
      audio.volume = 1;
      const promise = audio.play();
      if (promise && typeof promise.catch === "function") {
        promise.catch(() => {});
      }
      groundImpactAudio.lastFilename = "СимуляцияОргазма.mov";
      groundImpactAudio.playCount += 1;
    } catch {
      // Ошибка отдельного звука не должна останавливать физический цикл.
    }
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
    drawTrail();
  }

  function applySceneHeight() {
    document.documentElement.style.setProperty(
      "--scene-height-vh",
      `${params.sceneHeightScreens * 100}vh`
    );
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

  function showReturnRain() {
    rain.returnRequested = true;
    syncRainVisibility();
  }

  function hideReturnRain(options = {}) {
    rain.returnRequested = false;
    syncRainVisibility(options);
  }

  function syncReturnRain(isAtReturnPlace) {
    if (isAtReturnPlace) {
      showReturnRain();
    } else {
      hideReturnRain();
    }
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
    trail.dirty = true;
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
    body.classList.toggle("hand-always-visible", params.handAlwaysVisible);
    if (!params.handAlwaysVisible && !motion.dragging) {
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
        "preclickParallaxMaxOffsetVw",
        "preclickParallaxEndMaxOffsetVw",
        "preclickParallaxMaxOffsetEasing",
        "preclickParallaxActivationRadiusVw",
        "preclickParallaxStartDelayMs",
        "preclickParallaxEndDelayMs",
        "preclickParallaxDelayEasing",
        "preclickParallaxTransitionDurationSeconds",
        "preclickParallaxInverted",
        "preclickParallaxReturnDurationMs",
        "preclickParallaxReturnEasing",
      )
    ) {
      restartPreclickRockParallaxFromLastPointer();
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
    if (shouldHandleChange("handAlwaysVisible")) {
      applyHandVisibilitySetting();
    }
    if (shouldHandleChange("customCursorEnabled", "customCursorSizePx")) {
      applyCustomCursorSettings();
    }
    if (shouldHandleChange("rockPulseEnabled", "rockPulseBpm")) {
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
      const trailLengthInput =
        settingsController.roomSettingControlElement("trailMaxPoints");
      if (trailLengthInput) {
        trailLengthInput.disabled = params.trailUnlimited;
        trailLengthInput
          .closest(".control")
          ?.classList.toggle("is-disabled", params.trailUnlimited);
      }
      settingsController.updateControlOutputs();
    }
    trimTrailToLimit();

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
    if (preservedState) {
      applyCanonicalMotion(preservedState);
    } else if (
      shouldHandleChange(
        "rockMinWidthVw",
        "rockMaxWidthVw",
        "rockScaleEasing",
        "rockPressShrinkPercent",
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
        "trailAnchorHeightPercent",
      )
    ) {
      reprojectTrail();
    }
    if (trail.dirty || trail.glowDirty) {
      drawTrail();
    }
    if (preserveBottomScroll) {
      scrollToSceneBottom();
    }
    if (
      collab.enabled &&
      localCanEditSettings() &&
      !collab.applyingRemotePhysics
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
      if (broadcastChanges && hasPhysicsChanges) {
        scheduleSharedPhysicsUpdate();
      }
    }
    if (
      collab.enabled &&
      localCanEditSettings() &&
      !collab.applyingRemoteRoomSettings
    ) {
      let hasRoomSettingsChanges = false;
      changedKeys.forEach((key) => {
        if (SHARED_ROOM_SETTING_KEYS.includes(key)) {
          collab.pendingRoomSettingsChanges[key] = params[key];
          if (broadcastChanges) {
            collab.stagedRoomSettingsChangeKeys.delete(key);
          }
          hasRoomSettingsChanges = true;
        }
      });
      if (broadcastChanges && hasRoomSettingsChanges) {
        scheduleSharedRoomSettingsUpdate();
      }
    }
    windowObstacleController.refresh();
  }

  function readControls(options = {}) {
    const {
      changedKeys,
      fullRefresh,
      hasTargetedChanges,
      shouldHandleChange,
    } = settingsChangeContext(options);
    const sceneHeightChanging = shouldHandleChange("sceneHeightScreens");

    const previousRoomSettings =
      sceneHeightChanging ? sharedRoomSettingsPayload() : null;
    const preservedState =
      sceneHeightChanging ? currentSharedState() : null;
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

  function canShowPhotoCursor(event) {
    return (
      motion.phase === PHASES.PLAY &&
      finePointer.matches &&
      (!event.pointerType || event.pointerType === "mouse")
    );
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
    if (finePointer.matches && params.handAlwaysVisible) {
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
      params.handAlwaysVisible || motion.dragging || pointerIsOverRock(event),
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
    if (!params.handAlwaysVisible && !pointerIsOverRock(event)) {
      return;
    }
    handCursor.classList.add("is-visible");
    setGrabbingCursor(true);
  }

  function releaseAlwaysVisibleHand(event) {
    if (
      (event.pointerType && event.pointerType !== "mouse") ||
      motion.dragging
    ) {
      return;
    }

    setGrabbingCursor(false);
    if (!params.handAlwaysVisible && !pointerIsOverRock(event)) {
      hideHandCursor();
    }
  }

  function showNativeSettingsCursor() {
    body.classList.add("is-settings-pointer-active");
  }

  function hideNativeSettingsCursor() {
    body.classList.remove("is-settings-pointer-active");
  }

  function toggleHandVariant() {
    motion.alternateHand = !motion.alternateHand;
    handCursor.classList.toggle("is-alternate", motion.alternateHand);
  }

  function setHandToGrab() {
    motion.alternateHand = false;
    handCursor.classList.remove("is-alternate", "is-grabbing");
  }

  function setPreclickRockParallaxOffset(x, y) {
    rock.style.setProperty("--rock-parallax-x", `${x}px`);
    rock.style.setProperty("--rock-parallax-y", `${y}px`);
  }

  function preclickRockParallaxOffset() {
    const style = window.getComputedStyle(rock);
    return {
      x: Number.parseFloat(style.getPropertyValue("--rock-parallax-x")) || 0,
      y: Number.parseFloat(style.getPropertyValue("--rock-parallax-y")) || 0,
    };
  }

  function preclickRockBaseCenter(offset = preclickRockParallaxOffset()) {
    const rect = rock.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 - offset.x,
      y: rect.top + rect.height / 2 - offset.y,
    };
  }

  function cancelPreclickGuidanceReturn() {
    if (preclickRockGuidance.returnAnimationId === null) {
      return;
    }
    window.cancelAnimationFrame(preclickRockGuidance.returnAnimationId);
    preclickRockGuidance.returnAnimationId = null;
  }

  function resetPreclickRockParallax() {
    cancelPreclickGuidanceReturn();
    rock.classList.remove("is-preclick-hop");
    setPreclickRockParallaxOffset(0, 0);
  }

  function cancelPreclickGuidanceDelay({ resetReady = true } = {}) {
    if (preclickRockGuidance.delayTimerId !== null) {
      window.clearTimeout(preclickRockGuidance.delayTimerId);
      preclickRockGuidance.delayTimerId = null;
    }
    if (resetReady) {
      preclickRockGuidance.delayReady = false;
    }
    preclickRockGuidance.delayStartedAtMs = null;
  }

  function resetPreclickParallaxTransition({
    pointerX = null,
    pointerY = null,
    atMs = null,
  } = {}) {
    preclickRockGuidance.activeMovementTimeMs = 0;
    preclickRockGuidance.movementSampleX = Number.isFinite(pointerX)
      ? pointerX
      : null;
    preclickRockGuidance.movementSampleY = Number.isFinite(pointerY)
      ? pointerY
      : null;
    preclickRockGuidance.movementSampleAtMs = Number.isFinite(atMs)
      ? atMs
      : null;
  }

  function currentPreclickParallaxTransition() {
    return calculatePreclickParallaxTransition({
      activeMovementTimeMs: preclickRockGuidance.activeMovementTimeMs,
      durationSeconds: params.preclickParallaxTransitionDurationSeconds,
      startDelayMs: params.preclickParallaxStartDelayMs,
      endDelayMs: params.preclickParallaxEndDelayMs,
      delayEasing: params.preclickParallaxDelayEasing,
      startMaxOffset: params.preclickParallaxMaxOffsetVw,
      endMaxOffset: params.preclickParallaxEndMaxOffsetVw,
      maxOffsetEasing: params.preclickParallaxMaxOffsetEasing,
    });
  }

  function advancePreclickParallaxTransition(pointerX, pointerY, atMs) {
    const activeDeltaMs = activePreclickMovementDeltaMs({
      previousX: preclickRockGuidance.movementSampleX,
      previousY: preclickRockGuidance.movementSampleY,
      previousAtMs: preclickRockGuidance.movementSampleAtMs,
      x: pointerX,
      y: pointerY,
      atMs,
    });
    const durationMs = Math.max(
      0,
      Number(params.preclickParallaxTransitionDurationSeconds) * 1000,
    );
    preclickRockGuidance.activeMovementTimeMs = Math.min(
      preclickRockGuidance.activeMovementTimeMs + activeDeltaMs,
      durationMs,
    );
    preclickRockGuidance.movementSampleX = pointerX;
    preclickRockGuidance.movementSampleY = pointerY;
    preclickRockGuidance.movementSampleAtMs = atMs;
  }

  function resetPreclickRockGuidance() {
    cancelPreclickGuidanceDelay();
    stopPreclickHopSounds();
    resetPreclickRockParallax();
    Object.assign(preclickRockGuidance, {
      completed: false,
      activeMovementTimeMs: 0,
      delayStartedAtMs: null,
      pointerX: null,
      pointerY: null,
      movementSampleAtMs: null,
      movementSampleX: null,
      movementSampleY: null,
      directionX: null,
      directionY: null,
      delayTimerId: null,
      delayReady: false,
      insideRadius: false,
      returnAnimationId: null,
      outsideRadius: false,
      hopCount: 0,
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
    rock.classList.add("is-preclick-parallax");
    rock.classList.toggle("is-preclick-hop", PRECLICK_ROCK_HOP_ENABLED);
  }

  function performPreclickRockHop({
    centerX,
    centerY,
    activationRadius,
    speedPxPerSecond,
  }) {
    const currentOffset = preclickRockParallaxOffset();
    const target = calculatePreclickHopTarget({
      pointerX: preclickRockGuidance.pointerX,
      pointerY: preclickRockGuidance.pointerY,
      centerX,
      centerY,
      speedPxPerSecond,
      activationRadius,
      currentOffsetX: currentOffset.x,
      currentOffsetY: currentOffset.y,
      rockRect: rock.getBoundingClientRect(),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      lastDirectionX: preclickRockGuidance.directionX,
      lastDirectionY: preclickRockGuidance.directionY,
    });
    preclickRockGuidance.directionX = target.directionX;
    preclickRockGuidance.directionY = target.directionY;
    preclickRockGuidance.hopCount += 1;
    rock.classList.add("is-preclick-hop");
    setPreclickRockParallaxOffset(target.x, target.y);
    playPreclickHopSound();
  }

  function beginPreclickGuidanceDelay(delay, now = performance.now()) {
    const normalizedDelay = Math.max(0, Number(delay) || 0);
    const currentNow = Number.isFinite(now) ? now : performance.now();
    preclickRockGuidance.delayStartedAtMs = currentNow;
    if (normalizedDelay <= 0) {
      preclickRockGuidance.delayReady = true;
      return true;
    }

    preclickRockGuidance.delayReady = false;
    preclickRockGuidance.delayTimerId = window.setTimeout(() => {
      preclickRockGuidance.delayTimerId = null;
      if (
        disposed ||
        preclickRockGuidance.completed ||
        !preclickRockGuidance.insideRadius
      ) {
        return;
      }
      preclickRockGuidance.delayReady = true;
      refreshPreclickRockParallax();
    }, normalizedDelay);
    return false;
  }

  function syncPreclickGuidanceDelay(delay, now = performance.now()) {
    if (preclickRockGuidance.delayReady) {
      return true;
    }
    const normalizedDelay = Math.max(0, Number(delay) || 0);
    const currentNow = Number.isFinite(now) ? now : performance.now();
    const startedAt = Number(preclickRockGuidance.delayStartedAtMs);
    const elapsed = Number.isFinite(startedAt)
      ? Math.max(0, currentNow - startedAt)
      : 0;
    const remaining = Math.max(0, normalizedDelay - elapsed);
    if (preclickRockGuidance.delayTimerId !== null) {
      window.clearTimeout(preclickRockGuidance.delayTimerId);
      preclickRockGuidance.delayTimerId = null;
    }
    if (remaining <= 0) {
      preclickRockGuidance.delayReady = true;
      return true;
    }
    preclickRockGuidance.delayTimerId = window.setTimeout(() => {
      preclickRockGuidance.delayTimerId = null;
      if (
        disposed ||
        preclickRockGuidance.completed ||
        !preclickRockGuidance.insideRadius
      ) {
        return;
      }
      preclickRockGuidance.delayReady = true;
      refreshPreclickRockParallax();
    }, remaining);
    return false;
  }

  function returnPreclickRockParallaxToCenter() {
    if (preclickRockGuidance.returnAnimationId !== null) {
      return;
    }

    const startOffset = preclickRockParallaxOffset();
    const duration = params.preclickParallaxReturnDurationMs;
    const curve = parseCubicBezier(params.preclickParallaxReturnEasing);
    const finishImmediately =
      reducedMotion.matches ||
      duration <= 0 ||
      !curve;

    if (finishImmediately) {
      setPreclickRockParallaxOffset(0, 0);
      return;
    }

    const startedAt = performance.now();
    const renderReturn = (now) => {
      const progress = Math.min(Math.max((now - startedAt) / duration, 0), 1);
      const easedProgress = cubicBezierYForX(progress, curve);

      setPreclickRockParallaxOffset(
        startOffset.x * (1 - easedProgress),
        startOffset.y * (1 - easedProgress),
      );

      if (progress < 1) {
        preclickRockGuidance.returnAnimationId =
          window.requestAnimationFrame(renderReturn);
        return;
      }

      setPreclickRockParallaxOffset(0, 0);
      preclickRockGuidance.returnAnimationId = null;
    };

    preclickRockGuidance.returnAnimationId =
      window.requestAnimationFrame(renderReturn);
  }

  function refreshPreclickRockParallax({
    movementAtMs = null,
    trackMovement = false,
  } = {}) {
    if (
      preclickRockGuidance.completed ||
      !finePointer.matches ||
      !Number.isFinite(preclickRockGuidance.pointerX) ||
      !Number.isFinite(preclickRockGuidance.pointerY)
    ) {
      return;
    }
    const activationRadius =
      (params.preclickParallaxActivationRadiusVw / 100) * window.innerWidth;
    if (
      activationRadius <= 0 ||
      (!PRECLICK_ROCK_HOP_ENABLED && params.preclickParallaxMaxOffsetVw <= 0)
    ) {
      preclickRockGuidance.insideRadius = false;
      preclickRockGuidance.outsideRadius = false;
      cancelPreclickGuidanceDelay();
      resetPreclickParallaxTransition();
      resetPreclickRockParallax();
      return;
    }

    const currentOffset = preclickRockParallaxOffset();
    const rockRect = rock.getBoundingClientRect();
    const center = PRECLICK_ROCK_HOP_ENABLED
      ? {
          x: rockRect.left + rockRect.width / 2,
          y: rockRect.top + rockRect.height / 2,
        }
      : preclickRockBaseCenter(currentOffset);
    const centerX = center.x;
    const centerY = center.y;
    const deltaX = preclickRockGuidance.pointerX - centerX;
    const deltaY = preclickRockGuidance.pointerY - centerY;
    if (Math.hypot(deltaX, deltaY) > activationRadius) {
      const exitedRadius = preclickRockGuidance.insideRadius;
      preclickRockGuidance.insideRadius = false;
      cancelPreclickGuidanceDelay();
      if (exitedRadius) {
        resetPreclickParallaxTransition();
      }
      if (!preclickRockGuidance.outsideRadius) {
        preclickRockGuidance.outsideRadius = true;
        if (!PRECLICK_ROCK_HOP_ENABLED) {
          returnPreclickRockParallaxToCenter();
        }
      }
      return;
    }

    const enteredRadius = !preclickRockGuidance.insideRadius;
    preclickRockGuidance.insideRadius = true;
    preclickRockGuidance.outsideRadius = false;
    cancelPreclickGuidanceReturn();
    if (PRECLICK_ROCK_HOP_ENABLED) {
      if (enteredRadius) {
        performPreclickRockHop({
          centerX,
          centerY,
          activationRadius,
          speedPxPerSecond: preclickRockGuidance.hopSpeedPxPerSecond,
        });
      }
      return;
    }
    if (enteredRadius) {
      cancelPreclickGuidanceDelay();
      resetPreclickParallaxTransition({
        pointerX: preclickRockGuidance.pointerX,
        pointerY: preclickRockGuidance.pointerY,
        atMs: movementAtMs,
      });
      setPreclickRockParallaxOffset(0, 0);
    } else if (trackMovement && Number.isFinite(movementAtMs)) {
      advancePreclickParallaxTransition(
        preclickRockGuidance.pointerX,
        preclickRockGuidance.pointerY,
        movementAtMs,
      );
    }

    const transition = currentPreclickParallaxTransition();
    const maxOffset = (transition.maxOffset / 100) * window.innerWidth;
    const parallax = calculatePreclickParallaxOffset({
      deltaX,
      deltaY,
      activationRadius,
      maxOffset,
      inverted: params.preclickParallaxInverted,
      lastDirectionX: preclickRockGuidance.directionX,
      lastDirectionY: preclickRockGuidance.directionY,
    });
    if (enteredRadius) {
      if (!beginPreclickGuidanceDelay(transition.delayMs, movementAtMs)) {
        return;
      }
    } else if (
      !syncPreclickGuidanceDelay(transition.delayMs, movementAtMs)
    ) {
      return;
    }

    preclickRockGuidance.directionX = parallax.directionX;
    preclickRockGuidance.directionY = parallax.directionY;
    setPreclickRockParallaxOffset(parallax.x, parallax.y);
  }

  function updatePreclickRockParallax(event) {
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
    refreshPreclickRockParallax({
      movementAtMs,
      trackMovement: true,
    });
  }

  function restartPreclickRockParallaxFromLastPointer() {
    cancelPreclickGuidanceDelay();
    preclickRockGuidance.insideRadius = false;
    preclickRockGuidance.outsideRadius = false;
    resetPreclickParallaxTransition();
    if (PRECLICK_ROCK_HOP_ENABLED) {
      const offset = preclickRockParallaxOffset();
      const rect = rock.getBoundingClientRect();
      const correctionX = rect.left < 0
        ? -rect.left
        : rect.right > window.innerWidth
          ? window.innerWidth - rect.right
          : 0;
      const correctionY = rect.top < 0
        ? -rect.top
        : rect.bottom > window.innerHeight
          ? window.innerHeight - rect.bottom
          : 0;
      rock.classList.remove("is-preclick-hop");
      setPreclickRockParallaxOffset(
        offset.x + correctionX,
        offset.y + correctionY,
      );
      void rock.offsetWidth;
      rock.classList.add("is-preclick-hop");
      return;
    }
    resetPreclickRockParallax();
    refreshPreclickRockParallax();
  }

  function updatePreclickRockGuidance(event) {
    if (preclickRockGuidance.completed) {
      syncHandCursorForPointer(event);
      return;
    }
    updatePreclickRockParallax(event);
  }

  function completePreclickRockGuidance() {
    if (preclickRockGuidance.completed) {
      return;
    }
    preclickRockGuidance.completed = true;
    preclickRockGuidance.insideRadius = false;
    cancelPreclickGuidanceDelay();
    rock.classList.remove("is-preclick-parallax", "is-preclick-hop");
    resetPreclickRockParallax();
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
    const visualBottomOffset =
      (bounds.rockHeight * (1 + effectiveBottomScale)) / 2 + FLOOR_INSET;
    bounds.worldHeight = Math.max(
      window.innerHeight * params.sceneHeightScreens,
      visualBottomOffset
    );
    bounds.maxY = Math.max(0, bounds.worldHeight - visualBottomOffset);
  }

  function baseScaleForLocalY(y) {
    return rockScaleForY(y, bounds.maxY, {
      easing: params.rockScaleEasing,
      minWidthVw: params.rockMinWidthVw,
      maxWidthVw: params.rockMaxWidthVw,
      baseWidthPx: bounds.rockWidth,
      viewportWidthPx: bounds.worldWidth,
    });
  }

  function scaleForLocalY(y) {
    return baseScaleForLocalY(y) * motion.rockActivationScaleFactor;
  }

  function visualShrinkScaleFactor() {
    const pressFactor = motion.rockPressActive
      ? rockPressScaleFactor(params.rockPressShrinkPercent)
      : 1;
    return Math.min(pressFactor, motion.rockPulseScaleFactor);
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
    if (!params.rockPulseEnabled || document.hidden) {
      motion.rockPulseScaleFactor = 1;
      applyRockScale();
      return;
    }
    motion.rockPulseScaleFactor = rockPulseScaleFactor(
      rockPulseProgress(now, motion.rockPulseStartedAt, params.rockPulseBpm),
      params.rockPressShrinkPercent,
    );
    applyRockScale();
    motion.rockPulseAnimationId = window.requestAnimationFrame(renderRockPulse);
  }

  function syncRockPulse() {
    if (!params.rockPulseEnabled || document.hidden) {
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
      scale
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
    rock.style.setProperty("--rock-x", `${motion.x}px`);
    rock.style.setProperty("--rock-y", `${motion.y}px`);
    applyRockScale();
    syncDrizzleLoopVolume();
    windowObstacleController.refresh();
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
    trail.dirty = true;
    drawTrail();
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
    // Высота комнаты приходит с первым snapshot позже стартовой прокрутки.
    // Следующий кадр читает уже пересчитанную геометрию сцены.
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
      : cameraFollowScrollY(
          window.scrollY,
          targetScrollY,
          params.cameraFollowLerp,
        );
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
    trail.dirty = true;
    drawTrail();
  }

  function loadSharedTrail(points) {
    trail.canonicalPoints = normalizeSharedTrailPoints(points);
    trail.points = sharedTrailPointsToLocal(trail.canonicalPoints);
    trimTrailToLimit();
    syncTrailTail();
  }

  function appendSharedTrail(points) {
    const canonicalPoints = normalizeSharedTrailPoints(points);
    if (canonicalPoints.length === 0) {
      return;
    }
    const appended = sharedTrailPointsToLocal(canonicalPoints);
    trail.canonicalPoints.push(...canonicalPoints);
    trail.points.push(...appended);
    trimTrailToLimit();
    syncTrailTail();
  }

  function reprojectTrail() {
    if (trail.canonicalPoints.length === 0) {
      return;
    }
    trail.points = sharedTrailPointsToLocal(trail.canonicalPoints);
    trimTrailToLimit();
    syncTrailTail();
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
        applyCurrentSettings({
          ...settingsChangeContext({ changedKeys }),
          previousRoomSettings: null,
          preservedState: null,
          preserveBottomScroll: false,
        });
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
        applyCurrentSettings({
          ...settingsChangeContext({ changedKeys }),
          previousRoomSettings,
          preservedState,
          preserveBottomScroll: false,
        });
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
      settingsSchemaVersion: 33,
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
    hideReturnRain({ immediate: true });
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
      collab.trailWriterId = normalizeHolderId(
        payload.trailWriterId || payload.holderId || collab.clientId,
      );
      armRockActivationScale();
      updateSharedHolder(payload.holderId || collab.clientId);
      collab.remoteControllerId = collab.holderId;
      updateSessionStatus();
    } else if (message.type === "control.slipped") {
      collab.pendingControl = false;
      collab.hasControl = false;
      collab.releasePending = false;
      updateSharedHolder(payload.holderId);
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
    const offsetSample = Date.now() - Number(payload.serverTime || Date.now());
    collab.clockOffset = collab.clockOffsetReady
      ? collab.clockOffset * 0.8 + offsetSample * 0.2
      : offsetSample;
    collab.clockOffsetReady = true;
    applySummitTimerSnapshot(payload);
    if (initialSnapshot && Object.hasOwn(payload, "physics")) {
      applySharedPhysics(payload.physics);
    }
    if (initialSnapshot && Object.hasOwn(payload, "roomSettings")) {
      applySharedRoomSettings(payload.roomSettings);
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
      stopGachiClickSound();
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
    if (
      snapshot.phase === PHASES.FALLING &&
      previousPhase !== PHASES.FALLING
    ) {
      stopGachiClickSound();
    }
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
      syncReturnRain(
        snapshotAtReturnPlace ||
          (rain.returnRequested && snapshot.phase === PHASES.FALLING),
      );
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
    if (restoringActiveSession) {
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
    if (snapshot.suspended) {
      if (motion.rockActivationArmed || motion.physicsActivated) {
        resetRockActivationScale();
      }
    } else if (snapshot.dragging && snapshot.holderId) {
      armRockActivationScale();
    }
    maybeActivateRockPhysicsScale(snapshot);
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
    collab.renderId = window.requestAnimationFrame(renderSharedFrame);
    const deltaSeconds = clamp(
      (now - (collab.lastRenderAt || now)) / 1000,
      0,
      MAX_FRAME_SECONDS
    );
    collab.lastRenderAt = now;
    observeGlowFrameTime(deltaSeconds, now);

    if (collab.snapshots.length > 0) {
      const targetServerTime =
        Date.now() - collab.clockOffset - SNAPSHOT_DELAY_MS;
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
    }

    if (shouldRecordTrailPoint()) {
      recordTrailPoint(deltaSeconds);
    }
    updateCameraFollow();
    drawTrail();
    renderRemotePointers();
    renderSummitTimer();
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
    if (windowObstacleController.isControlBlocked()) {
      event.preventDefault();
      return;
    }
    if (!collab.connected) {
      updateSessionStatus();
      return;
    }
    if (motion.phase !== PHASES.PLAY) {
      return;
    }

    event.preventDefault();
    activateRockPress();
    clearSharedReleaseHandoff();
    collab.releasePending = false;
    toggleHandVariant();
    updateBounds();
    const position = localToCanonical(motion.x, motion.y);
    motion.suspended = false;
    motion.dragging = true;
    motion.activePointerId = event.pointerId;
    setGrabPointFromPointer(event);
    motion.dragTargetX = motion.x;
    motion.dragTargetY = motion.y;
    motion.pointerVx = 0;
    motion.pointerVy = 0;
    motion.lastPointerAt = 0;
    recordPointerVelocity(event);
    showHandCursor(event);
    setGrabbingCursor(true);
    rock.classList.remove("is-falling");
    rock.classList.add("is-dragging");
    rock.setPointerCapture(event.pointerId);
    collab.pendingControl = true;

    const pointer = updateLocalSharedPointer(event, "grabbing", true);
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
      true
    );
    if (!motion.dragging || (!collab.hasControl && !collab.pendingControl)) {
      sendSharedPointer(event, "grab", true);
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
    stopGachiClickSound();
    releaseRockPress();
    const canReleaseWithImpulse = sharedDragActive();
    const pointerVelocity = canReleaseWithImpulse
      ? currentPointerVelocity()
      : { vx: 0, vy: 0 };
    const velocity = canReleaseWithImpulse
      ? localVelocityToCanonical(pointerVelocity.vx, pointerVelocity.vy)
      : { vx: 0, vy: 0 };
    const position = localToCanonical(motion.x, motion.y);
    const pointerVisible =
      event.type !== "pointercancel" && pointerIsOverRock(event);
    const pointer = updateLocalSharedPointer(event, "grab", pointerVisible);
    if (canReleaseWithImpulse) {
      startSharedReleaseHandoff();
    }
    collab.releasePending = true;
    collab.snapshots = [];
    sendShared("control.release", {
      ...position,
      ...velocity,
      pointer,
    });
    collab.pendingControl = false;
    collab.hasControl = false;
    cancelSharedLocalDrag();
    syncReturnTheme();
    updateSessionStatus();
  }

  function forceReleaseSharedDrag(hidePointer = false, neutral = false) {
    if (!motion.dragging) {
      releaseRockPress();
      return;
    }
    stopGachiClickSound();
    const canReleaseWithImpulse = !neutral && sharedDragActive();
    const pointerVelocity = canReleaseWithImpulse
      ? currentPointerVelocity()
      : { vx: 0, vy: 0 };
    const velocity = canReleaseWithImpulse
      ? localVelocityToCanonical(pointerVelocity.vx, pointerVelocity.vy)
      : { vx: 0, vy: 0 };
    const position = localToCanonical(motion.x, motion.y);
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
    sendShared("control.release", {
      ...position,
      ...velocity,
      pointer,
    });
    collab.pendingControl = false;
    collab.hasControl = false;
    cancelSharedLocalDrag();
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
  }

  function clearTrailCanvas() {
    clearCanvas(trailCtx, trailCanvas);
    bumpCanvasRevision(trailCanvas, "baseRevision");
  }

  function clearGlowCanvas() {
    clearCanvas(trailGlowCtx, trailGlowCanvas);
    trail.glowRendered = false;
    trail.glowSampledPointCount = 0;
    bumpCanvasRevision(trailGlowCanvas, "glowRevision");
  }

  function currentGlowProfile() {
    return resolveGlowOptimizationProfile(params, trail.adaptiveQuality);
  }

  function ensureTrailCanvasSize() {
    const width = Math.max(
      1,
      Math.round(window.innerWidth || document.documentElement.clientWidth)
    );
    const height = Math.max(
      1,
      Math.round(window.innerHeight || document.documentElement.clientHeight)
    );
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const bufferWidth = Math.max(1, Math.round(width * ratio));
    const bufferHeight = Math.max(1, Math.round(height * ratio));

    if (
      trailCanvas.width !== bufferWidth ||
      trailCanvas.height !== bufferHeight
    ) {
      trail.pixelRatio = ratio;
      trailCanvas.width = bufferWidth;
      trailCanvas.height = bufferHeight;
      trail.dirty = true;
    }
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
    const deviceRatio = Math.min(window.devicePixelRatio || 1, 2);
    const ratio = deviceRatio * profile.bufferScale;
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
    trail.glowDirty = true;
    drawTrail();
  }

  function applyTrailBlendMode() {
    const blendMode = body.classList.contains("theme-dark")
      ? "normal"
      : params.blendMode;
    [trailGlowCanvas, trailCanvas].forEach((canvas) => {
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
    trail.lastX = null;
    trail.lastY = null;
    trail.followX = null;
    trail.followY = null;
    trail.skipNextRecord = false;
    cancelGlowRenderSchedule();
    clearTrailCanvas();
    clearGlowCanvas();
    trail.dirty = false;
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
      hideReturnRain();
      playGroundImpactSound();
    }
    return resetTrailOnGroundTouch(touchedGround);
  }

  function trimTrailToLimit() {
    if (params.trailUnlimited) {
      return;
    }
    const overflow = trail.points.length - params.trailMaxPoints;
    if (overflow > 0) {
      trail.points.splice(0, overflow);
      trail.canonicalPoints.splice(0, overflow);
      trail.dirty = true;
      trail.glowDirty = true;
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
      motion.rockScale
    );
    const anchor = trailAnchorPoint({
      x: motion.x + wallCompensation,
      y: motion.y,
      width: bounds.rockWidth,
      height: bounds.rockHeight,
      scale: motion.rockScale,
      heightPercent: params.trailAnchorHeightPercent,
    });
    const rockX = anchor.x;
    const rockY = anchor.y;

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
    trail.lastX = x;
    trail.lastY = y;
    if (
      collab.enabled &&
      collab.trailWriterId === collab.clientId
    ) {
      sendShared("trail.append", { points: [canonicalPoint] });
    }
    if (params.trailEnabled) {
      trail.dirty = true;
      trail.glowDirty = true;
    }

    trimTrailToLimit();
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

  function drawTrailStartPoint(point) {
    trailCtx.fillStyle = params.useGradient
      ? params.lineColorTail
      : params.lineColor;
    trailCtx.beginPath();
    trailCtx.arc(
      point.x,
      point.y,
      Math.max(
        scaledVisualPixel(2.5),
        scaledVisualPixel(params.lineWidth) * 0.75,
      ),
      0,
      Math.PI * 2
    );
    trailCtx.fill();
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

  function strokeTrailSegment(start, control, end, dashOffset) {
    trailCtx.lineDashOffset = -dashOffset;
    trailCtx.beginPath();
    trailCtx.moveTo(start.x, start.y);
    if (control) {
      trailCtx.quadraticCurveTo(control.x, control.y, end.x, end.y);
    } else {
      trailCtx.lineTo(end.x, end.y);
    }
    trailCtx.stroke();
    return control
      ? quadraticSegmentLength(start, control, end)
      : Math.hypot(end.x - start.x, end.y - start.y);
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

  function drawTrail() {
    ensureTrailCanvasSize();
    if (trail.dirty) {
      trail.dirty = false;
      clearCanvas(trailCtx, trailCanvas);
      const points = trail.points;

      if (params.trailEnabled && points.length > 0) {
        trailCtx.save();
        trailCtx.setTransform(
          trail.pixelRatio,
          0,
          0,
          trail.pixelRatio,
          -window.scrollX * trail.pixelRatio,
          -window.scrollY * trail.pixelRatio,
        );
        trailCtx.globalAlpha = params.linePassOpacity;
        trailCtx.globalCompositeOperation = "lighter";
        trailCtx.lineCap = params.lineCap;
        trailCtx.lineJoin = params.lineJoin;
        trailCtx.lineWidth = scaledVisualPixel(params.lineWidth);

        if (points.length < 2) {
          drawTrailStartPoint(points[0]);
        } else {
          const last = points.at(-1);
          if (params.useGradient) {
            const first = points[0];
            const grad = trailCtx.createLinearGradient(
              first.x,
              first.y,
              last.x,
              last.y,
            );
            grad.addColorStop(0, params.lineColorTail);
            grad.addColorStop(1, params.lineColor);
            trailCtx.strokeStyle = grad;
          } else {
            trailCtx.strokeStyle = params.lineColor;
          }

          // Накопление альфы сохраняется у дешёвой базовой линии. Blur вынесен
          // в отдельный одинарный glow-pass ниже.
          trailCtx.setLineDash(trailDashArray());
          let segmentStart = points[0];
          let dashOffset = 0;
          for (let index = 1; index < points.length - 1; index += 1) {
            const segmentEnd = {
              x: (points[index].x + points[index + 1].x) / 2,
              y: (points[index].y + points[index + 1].y) / 2,
            };
            dashOffset += strokeTrailSegment(
              segmentStart,
              points[index],
              segmentEnd,
              dashOffset,
            );
            segmentStart = segmentEnd;
          }
          strokeTrailSegment(segmentStart, null, last, dashOffset);
          trailCtx.setLineDash([]);
          trailCtx.lineDashOffset = 0;
          drawTrailStartPoint(points[0]);
        }
        trailCtx.restore();
      }
      bumpCanvasRevision(trailCanvas, "baseRevision");
      trail.glowDirty = true;
    }
    scheduleGlowRender();
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
    stopGachiClickSound();
    resetFinalFallGate();
    setPhase(state.phase);
    applyCanonicalMotion(state);
    showReturnRain();
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
    const keepRainUntilGround =
      rain.returnRequested && motion.phase === PHASES.FALLING;
    motion.wasAtReturnPlace = atReturnPlace;
    setTheme(nextTheme, {
      durationMs: returnThemeTransitionDuration(atReturnPlace),
    });
    syncReturnRain(atReturnPlace || keepRainUntilGround);
  }

  function enterPlayPhase() {
    setPhase(PHASES.PLAY);
    setTheme(resolveTheme("dark"));
    hideReturnRain();
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
    if (
      previousPhase !== PHASES.FALLING &&
      state.phase === PHASES.FALLING
    ) {
      stopGachiClickSound();
    }
    maybeActivateRockPhysicsScale(state);
    const touchedGroundCanonical =
      wasAboveGround && state.y >= SharedPhysics.WORLD_HEIGHT - 0.01;
    applyCanonicalMotion(state);
    const touchedGround =
      touchedGroundCanonical ||
      (previousY < bounds.maxY - 0.75 && motion.y >= bounds.maxY - 0.75);
    if (touchedGround) {
      hideReturnRain();
      playGroundImpactSound();
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
      syncReturnTheme();
    }

    if (motion.phase === PHASES.FALLING || motion.phase === PHASES.PLAY) {
      applyPhysics(deltaSeconds);
      if (shouldRecordTrailPoint()) {
        recordTrailPoint(deltaSeconds);
      }
    }

    updateCameraFollow();
    drawTrail();

    if (motion.phase !== PHASES.WON) {
      motion.animationId = window.requestAnimationFrame(tick);
    } else {
      motion.animationId = null;
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
      forceReleaseSharedDrag(true, neutral);
      return;
    }

    releaseRockPress();
    if (!motion.dragging) {
      return;
    }
    stopGachiClickSound();

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
    } else {
      applyReleaseImpulse();
    }
    setHandToGrab();
    rock.classList.add("is-falling");
    syncReturnTheme();
    startLoop();
  }

  function startDrag(event) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    if (motion.phase === PHASES.FALLING) {
      stopGachiClickSound();
      return;
    }
    playGachiClickSound();

    if (motion.phase !== PHASES.PLAY) {
      return;
    }

    if (windowObstacleController.isControlBlocked()) {
      event.preventDefault();
      return;
    }

    completePreclickRockGuidance();

    playDrizzleLoopSound();
    playRockPointerDownSound();

    if (collab.enabled) {
      beginSharedDrag(event);
      return;
    }

    event.preventDefault();
    activateRockPress();
    toggleHandVariant();
    updateBounds();
    armRockActivationScale();
    motion.suspended = false;
    motion.dragging = true;
    motion.activePointerId = event.pointerId;
    setGrabPointFromPointer(event);
    motion.dragTargetX = motion.x;
    motion.dragTargetY = motion.y;
    motion.pointerVx = 0;
    motion.pointerVy = 0;
    motion.lastPointerAt = 0;
    recordPointerVelocity(event);
    showHandCursor(event);
    setGrabbingCursor(true);
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
    if (
      event.pointerType !== "mouse" ||
      event.button !== 0 ||
      event.isPrimary === false ||
      params.rockGrabRadiusVh <= 0 ||
      event.composedPath().includes(rock) ||
      pointerTargetIsInteractive(event)
    ) {
      return;
    }

    const radius = (params.rockGrabRadiusVh / 100) * window.innerHeight;
    if (
      !cursorCircleIntersectsRect({
        x: event.clientX,
        y: event.clientY,
        radius,
        rect: rock.getBoundingClientRect(),
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

    releaseRockPress();
    if (!motion.dragging) {
      return;
    }
    stopGachiClickSound();

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
      sendSharedPointer(event, "grab", true, true);
    }
  }

  function leaveRock(event) {
    if (!motion.dragging) {
      if (!params.handAlwaysVisible) {
        hideHandCursor();
      }
      if (collab.enabled) {
        sendSharedPointer(
          event,
          "grab",
          params.handAlwaysVisible,
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
      stopRockPulse();
    } else {
      syncRockPulse();
    }
  });
  listen(windowObstaclePopupTest, "click", () => {
    windowObstacleController.testPopupPermission();
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
  listen(window, "blur", cancelDragAndCursor);
  listen(
    window,
    "scroll",
    () => {
      trail.dirty = true;
      drawTrail();
    },
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
    if (PRECLICK_ROCK_HOP_ENABLED) {
      restartPreclickRockParallaxFromLastPointer();
    } else {
      refreshPreclickRockParallax();
    }
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
    hideReturnRain({ immediate: true });
    motion.sceneReady = true;
    showInitialHandCursor();
    resizeTrailCanvas();
    scrollToSceneBottom();
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
      applyDragTargetMovement,
      bounds,
      canonicalToLocal,
      collab,
      currentSharedState,
      initialSharedState,
      motion,
      params,
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
      getGroundImpactAudioState: () => ({
        lastFilename: groundImpactAudio.lastFilename,
        playCount: groundImpactAudio.playCount,
      }),
      receiveSharedSnapshot,
      syncSharedGroundTouchSeq,
      getPreclickHopState: () => ({
        enabled: PRECLICK_ROCK_HOP_ENABLED,
        completed: preclickRockGuidance.completed,
        finePointer: finePointer.matches,
        hopCount: preclickRockGuidance.hopCount,
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
        offset: preclickRockParallaxOffset(),
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
      getWindowObstacleState: windowObstacleController.getState,
      fitTopInscription,
      drawTrail,
      getGlowRenderState: () => ({
        adaptiveQuality: trail.adaptiveQuality,
        baseRevision: trail.baseRevision,
        glowRevision: trail.glowRevision,
        profile: { ...currentGlowProfile() },
        renderPasses: trail.glowRenderPasses,
        rendered: trail.glowRendered,
        sampledPointCount: trail.glowSampledPointCount,
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
      trimTrailToLimit,
      updateBounds,
    };
    window.__sisyphusTestApi = testApi;
    Object.assign(window, testApi);
  }
  settingsController.load({
    loadLatestVersion: false,
    loadVersionedSettings: false,
  });
  readControls();
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
      cancelGlowRenderSchedule();
      settingsController.dispose?.();
      windowObstacleController.dispose();
      document.documentElement.classList.remove(
        "is-manual-scroll-disabled",
      );
      body.classList.remove(
        "is-manual-scroll-disabled",
        "preclick-rock-guidance",
        "hand-always-visible",
        "is-settings-pointer-active",
      );
      rock.classList.remove("is-preclick-parallax", "is-preclick-hop");
      preclickRockGuidance.insideRadius = false;
      cancelPreclickGuidanceDelay();
      resetPreclickRockParallax();
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
      pauseAndResetAudio(groundImpactAudio.element);
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
