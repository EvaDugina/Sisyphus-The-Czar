import "../../shared/physics.js";
import "../../shared/room-settings.js";
import "../../shared/gachi-sounds.js";
import "../../shared/chain-sounds.js";
import "../../shared/viewport.js";
import rainAudioUrl from "../../assets/audio/Дождь.mp3?url";
import rainVendorUrl from "../../assets/raindrop-fx/index.js?url";
import { createClientId } from "../lib/clientId.mjs";
import { createCrossfadedAudioLoop } from "../lib/crossfadedAudioLoop.mjs";
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
import { deriveSessionStatus } from "../lib/sessionStatus.mjs";
import { formatSummitElapsedMs } from "../lib/summitTimer.mjs";
import {
  normalizeRainSettings,
  normalizeRockScaleSettings,
  normalizeThemeMode,
} from "../lib/settingsModel.mjs";
import {
  rockScaleForY,
} from "../lib/rockScale.mjs";
import {
  positionScrollDistancePx,
  positionScrollState,
} from "../lib/positionScroll.mjs";
import { trailAnchorPoint } from "../lib/trailAnchor.mjs";
import {
  settings as productionSettings,
} from "../config/production-preset.mjs";
import { createSettingsController } from "./createSettingsController.js";

const ROLE_AUDIO_FADE_IN_MS = 300;
const ROLE_AUDIO_VOLUME = 1;
const SECOND_UI_MS_SETTING_KEYS = new Set(["rainEnterMs", "rainExitMs"]);

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
  const remoteCursorLayer = elements.remoteCursorLayer || document.querySelector(".remote-cursors");
  const trailCanvas = elements.trailCanvas || document.querySelector(".trail");
  const trailCtx = trailCanvas.getContext("2d");
  const rainLayer = elements.rainLayer || document.querySelector(".weather-rain");
  const rainFxCanvas = elements.rainFxCanvas || document.querySelector(".weather-rain__canvas--fx");
  const rainFallbackCanvas = elements.rainFallbackCanvas || document.querySelector(".weather-rain__canvas--fallback");
  const sessionStatus = elements.sessionStatus || document.querySelector("[data-session-status]");
  const onClientRoleChange =
    typeof elements.onClientRoleChange === "function"
      ? elements.onClientRoleChange
      : () => {};
  const finePointer = window.matchMedia("(pointer: fine)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const SharedPhysics = window.SisyphusPhysics;
  const SharedRoomSettings = window.SisyphusRoomSettings;
  const SharedGachiSounds = window.SisyphusGachiSounds;
  const SharedChainSounds = window.SisyphusChainSounds;
  const SharedViewport = window.SisyphusViewport;
  const listenerDisposers = [];
  let disposed = false;
  const productionRuntime = import.meta.env.PROD;

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
    lastX: null,
    lastY: null,
    followX: null,
    followY: null,
    pixelRatio: 1,
    dirty: true,
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
    returnScrollDurationSeconds: DEFAULT_RETURN_SCROLL_DURATION_SECONDS,
    returnScrollEasing: DEFAULT_RETURN_SCROLL_EASING,
    stationaryAutoSlipEnabled:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.stationaryAutoSlipEnabled,
    positionScrollEnabled:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.positionScrollEnabled,
    positionScrollZonePercent:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.positionScrollZonePercent,
    positionScrollStartSpeedVh:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.positionScrollStartSpeedVh,
    positionScrollEndSpeedVh:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.positionScrollEndSpeedVh,
    positionScrollEasing:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.positionScrollEasing,
    manualVerticalScrollEnabled:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.manualVerticalScrollEnabled,
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
    rockMinWidthVw: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rockMinWidthVw,
    rockMaxWidthVw: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rockMaxWidthVw,
    sceneHeightScreens:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.sceneHeightScreens,
    handWidthVw: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.handWidthVw,
    slaveHandWidthPx:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.slaveHandWidthPx,
    handForceDeficitEasing:
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS.handForceDeficitEasing,

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
  };
  if (productionRuntime) {
    Object.assign(params, productionSettings);
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
    holdTimerId: null,
    firstFallTriggered: false,
    firstFallTouchY: null,
    introFallTimerId: null,
    sceneReady: false,
    rockScale: 1,
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
    clientRole: "pending",
    masterViewport: null,
    viewportSignature: "",
    gachiSoundFilename: null,
    holderIds: new Set(),
    requiredHolders: 1,
    remoteControllerId: null,
    participants: 1,
    applyingRemotePhysics: false,
    physicsSignature: "",
    pendingPhysicsChanges: Object.create(null),
    applyingRemoteRoomSettings: false,
    roomSettingsSignature: "",
    pendingRoomSettingsChanges: Object.create(null),
    settingsRevision: 0,
    settingsUpdateTimerId: null,
    settingsUpdateInFlight: null,
    settingsUpdateQueued: false,
    sessionCreateInFlight: false,
    sessionCreateAbortController: null,
    trailCursor: 0,
    firstFallRequestSent: false,
    lastMoveSentAt: 0,
    lastPointerSentAt: 0,
    lastRenderAt: 0,
    imprint: null,
    groundTouchSeq: null,
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
    return SharedViewport.sanitizeViewport({
      width: window.innerWidth || document.documentElement.clientWidth,
      height: window.innerHeight || document.documentElement.clientHeight,
    });
  }

  function localCanEditSettings() {
    return (
      collab.clientRole === "pending" ||
      collab.clientRole === "master" ||
      collab.clientRole === "slave"
    );
  }

  function slaveViewportScale() {
    if (collab.clientRole !== "slave") {
      return { x: 1, y: 1 };
    }
    return SharedViewport.viewportScale(
      collab.masterViewport,
      currentViewport(),
    );
  }

  function scaledVisualPixel(value) {
    return Number(value) * slaveViewportScale().x;
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
    restartExperience,
    secondsOutput,
    sessionRestartButton: elements.sessionRestartButton,
    settingValueToControlValue,
    settingsPanel: elements.settingsPanel,
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

  function cancelAllRoleAudioFades() {
    Array.from(roleAudioFade.entries.keys()).forEach(cancelRoleAudioFade);
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

  function setSlaveClickSound(filename) {
    collab.gachiSoundFilename = SharedGachiSounds.isGachiSoundFilename(filename)
      ? filename
      : null;
    if (collab.gachiSoundFilename) {
      preloadSessionRoleAudio("slave", collab.gachiSoundFilename);
    }
  }

  function sessionRoleAudioAvailable(role, filename) {
    if (role === "master" && SharedChainSounds.isChainSoundFilename(filename)) {
      return CHAIN_AUDIO_LOADERS_BY_FILENAME.has(filename);
    }
    if (role === "slave" && SharedGachiSounds.isGachiSoundFilename(filename)) {
      return GACHI_AUDIO_LOADERS_BY_FILENAME.has(filename);
    }
    return false;
  }

  function loadSessionRoleAudioUrl(role, filename) {
    if (role === "master" && SharedChainSounds.isChainSoundFilename(filename)) {
      return loadAudioUrl("chain", CHAIN_AUDIO_LOADERS_BY_FILENAME, filename);
    }
    if (role === "slave" && SharedGachiSounds.isGachiSoundFilename(filename)) {
      return loadAudioUrl("gachi", GACHI_AUDIO_LOADERS_BY_FILENAME, filename);
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

  function preloadSessionRoleAudio(role, filename) {
    const promise = ensureSessionRoleAudio(role, filename);
    if (promise && typeof promise.catch === "function") {
      promise.catch(() => {});
    }
  }

  function playSessionRoleAudio(payload) {
    if (typeof Audio !== "function") {
      return;
    }
    if (!sessionRoleAudioAvailable(payload.role, payload.filename)) {
      return;
    }
    ensureSessionRoleAudio(payload.role, payload.filename).then((audio) => {
      if (disposed || !audio) {
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
    const eventId =
      typeof payload.eventId === "string" ? payload.eventId : "";
    const role =
      payload.role === "master" || payload.role === "slave"
        ? payload.role
        : null;
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
    if (collab.enabled && collab.connected) {
      sendShared("audio.play");
      return;
    }
    const role = pointerRole(collab.clientRole);
    const filename =
      role === "master"
        ? SharedChainSounds.CHAIN_SOUND_FILENAMES[
            Math.floor(
              Math.random() * SharedChainSounds.CHAIN_SOUND_FILENAMES.length,
            )
          ]
        : collab.gachiSoundFilename;
    playSessionRoleAudio({
      eventId: `local-${Date.now()}`,
      actorId: collab.clientId,
      role,
      filename,
      playAt: Date.now(),
    });
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
    document.documentElement.style.setProperty(
      "--slave-hand-width-px",
      `${scaledVisualPixel(params.slaveHandWidthPx)}px`
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

  function applyManualVerticalScrollSetting() {
    const disabled = !params.manualVerticalScrollEnabled;
    document.documentElement.classList.toggle(
      "is-manual-scroll-disabled",
      disabled,
    );
    body.classList.toggle("is-manual-scroll-disabled", disabled);
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

  function maxHoldMs() {
    return SharedPhysics.maxHoldMs(params);
  }

  function activeHandCount() {
    return collab.enabled ? collab.holderIds.size : 1;
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

    if (syncControls) {
      settingsController.syncRoomSettingControls();
    }
    applyRainSettings({
      restartIfActive:
        hasTargetedChanges &&
        (shouldHandleChange("rainStrength") ||
          shouldHandleChange("rainBackgroundBlurSteps") ||
          shouldHandleChange("rainDropColor") ||
          shouldHandleChange("rainHighlightColor")),
    });
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

    applyTrailBlendMode();
    applyManualVerticalScrollSetting();

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
    trail.dirty = true;
    applySceneHeight();
    if (preservedState) {
      applyCanonicalMotion(preservedState);
    } else {
      applyRockScale();
    }
    applyHandSize();
    renderImprint();
    drawTrail();
    if (preserveBottomScroll) {
      scrollToSceneBottom();
    }
    if (
      broadcastChanges &&
      collab.enabled &&
      localCanEditSettings() &&
      !collab.applyingRemotePhysics
    ) {
      let hasPhysicsChanges = false;
      changedKeys.forEach((key) => {
        if (SHARED_PHYSICS_KEYS.includes(key)) {
          collab.pendingPhysicsChanges[key] = params[key];
          hasPhysicsChanges = true;
        }
      });
      if (hasPhysicsChanges) {
        scheduleSharedPhysicsUpdate();
      }
    }
    if (
      broadcastChanges &&
      collab.enabled &&
      localCanEditSettings() &&
      !collab.applyingRemoteRoomSettings
    ) {
      let hasRoomSettingsChanges = false;
      changedKeys.forEach((key) => {
        if (SHARED_ROOM_SETTING_KEYS.includes(key)) {
          collab.pendingRoomSettingsChanges[key] = params[key];
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

    if (settingsUiEnabled) {
      Object.assign(params, settingsController.readPhysicsControls());
      Object.assign(
        params,
        SharedRoomSettings.sanitizeRoomSettings(
          settingsController.readRoomSettingsControls(),
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
      persist: settingsUiEnabled,
      broadcastChanges: settingsUiEnabled,
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

  function hideHandCursor() {
    handCursor.classList.remove("is-visible", "is-grabbing");
  }

  function setGrabbingCursor(isGrabbing) {
    handCursor.classList.toggle("is-grabbing", isGrabbing);
  }

  function toggleHandVariant() {
    motion.alternateHand = !motion.alternateHand;
    handCursor.classList.toggle("is-alternate", motion.alternateHand);
  }

  function setHandToGrab() {
    motion.alternateHand = false;
    handCursor.classList.remove("is-alternate", "is-grabbing");
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
    const visualBottomOffset =
      (bounds.rockHeight * (1 + bottomScale)) / 2 + FLOOR_INSET;
    bounds.worldHeight = Math.max(
      window.innerHeight * params.sceneHeightScreens,
      visualBottomOffset
    );
    bounds.maxY = Math.max(0, bounds.worldHeight - visualBottomOffset);
  }

  function scaleForLocalY(y) {
    return rockScaleForY(y, bounds.maxY, {
      easing: params.rockScaleEasing,
      minWidthVw: params.rockMinWidthVw,
      maxWidthVw: params.rockMaxWidthVw,
      baseWidthPx: bounds.rockWidth,
      viewportWidthPx: bounds.worldWidth,
    });
  }

  function applyRockScale() {
    updateBounds();
    const scale = scaleForLocalY(motion.y);
    const roundedScale = Math.round(scale * 10000) / 10000;
    motion.rockScale = scale;
    rock.style.setProperty("--rock-scale", `${roundedScale}`);
  }

  function setPosition(x, y) {
    updateBounds();
    motion.x = clamp(x, 0, bounds.maxX);
    motion.y = clamp(y, 0, bounds.maxY);
    rock.style.setProperty("--rock-x", `${motion.x}px`);
    rock.style.setProperty("--rock-y", `${motion.y}px`);
    applyRockScale();
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
      const scale = scaleForLocalY(targetY);
      const scaledOffsetY = (bounds.rockHeight * (1 - scale)) / 2;
      targetY = clamp(
        targetPointY - scaledOffsetY - motion.grabY * scale,
        0,
        bounds.maxY
      );
    }

    const scale = scaleForLocalY(targetY);
    const scaledOffsetX = (bounds.rockWidth * (1 - scale)) / 2;
    motion.dragTargetX = clamp(
      targetPointX - scaledOffsetX - motion.grabX * scale,
      0,
      bounds.maxX
    );
    motion.dragTargetY = targetY;
  }

  function applyDragTargetMovement(deltaSeconds, handCount = activeHandCount()) {
    if (!motion.dragging) {
      return;
    }

    const verticalSpeed =
      (SharedPhysics.dragVerticalSpeed(params, handCount, sceneMotionOptions()) /
        SharedPhysics.WORLD_HEIGHT) *
      bounds.maxY;
    let nextY = motion.dragTargetY;
    if (motion.dragTargetY < motion.y) {
      nextY =
        verticalSpeed < 0
          ? Math.max(motion.dragTargetY, motion.y + verticalSpeed * deltaSeconds)
          : Math.min(bounds.maxY, motion.y + verticalSpeed * deltaSeconds);
    }

    setPosition(motion.dragTargetX, nextY);
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

  function updatePositionScroll(deltaSeconds) {
    if (
      motion.phase !== PHASES.PLAY ||
      rockInsideImprint() ||
      window.scrollY <= 0
    ) {
      return;
    }

    const rect = rock.getBoundingClientRect();
    const state = positionScrollState(
      rect.top + rect.height / 2,
      window.innerHeight,
      {
        enabled: params.positionScrollEnabled,
        zonePercent: params.positionScrollZonePercent,
        startSpeedVh: params.positionScrollStartSpeedVh,
        endSpeedVh: params.positionScrollEndSpeedVh,
        easing: params.positionScrollEasing,
      },
    );
    if (!state.active || state.speedVh <= 0) {
      return;
    }

    const distance = positionScrollDistancePx(
      state.speedVh,
      window.innerHeight,
      deltaSeconds,
    );
    if (distance <= 0) {
      return;
    }
    window.scrollTo(0, Math.max(0, window.scrollY - distance));
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
    const holderCount = collab.holderIds.size;
    const status = deriveSessionStatus({
      ...collab,
      holderIds: [...collab.holderIds],
      liftReady:
        holderCount > 0 && SharedPhysics.canLift(params, holderCount),
    });
    setSessionStatus(status.text, status.state);
  }

  function appUrl(relativePath) {
    const base = new URL(window.location.href);
    base.search = "";
    base.hash = "";
    if (!base.pathname.endsWith("/")) {
      base.pathname = base.pathname.replace(/[^/]+$/, "");
    }
    return new URL(relativePath, base);
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

  function normalizeHolderIds(holderIds) {
    return Array.isArray(holderIds)
      ? holderIds
          .map((clientId) => String(clientId || ""))
          .filter(Boolean)
      : [];
  }

  function updateSharedHolders(holderIds, requiredHolders) {
    collab.holderIds = new Set(normalizeHolderIds(holderIds));
    const nextRequired = Number(requiredHolders);
    if (Number.isFinite(nextRequired) && nextRequired >= 1) {
      collab.requiredHolders = Math.round(nextRequired);
    }
  }

  function localIsHolder() {
    return collab.holderIds.has(collab.clientId);
  }

  function cooperativeDragActive() {
    return localIsHolder() && SharedPhysics.canLift(params, collab.holderIds.size);
  }

  function pointerRole(value) {
    if (value === "slave" || value === "partner") {
      return "slave";
    }
    return "master";
  }

  function applyCursorRole(element, role) {
    void role;
    element.classList.remove("is-slave");
  }

  function setLocalCursorRole(role) {
    const nextRole = pointerRole(role);
    collab.clientRole = nextRole;
    applyCursorRole(handCursor, collab.clientRole);
    body.dataset.clientRole = nextRole;
    onClientRoleChange(nextRole);
    applyViewportScaledVisuals();
    sendMasterViewport(true);
  }

  function applyMasterViewport(viewport) {
    const next = SharedViewport.sanitizeViewport(viewport);
    const previous = collab.masterViewport;
    if (
      !next ||
      (previous?.width === next.width && previous?.height === next.height)
    ) {
      return false;
    }
    collab.masterViewport = next;
    applyViewportScaledVisuals();
    return true;
  }

  function sendMasterViewport(force = false) {
    if (
      !collab.enabled ||
      !collab.connected ||
      !localCanEditSettings()
    ) {
      return false;
    }
    const viewport = currentViewport();
    if (!viewport) {
      return false;
    }
    const signature = `${viewport.width}x${viewport.height}`;
    if (!force && signature === collab.viewportSignature) {
      return false;
    }
    collab.viewportSignature = signature;
    sendShared("viewport.update", viewport);
    return true;
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
    const role = pointerRole(payload.role || payload.skin);
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
    applyCursorRole(pointer.element, role);
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

  function sharedPhysicsPayload() {
    return Object.fromEntries(
      SHARED_PHYSICS_KEYS.map((key) => [key, params[key]])
    );
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

  function sharedTrailPointsToLocal(points) {
    if (!Array.isArray(points)) {
      return [];
    }
    updateBounds();
    const xScale = bounds.maxX / SharedPhysics.WORLD_WIDTH;
    const yScale = bounds.maxY / SharedPhysics.WORLD_HEIGHT;
    return points.slice(-1000).flatMap((point) => {
      if (!Array.isArray(point) || point.length < 2) {
        return [];
      }
      const x = Number(point[0]);
      const y = Number(point[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return [];
      }
      return [
        {
          x:
            clamp(x, 0, SharedPhysics.WORLD_WIDTH) * xScale +
            bounds.rockWidth / 2,
          y:
            clamp(y, 0, SharedPhysics.WORLD_HEIGHT) * yScale +
            bounds.rockHeight / 2,
        },
      ];
    });
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
    trail.points = sharedTrailPointsToLocal(points);
    syncTrailTail();
  }

  function appendSharedTrail(points) {
    const appended = sharedTrailPointsToLocal(points);
    if (appended.length === 0) {
      return;
    }
    trail.points.push(...appended);
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
    return SHARED_ROOM_SETTING_KEYS.map((key) => clean[key]).join(":");
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
      settingsSchemaVersion: 18,
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
      collab.pendingPhysicsChanges = Object.create(null);
      collab.pendingRoomSettingsChanges = Object.create(null);
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
      const response = await fetch(appUrl("api/sessions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          creatorClientId: collab.clientId,
          state: currentSharedState(),
          physics: sharedPhysicsPayload(),
          roomSettings: sharedRoomSettingsPayload(),
          masterViewport: currentViewport(),
          imprint: collab.imprint,
        }),
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
    clearHoldTimer();
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
    collab.holderIds.clear();
    collab.requiredHolders = 1;
    collab.remoteControllerId = null;
    rock.classList.remove("is-dragging", "is-falling");
    releasePointerCapture(pointerId);
    setGrabbingCursor(false);
    setHandToGrab();
    hideHandCursor();
    updateLocalSharedPointer(null, "grab", false);
    setPhase(PHASES.PLAY);
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
      collab.holderIds.clear();
      cancelSharedLocalDrag();
      updateLocalSharedPointer(null, "grab", false);
      hideHandCursor();
      clearRemotePointers();
      if (event.code === 4004) {
        collab.expired = true;
        collab.sessionId = "";
        collab.leaveToken = null;
        collab.trailCursor = 0;
      }
      updateSessionStatus();
      if (collab.expired) {
        void createSharedSession();
      }
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
      updateSharedHolders(payload.holderIds, payload.requiredHolders);
      collab.remoteControllerId = payload.holderId || collab.clientId;
      updateSessionStatus();
    } else if (message.type === "control.slipped") {
      collab.pendingControl = false;
      collab.hasControl = false;
      collab.releasePending = false;
      updateSharedHolders(payload.holderIds, payload.requiredHolders);
      cancelSharedLocalDrag();
      updateSessionStatus();
    } else if (message.type === "control.denied") {
      collab.pendingControl = false;
      collab.hasControl = false;
      cancelSharedLocalDrag();
      updateSessionStatus();
    } else if (message.type === "presence.update") {
      collab.participants = Math.max(1, Number(payload.participants) || 1);
      updateSharedHolders(payload.holderIds, payload.requiredHolders);
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
        collab.expired = true;
        collab.connected = false;
        collab.sessionId = "";
        collab.leaveToken = null;
        collab.trailCursor = 0;
        updateSessionStatus();
        void createSharedSession();
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
    const incomingRole = payload.clientRole || payload.clientSkin;
    if (typeof incomingRole === "string") {
      setLocalCursorRole(incomingRole);
    }
    if (Object.hasOwn(payload, "gachiSoundFilename")) {
      setSlaveClickSound(payload.gachiSoundFilename);
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
    collab.lastRevision = revision;
    const offsetSample = Date.now() - Number(payload.serverTime || Date.now());
    collab.clockOffset = collab.clockOffsetReady
      ? collab.clockOffset * 0.8 + offsetSample * 0.2
      : offsetSample;
    collab.clockOffsetReady = true;
    applySummitTimerSnapshot(payload);
    if (Object.hasOwn(payload, "masterViewport")) {
      applyMasterViewport(payload.masterViewport);
    }
    if (Object.hasOwn(payload, "physics")) {
      applySharedPhysics(payload.physics);
    }
    if (Object.hasOwn(payload, "roomSettings")) {
      applySharedRoomSettings(payload.roomSettings);
    }
    if (collab.settingsUpdateQueued) {
      scheduleSharedSettingsUpdate();
    }
    const holderIds = normalizeHolderIds(payload.holderIds);
    updateSharedHolders(holderIds, payload.requiredHolders);
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
      holderIds,
      requiredHolders: collab.requiredHolders,
      revision,
      serverTime: Number(payload.serverTime) || Date.now(),
    };
    const ownsHold = holderIds.includes(collab.clientId);
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
      if (cooperativeDragActive()) {
        clearSharedReleaseHandoff();
      }
    } else if (
      collab.hasControl ||
      collab.pendingControl
    ) {
      collab.hasControl = false;
      collab.pendingControl = false;
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

    startSharedRenderLoop();
    updateSessionStatus();
  }

  function leaveSharedSession(event) {
    if (
      event?.persisted ||
      collab.leaving ||
      !collab.enabled ||
      !collab.sessionId ||
      !collab.leaveToken ||
      window.location.protocol === "file:"
    ) {
      return;
    }

    collab.leaving = true;
    clearSharedConnectionTimers();
    const endpoint = appUrl(
      `api/sessions/${encodeURIComponent(collab.sessionId)}/leave`
    );
    const body = JSON.stringify({
      clientId: collab.clientId,
      leaveToken: collab.leaveToken,
    });
    let queued;
    try {
      queued = navigator.sendBeacon(
        endpoint,
        new Blob([body], { type: "application/json" })
      );
    } catch {
      queued = false;
    }
    if (!queued) {
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  }

  function applySharedFrame(snapshot) {
    if (
      !snapshot ||
      (motion.dragging && (collab.pendingControl || collab.hasControl))
    ) {
      return;
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

    const visiblyDragging =
      Boolean(snapshot.dragging) &&
      SharedPhysics.canLift(params, snapshot.holderIds.length);
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
    updatePositionScroll(deltaSeconds);
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
    const activeTogether = cooperativeDragActive();
    if (activeTogether) {
      applyDragTargetMovement(MAX_FRAME_SECONDS, collab.holderIds.size);
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
    const position = localToCanonical(motion.x, motion.y);
    const velocity = activeTogether
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
      return;
    }
    const canReleaseWithImpulse = cooperativeDragActive();
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
    if (!pointerVisible) {
      hideHandCursor();
    }
    updateSessionStatus();
  }

  function forceReleaseSharedDrag(hidePointer = false) {
    if (!motion.dragging) {
      return;
    }
    const canReleaseWithImpulse = cooperativeDragActive();
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

  function clearTrailCanvas() {
    trailCtx.save();
    trailCtx.setTransform(1, 0, 0, 1, 0, 0);
    trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
    trailCtx.restore();
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

  function resizeTrailCanvas() {
    trail.dirty = true;
    drawTrail();
  }

  function applyTrailBlendMode() {
    trailCanvas.style.mixBlendMode = body.classList.contains("theme-dark")
      ? "normal"
      : params.blendMode;
    trailCanvas.style.opacity = String(params.lineOpacity);
  }

  function resetTrail() {
    trail.points.length = 0;
    trail.lastX = null;
    trail.lastY = null;
    trail.followX = null;
    trail.followY = null;
    trail.skipNextRecord = false;
    clearTrailCanvas();
    trail.dirty = false;
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
      trail.dirty = true;
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
    const anchor = trailAnchorPoint({
      x: motion.x,
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

    trail.points.push({ x, y });
    trail.lastX = x;
    trail.lastY = y;
    if (params.trailEnabled) {
      trail.dirty = true;
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
    const scale = slaveViewportScale().x;
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

  function drawTrail() {
    ensureTrailCanvasSize();
    if (!trail.dirty) {
      return;
    }
    trail.dirty = false;
    clearTrailCanvas();

    const points = trail.points;
    if (!params.trailEnabled || points.length === 0) {
      return;
    }

    trailCtx.save();
    trailCtx.setTransform(
      trail.pixelRatio,
      0,
      0,
      trail.pixelRatio,
      -window.scrollX * trail.pixelRatio,
      -window.scrollY * trail.pixelRatio
    );
    trailCtx.globalAlpha = params.linePassOpacity;
    trailCtx.globalCompositeOperation = "lighter";
    trailCtx.lineCap = params.lineCap;
    trailCtx.lineJoin = params.lineJoin;
    trailCtx.lineWidth = scaledVisualPixel(params.lineWidth);

    if (params.glow > 0) {
      trailCtx.shadowBlur = scaledVisualPixel(params.glow);
      trailCtx.shadowColor = params.glowColor;
    }

    if (points.length < 2) {
      // Одна точка — рисуем кружок, чтобы след был виден.
      drawTrailStartPoint(points[0]);
      trailCtx.restore();
      return;
    }

    const last = points[points.length - 1];
    if (params.useGradient) {
      const first = points[0];
      const grad = trailCtx.createLinearGradient(
        first.x,
        first.y,
        last.x,
        last.y
      );
      grad.addColorStop(0, params.lineColorTail);
      grad.addColorStop(1, params.lineColor);
      trailCtx.strokeStyle = grad;
    } else {
      trailCtx.strokeStyle = params.lineColor;
    }

    // Отдельные additive-сегменты позволяют повторным проходам накапливать альфу.
    trailCtx.setLineDash(trailDashArray());
    let segmentStart = points[0];
    let dashOffset = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const segmentEnd = {
        x: (points[i].x + points[i + 1].x) / 2,
        y: (points[i].y + points[i + 1].y) / 2,
      };
      dashOffset += strokeTrailSegment(
        segmentStart,
        points[i],
        segmentEnd,
        dashOffset
      );
      segmentStart = segmentEnd;
    }
    strokeTrailSegment(segmentStart, null, last, dashOffset);
    trailCtx.setLineDash([]);
    trailCtx.lineDashOffset = 0;
    drawTrailStartPoint(points[0]);
    trailCtx.restore();
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

  function clearHoldTimer() {
    if (motion.holdTimerId === null) {
      return;
    }

    window.clearTimeout(motion.holdTimerId);
    motion.holdTimerId = null;
  }

  function scheduleHoldLimit() {
    clearHoldTimer();
    motion.holdTimerId = window.setTimeout(
      () => forceReleaseRock({ pauseInsideImprint: true }),
      maxHoldMs()
    );
  }

  function syncHoldLimit() {
    if (!motion.dragging || motion.phase !== PHASES.PLAY) {
      clearHoldTimer();
      return;
    }
    if (rockInsideImprint()) {
      clearHoldTimer();
      return;
    }
    if (motion.holdTimerId === null) {
      scheduleHoldLimit();
    }
  }

  function rockInsideImprint() {
    const imprint = activeLocalImprint();
    return Boolean(
      imprint &&
        Math.abs(motion.x - imprint.x) <= imprint.toleranceX &&
        Math.abs(motion.y - imprint.y) <= imprint.toleranceY
    );
  }

  function beginFinalReturnFall() {
    const state = SharedPhysics.sanitizeState(currentSharedState());
    if (!SharedPhysics.beginFinalFall(state)) {
      return false;
    }
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
    const touchedGroundCanonical =
      wasAboveGround && state.y >= SharedPhysics.WORLD_HEIGHT - 0.01;
    applyCanonicalMotion(state);
    const touchedGround =
      touchedGroundCanonical ||
      (previousY < bounds.maxY - 0.75 && motion.y >= bounds.maxY - 0.75);
    if (touchedGround) {
      hideReturnRain();
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

    updateBounds();

    if (
      motion.dragging &&
      (motion.phase === PHASES.INTRO || motion.phase === PHASES.PLAY)
    ) {
      applyDragTargetMovement(deltaSeconds);
      syncHoldLimit();
      syncReturnTheme();
    }

    if (motion.phase === PHASES.FALLING || motion.phase === PHASES.PLAY) {
      applyPhysics(deltaSeconds);
      if (shouldRecordTrailPoint()) {
        recordTrailPoint(deltaSeconds);
      }
    }

    updatePositionScroll(deltaSeconds);
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
    if (!SharedPhysics.canLift(params, activeHandCount())) {
      motion.vx = 0;
      motion.vy = 0;
      motion.suspended = false;
      return;
    }
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

  function forceReleaseRock({ pauseInsideImprint = false } = {}) {
    if (collab.enabled) {
      forceReleaseSharedDrag(true);
      return;
    }

    if (!motion.dragging) {
      return;
    }

    if (
      pauseInsideImprint &&
      motion.phase === PHASES.PLAY &&
      rockInsideImprint()
    ) {
      motion.holdTimerId = null;
      syncHoldLimit();
      return;
    }

    const pointerId = motion.activePointerId;
    const phaseAtRelease = motion.phase;
    const releasedInImprint =
      phaseAtRelease === PHASES.PLAY && rockInsideImprint();
    motion.dragging = false;
    motion.activePointerId = null;
    motion.holdTimerId = null;
    rock.classList.remove("is-dragging");
    setGrabbingCursor(false);
    releasePointerCapture(pointerId);

    if (releasedInImprint) {
      beginFinalReturnFall();
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

    if (motion.phase !== PHASES.PLAY) {
      return;
    }

    playRockPointerDownSound();

    if (collab.enabled) {
      beginSharedDrag(event);
      return;
    }

    event.preventDefault();
    toggleHandVariant();
    updateBounds();
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
    syncHoldLimit();
    syncReturnTheme();
    startLoop();
  }

  function moveDrag(event) {
    if (collab.enabled) {
      moveSharedDrag(event);
      return;
    }

    moveHandCursor(event);

    if (!motion.dragging || motion.phase !== PHASES.PLAY) {
      return;
    }

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

    const phaseAtRelease = motion.phase;
    const releasedInImprint =
      phaseAtRelease === PHASES.PLAY && rockInsideImprint();
    clearHoldTimer();
    motion.dragging = false;
    motion.activePointerId = null;
    rock.classList.remove("is-dragging");
    setGrabbingCursor(false);
    releasePointerCapture(event.pointerId);
    const pointerVelocity = currentPointerVelocity();

    if (releasedInImprint) {
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

    if (pointerRole(collab.clientRole) !== "slave") {
      playChainHoverSound();
    }
    showHandCursor(event);
    if (collab.enabled) {
      sendSharedPointer(event, "grab", true, true);
    }
  }

  function leaveRock(event) {
    if (!motion.dragging) {
      hideHandCursor();
      if (collab.enabled) {
        sendSharedPointer(event, "grab", false, true);
      }
    }
  }

  function cancelDragAndCursor() {
    if (collab.enabled && motion.dragging) {
      forceReleaseSharedDrag(true);
      return;
    }

    clearHoldTimer();
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

  // Открытием панели управляет React-хук useSettings.
  listen(rock, "pointerenter", enterRock);
  listen(rock, "pointerleave", leaveRock);
  listen(rock, "pointerdown", startDrag);
  listen(rock, "pointermove", moveDrag);
  listen(rock, "pointerup", stopDrag);
  listen(rock, "pointercancel", stopDrag);
  listen(rock, "lostpointercapture", () => {
    if (motion.dragging) {
      forceReleaseRock();
    }
  });
  listen(rock, "dragstart", (event) => event.preventDefault());
  listen(window, "pointerup", stopDrag);
  listen(window, "pointercancel", stopDrag);
  listen(window, "blur", cancelDragAndCursor);
  listen(window, "pagehide", leaveSharedSession);
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
    sendMasterViewport();
    resizeTrailCanvas();
    if (collab.enabled && collab.snapshots.length > 0) {
      applySharedFrame(collab.snapshots.at(-1));
    } else if (motion.phase === PHASES.INTRO || motion.suspended) {
      centerIntroRock();
    } else {
      setPosition(motion.x, motion.y);
    }
    renderImprint();
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
      getViewportScale: () => ({ ...slaveViewportScale() }),
      getRenderedVisualSettings: () => ({
        lineWidth: scaledVisualPixel(params.lineWidth),
        rainBlurPx: scaledVisualPixel(params.rainBlurPx),
        slaveHandWidthPx: scaledVisualPixel(params.slaveHandWidthPx),
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
      getSummitTimerState: () => ({
        elapsedMs: currentSummitElapsedMs(),
        running: summitTimer.running,
        serverTime: summitTimer.serverTime,
        text: summitTimerElement?.textContent || "",
      }),
      fitTopInscription,
      drawTrail,
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
      restartExperience,
      resetTrail,
      sendShared,
      setPosition,
      syncReturnTheme,
      trail,
      trimTrailToLimit,
      updateBounds,
    };
    window.__sisyphusTestApi = testApi;
    Object.assign(window, testApi);
  }
  settingsController.load();
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
      collab.leaving = true;
      stopLoop();
      document.documentElement.classList.remove(
        "is-manual-scroll-disabled",
      );
      body.classList.remove("is-manual-scroll-disabled");
      stopRainRenderers();
      clearHoldTimer();
      clearFirstFallTimer();
      clearSharedConnectionTimers();
      clearSharedReleaseHandoff();
      window.clearTimeout(collab.statusResetTimerId);
      window.clearTimeout(collab.settingsUpdateTimerId);
      stopRainLoopSound({ immediate: true });
      rainLoopController.dispose();
      cancelAllRoleAudioFades();
      chainHoverAudio.elements.forEach((audio) => audio?.pause());
      sessionRoleAudio.timerIds.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      sessionRoleAudio.timerIds.clear();
      sessionRoleAudio.elements.forEach((audio) => audio.pause());
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
