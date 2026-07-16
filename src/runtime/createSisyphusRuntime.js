import rainVendorUrl from "../../assets/raindrop-fx/index.js?url";
import {
  canonicalToLocalPosition,
  localToCanonicalPosition,
} from "../lib/coordinates.mjs";
import { shouldStartRainExit } from "../lib/rainState.mjs";
import { deriveSessionStatus } from "../lib/sessionStatus.mjs";
import { normalizeRainSettings } from "../lib/settingsModel.mjs";
import {
  LEGACY_SETTINGS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
} from "../config/settings.js";

export function createSisyphusRuntime(elements = {}) {
  // При обновлении страницы всегда открываем её сверху: запрещаем браузеру
  // восстанавливать прежнюю позицию прокрутки (во время игры это не скроллит).
  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }

  const body = document.body;
  const world = elements.world || document.querySelector(".world");
  const rock = elements.rock || document.querySelector(".rock");
  const rockImprint = elements.rockImprint || document.querySelector(".rock-imprint");
  const handCursor = elements.handCursor || document.querySelector(".hand-cursor");
  const remoteCursorLayer = elements.remoteCursorLayer || document.querySelector(".remote-cursors");
  const settingsPanel = elements.settingsPanel || document.querySelector(".settings-panel");
  const trailCanvas = elements.trailCanvas || document.querySelector(".trail");
  const trailCtx = trailCanvas.getContext("2d");
  const rainLayer = elements.rainLayer || document.querySelector(".weather-rain");
  const rainFxCanvas = elements.rainFxCanvas || document.querySelector(".weather-rain__canvas--fx");
  const rainFallbackCanvas = elements.rainFallbackCanvas || document.querySelector(".weather-rain__canvas--fallback");
  const hintEl = elements.hint || document.querySelector(".hint");
  const sessionStatus = elements.sessionStatus || document.querySelector("[data-session-status]");
  const sessionShareToggle = elements.sessionShareToggle || document.querySelector(".session-share-toggle");
  const sessionRestartButton = elements.sessionRestartButton || document.querySelector(".session-restart");
  const finePointer = window.matchMedia("(pointer: fine)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const SharedPhysics = window.SisyphusPhysics;
  const listenerDisposers = [];
  let disposed = false;

  function listen(target, type, listener, options) {
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
  };

  const PHASES = SharedPhysics.PHASES;

  // Камера занимает 200vh, но физика не читает DOM-высоту .world.
  const SCENE_VIEWPORT_HEIGHTS = 2;
  const FLOOR_INSET = 0;
  const FIRST_FALL_DELAY_MS = 400;
  const DRAG_LIFT_BASE_SPEED = 420;
  const DRAG_LIFT_FORCE_SPEED = 880;
  const DRAG_LIFT_MIN_SPEED = 220;
  const DRAG_LIFT_MAX_SPEED = 2800;
  const MAX_FRAME_SECONDS = 0.032;
  const RAIN_VENDOR_SRC = rainVendorUrl;
  const RAIN_SCRIPT_ID = "sisyphus-raindrop-fx";
  const DEFAULT_RAIN_ENTER_EASING = "cubic-bezier(0.2, 0, 0, 1)";
  const DEFAULT_RAIN_EXIT_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
  const DEFAULT_RAIN_ENTER_MS = 1100;
  const DEFAULT_RAIN_EXIT_MS = 2000;
  const DEFAULT_RAIN_Z_INDEX = 5;
  const MIN_RAIN_STRENGTH = 0.25;
  const MAX_RAIN_STRENGTH = 1.5;
  const MAX_RAIN_FX_OPACITY = 0.42;
  const RAIN_BASE_PROFILE = {
    dropletsPerSecond: 1300,
    fallbackDropCount: 130,
    fallbackOpacity: 0.36,
    fallbackAlpha: [0.18, 0.46],
    fallbackLength: [16, 50],
    fallbackSpeed: [9, 21],
    fallbackWidth: [0.8, 2],
    fxOpacity: MAX_RAIN_FX_OPACITY,
    mistAlpha: 0.48,
    spawnInterval: [0.018, 0.05],
    spawnLimit: 1300,
    spawnSize: [38, 104],
  };

  const params = {
    mass: 4,
    gravity: 1,
    handForce: 5,
    pointerInfluence: 1,
    bounce: 0.35,
    inertia: 90,
    groundFriction: 0.35,
    turbulence: 0.4,

    // Дождь
    rainEnabled: false,
    rainStrength: 1,
    rainZIndex: DEFAULT_RAIN_Z_INDEX,
    rainEnterEasing: DEFAULT_RAIN_ENTER_EASING,
    rainExitEasing: DEFAULT_RAIN_EXIT_EASING,
    rainEnterMs: DEFAULT_RAIN_ENTER_MS,
    rainExitMs: DEFAULT_RAIN_EXIT_MS,

    // След
    trailEnabled: true,
    trailReset: false,
    lineDelay: 0.5,
    trailMaxPoints: 1000,
    trailUnlimited: false,
    trailSampleDist: 6,

    // След — стиль
    blendMode: "difference",
    lineColor: "#ffffff",
    lineColorTail: "#ffffff",
    useGradient: false,
    lineWidth: 6,
    lineOpacity: 0.9,
    dashStyle: "solid",
    dashLength: 12,
    dashGap: 8,
    lineCap: "round",
    lineJoin: "round",
    glow: 0,
    glowColor: "#ffffff",
  };

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
    activePointerId: null,
    holdTimerId: null,
    firstFallTimerId: null,
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
  };

  const SHARED_PHYSICS_KEYS = [
    "mass",
    "gravity",
    "handForce",
    "pointerInfluence",
    "bounce",
    "inertia",
    "groundFriction",
    "turbulence",
  ];
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
      const created = crypto.randomUUID();
      sessionStorage.setItem("sisyphus-client-id", created);
      return created;
    } catch {
      return crypto.randomUUID();
    }
  }

  const collab = {
    enabled: false,
    sessionId: new URLSearchParams(window.location.search).get("session") || "",
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
    copyFeedbackTimerId: null,
    statusResetTimerId: null,
    renderId: null,
    snapshots: [],
    lastRevision: -1,
    clockOffset: 0,
    clockOffsetReady: false,
    hasControl: false,
    pendingControl: false,
    releasePending: false,
    remoteControllerId: null,
    participants: 1,
    applyingRemotePhysics: false,
    physicsTimerId: null,
    physicsSignature: "",
    pendingPhysicsChanges: Object.create(null),
    sessionCreateInFlight: false,
    sessionCreateAbortController: null,
    firstReleaseTimerId: null,
    lastMoveSentAt: 0,
    lastPointerSentAt: 0,
    lastRenderAt: 0,
    imprint: null,
    releaseHandoff: {
      active: false,
      fromX: 0,
      fromY: 0,
      startedAt: 0,
    },
    localPointer: {
      x: SharedPhysics.WORLD_WIDTH / 2,
      y: 0,
      mode: "grab",
      visible: false,
    },
    remotePointers: new Map(),
  };
  collab.enabled = Boolean(collab.sessionId);

  const rain = {
    active: false,
    fallback: null,
    hideTimerId: null,
    rainFx: null,
    renderToken: 0,
    returnRequested: false,
    resizeHandler: null,
  };

  let rainFxScriptPromise = null;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
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
    background.width = width;
    background.height = height;

    const context = background.getContext("2d");
    if (!context) {
      return background;
    }

    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#f9fbff");
    gradient.addColorStop(0.5, "#d9e0ea");
    gradient.addColorStop(1, "#ffffff");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    context.fillStyle = "rgba(255, 255, 255, 0.36)";
    context.fillRect(width * 0.16, 0, width * 0.2, height);
    context.fillStyle = "rgba(76, 92, 113, 0.16)";
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

  function scaleRainRange(range, scale) {
    return range.map((value) => Number((value * scale).toFixed(3)));
  }

  function getRainVisualProfile() {
    const strength = clamp(
      finiteNumber(params.rainStrength, 1),
      MIN_RAIN_STRENGTH,
      MAX_RAIN_STRENGTH
    );
    const opacityScale = Math.sqrt(strength);
    const sizeScale = 0.9 + strength * 0.1;
    const speedScale = 0.9 + strength * 0.12;
    const widthScale = Math.min(1.18, 0.86 + strength * 0.14);

    return {
      dropletsPerSecond: Math.round(RAIN_BASE_PROFILE.dropletsPerSecond * strength),
      fallbackDropCount: Math.round(RAIN_BASE_PROFILE.fallbackDropCount * strength),
      fallbackOpacity: clamp(
        RAIN_BASE_PROFILE.fallbackOpacity * opacityScale,
        0.06,
        MAX_RAIN_FX_OPACITY
      ),
      fallbackAlpha: RAIN_BASE_PROFILE.fallbackAlpha.map((alpha) =>
        clamp(alpha * opacityScale, 0.04, 0.72)
      ),
      fallbackLength: scaleRainRange(RAIN_BASE_PROFILE.fallbackLength, sizeScale),
      fallbackSpeed: scaleRainRange(RAIN_BASE_PROFILE.fallbackSpeed, speedScale),
      fallbackWidth: scaleRainRange(RAIN_BASE_PROFILE.fallbackWidth, widthScale),
      fxOpacity: clamp(
        RAIN_BASE_PROFILE.fxOpacity * opacityScale,
        0.08,
        MAX_RAIN_FX_OPACITY
      ),
      mistAlpha: clamp(RAIN_BASE_PROFILE.mistAlpha * opacityScale, 0.12, 0.8),
      spawnInterval: [
        Math.max(0.01, RAIN_BASE_PROFILE.spawnInterval[0] / strength),
        Math.max(0.025, RAIN_BASE_PROFILE.spawnInterval[1] / strength),
      ],
      spawnLimit: Math.round(RAIN_BASE_PROFILE.spawnLimit * strength),
      spawnSize: scaleRainRange(RAIN_BASE_PROFILE.spawnSize, sizeScale),
    };
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

    if (restartIfActive && rain.active) {
      stopRainRenderers();
      startRainRenderers();
    }
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
        context.strokeStyle = `rgba(82, 113, 143, ${drop.alpha})`;
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

    const rainProfile = getRainVisualProfile();
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
    resizeCanvasToCssPixels(rainFallbackCanvas);
    rain.fallback = startFallbackRain(rainFallbackCanvas, rainProfile);
    setRainOpacity(
      rainFallbackCanvas,
      rain.fallback ? rainProfile.fallbackOpacity : 0
    );

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

        resizeCanvasToCssPixels(rainFxCanvas);
        const instance = new RaindropFX({
          canvas: rainFxCanvas,
          background: createRainBackground(rainFxCanvas),
          dropletsPerSecond: rainProfile.dropletsPerSecond,
          dropletsPerSeconds: rainProfile.dropletsPerSecond,
          spawnInterval: rainProfile.spawnInterval,
          spawnSize: rainProfile.spawnSize,
          spawnLimit: rainProfile.spawnLimit,
          mist: true,
          mistColor: [0.04, 0.04, 0.05, rainProfile.mistAlpha],
          backgroundBlurSteps: 3,
          raindropCompose: "harder",
          raindropDiffuseLight: [0.42, 0.42, 0.44],
          raindropSpecularLight: [0.78, 0.78, 0.8],
        });
        rain.rainFx = instance;

        await instance.start?.();
        if (token !== rain.renderToken) {
          instance.stop?.();
          instance.destroy?.();
          return;
        }

        setRainOpacity(rainFxCanvas, rainProfile.fxOpacity);
        setRainOpacity(
          rainFallbackCanvas,
          rain.fallback ? rainProfile.fallbackOpacity : 0
        );
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

    window.clearTimeout(rain.hideTimerId);
    rain.hideTimerId = null;
    rainLayer.classList.remove("is-rain-hiding");
    rainLayer.classList.add("is-rain-visible");
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

  function isAtReturnPlace(isDragging = motion.dragging) {
    return motion.phase === PHASES.PLAY && isDragging && rockInsideImprint();
  }

  function setTheme(theme) {
    body.classList.toggle("theme-light", theme === "light");
    body.classList.toggle("theme-dark", theme === "dark");
  }

  function setScrollLocked(locked) {
    document.documentElement.classList.toggle("is-scroll-locked", locked);
    body.classList.toggle("is-scroll-locked", locked);
    if (locked && window.scrollY !== 0) {
      window.scrollTo(0, 0);
    }
  }

  function syncScrollLock(firstTouchHappened) {
    setScrollLocked(!firstTouchHappened);
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
    return clamp(
      (3000 * params.handForce) / (params.mass * params.gravity * 5),
      500,
      3000
    );
  }

  function dragLiftSpeed() {
    const load = Math.max(params.mass * params.gravity, 0.1);
    return clamp(
      DRAG_LIFT_BASE_SPEED + (DRAG_LIFT_FORCE_SPEED * params.handForce) / load,
      DRAG_LIFT_MIN_SPEED,
      DRAG_LIFT_MAX_SPEED
    );
  }

  const STORAGE_KEY = SETTINGS_STORAGE_KEY;

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
    } catch {
      /* localStorage недоступен — тихо игнорируем */
    }
  }

  function loadSettings() {
    let stored = null;
    let migratedLegacySettings = false;
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      const raw = current ?? localStorage.getItem(LEGACY_SETTINGS_STORAGE_KEY);
      migratedLegacySettings = current === null && raw !== null;
      stored = JSON.parse(raw || "null");
    } catch {
      stored = null;
    }
    if (!stored || typeof stored !== "object") {
      return;
    }

    if (migratedLegacySettings) {
      const legacyInertia = Number(stored.inertia);
      if (
        Number.isFinite(legacyInertia) &&
        legacyInertia >= 0 &&
        legacyInertia <= 1
      ) {
        stored = { ...stored, inertia: legacyInertia * 100 };
      }
    }
    if (
      !Object.hasOwn(stored, "groundFriction") &&
      Object.hasOwn(stored, "sliding")
    ) {
      stored = { ...stored, groundFriction: stored.sliding };
    }

    settingsPanel.querySelectorAll("input, select").forEach((el) => {
      const key = el.getAttribute("name");
      if (!key || !(key in stored)) {
        return;
      }
      if (el.type === "checkbox") {
        el.checked = Boolean(stored[key]);
      } else {
        el.value = stored[key];
      }
    });
  }

  function updateControlOutputs() {
    const outputs = {
      mass: params.mass.toFixed(0),
      gravity: params.gravity.toFixed(1),
      handForce: params.handForce.toFixed(0),
      pointerInfluence: params.pointerInfluence.toFixed(1),
      bounce: params.bounce.toFixed(2),
      inertia: params.inertia.toFixed(0),
      groundFriction: params.groundFriction.toFixed(2),
      turbulence: params.turbulence.toFixed(2),
      rainStrength: `${Math.round(params.rainStrength * 100)}%`,
      rainZIndex: params.rainZIndex.toFixed(0),
      rainEnterMs: params.rainEnterMs.toFixed(0),
      rainExitMs: params.rainExitMs.toFixed(0),
      lineDelay: params.lineDelay.toFixed(2),
      trailMaxPoints: params.trailMaxPoints.toFixed(0),
      trailSampleDist: params.trailSampleDist.toFixed(0),
      lineWidth: params.lineWidth.toFixed(0),
      lineOpacity: params.lineOpacity.toFixed(2),
      dashLength: params.dashLength.toFixed(0),
      dashGap: params.dashGap.toFixed(0),
      glow: params.glow.toFixed(0),
    };

    Object.entries(outputs).forEach(([key, value]) => {
      document.querySelectorAll(`[data-output="${key}"]`).forEach((el) => {
        el.textContent = value;
      });
    });
  }

  function readControls(options = {}) {
    const num = (name) =>
      Number(settingsPanel.querySelector(`[name="${name}"]`).value);
    const str = (name) => settingsPanel.querySelector(`[name="${name}"]`).value;
    const bool = (name) =>
      settingsPanel.querySelector(`[name="${name}"]`).checked;
    const changedKey = options.changedKey || "";

    params.mass = num("mass");
    params.gravity = num("gravity");
    params.handForce = num("handForce");
    params.pointerInfluence = num("pointerInfluence");
    params.bounce = num("bounce");
    params.inertia = num("inertia");
    params.groundFriction = num("groundFriction");
    params.turbulence = num("turbulence");
    params.rainEnabled = bool("rainEnabled");

    Object.assign(
      params,
      normalizeRainSettings(
        {
          rainStrength: num("rainStrength"),
          rainZIndex: num("rainZIndex"),
          rainEnterEasing: str("rainEnterEasing"),
          rainExitEasing: str("rainExitEasing"),
          rainEnterMs: num("rainEnterMs"),
          rainExitMs: num("rainExitMs"),
        },
        {
          defaults: {
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

    params.trailEnabled = bool("trailEnabled");
    params.trailReset = bool("trailReset");
    params.lineDelay = num("lineDelay");
    params.trailMaxPoints = num("trailMaxPoints");
    params.trailUnlimited = bool("trailUnlimited");
    params.trailSampleDist = num("trailSampleDist");

    params.blendMode = str("blendMode");
    params.lineColor = str("lineColor");
    params.lineColorTail = str("lineColorTail");
    params.useGradient = bool("useGradient");
    params.lineWidth = num("lineWidth");
    params.lineOpacity = num("lineOpacity");
    params.dashStyle = str("dashStyle");
    params.dashLength = num("dashLength");
    params.dashGap = num("dashGap");
    params.lineCap = str("lineCap");
    params.lineJoin = str("lineJoin");
    params.glow = num("glow");
    params.glowColor = str("glowColor");

    settingsPanel.querySelector('[name="rainStrength"]').value = params.rainStrength;
    settingsPanel.querySelector('[name="rainZIndex"]').value = params.rainZIndex;
    settingsPanel.querySelector('[name="rainEnterEasing"]').value = params.rainEnterEasing;
    settingsPanel.querySelector('[name="rainExitEasing"]').value = params.rainExitEasing;
    settingsPanel.querySelector('[name="rainEnterMs"]').value = params.rainEnterMs;
    settingsPanel.querySelector('[name="rainExitMs"]').value = params.rainExitMs;
    applyRainSettings({ restartIfActive: changedKey === "rainStrength" });
    if (changedKey === "rainEnabled" || changedKey === "") {
      syncRainVisibility({
        immediate: changedKey === "",
      });
    }

    trailCanvas.style.mixBlendMode = params.blendMode;

    const trailLengthInput = settingsPanel.querySelector(
      '[name="trailMaxPoints"]'
    );
    trailLengthInput.disabled = params.trailUnlimited;
    trailLengthInput
      .closest(".control")
      .classList.toggle("is-disabled", params.trailUnlimited);
    trimTrailToLimit();

    updateControlOutputs();
    saveSettings();
    drawTrail();
    if (
      collab.enabled &&
      !collab.applyingRemotePhysics &&
      SHARED_PHYSICS_KEYS.includes(changedKey)
    ) {
      collab.pendingPhysicsChanges[changedKey] = params[changedKey];
      scheduleSharedPhysicsUpdate();
    }
  }

  function canShowPhotoCursor(event) {
    return finePointer.matches && (!event.pointerType || event.pointerType === "mouse");
  }

  function moveHandCursor(event) {
    if (!canShowPhotoCursor(event)) {
      return;
    }

    handCursor.style.setProperty("--cursor-x", `${event.clientX}px`);
    handCursor.style.setProperty("--cursor-y", `${event.clientY}px`);
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
    bounds.worldHeight = Math.max(
      window.innerHeight * SCENE_VIEWPORT_HEIGHTS,
      bounds.rockHeight + FLOOR_INSET
    );
    bounds.maxY = Math.max(0, bounds.worldHeight - bounds.rockHeight - FLOOR_INSET);
  }

  function setPosition(x, y) {
    updateBounds();
    motion.x = clamp(x, 0, bounds.maxX);
    motion.y = clamp(y, 0, bounds.maxY);
    rock.style.setProperty("--rock-x", `${motion.x}px`);
    rock.style.setProperty("--rock-y", `${motion.y}px`);
  }

  function localImprintToCanonical(imprint) {
    if (!imprint) {
      return null;
    }
    updateBounds();
    const position = localToCanonical(imprint.x, imprint.y);
    return SharedPhysics.sanitizeImprint({
      ...position,
      toleranceX:
        bounds.maxX > 0
          ? (imprint.toleranceX / bounds.maxX) * SharedPhysics.WORLD_WIDTH
          : SharedPhysics.WORLD_WIDTH,
      toleranceY:
        bounds.maxY > 0
          ? (imprint.toleranceY / bounds.maxY) * SharedPhysics.WORLD_HEIGHT
          : 1,
    });
  }

  function sharedImprintAt(position) {
    updateBounds();
    return SharedPhysics.sanitizeImprint({
      ...position,
      toleranceX:
        bounds.maxX > 0
          ? ((bounds.rockWidth * SharedPhysics.IMPRINT_TOLERANCE_FRACTION) /
              bounds.maxX) *
            SharedPhysics.WORLD_WIDTH
          : SharedPhysics.WORLD_WIDTH,
      toleranceY:
        bounds.maxY > 0
          ? ((bounds.rockHeight * SharedPhysics.IMPRINT_TOLERANCE_FRACTION) /
              bounds.maxY) *
            SharedPhysics.WORLD_HEIGHT
          : 1,
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
        toleranceX:
          (imprint.toleranceX / SharedPhysics.WORLD_WIDTH) * bounds.maxX,
        toleranceY:
          (imprint.toleranceY / SharedPhysics.WORLD_HEIGHT) * bounds.maxY,
      };
    }
    return motion.imprint;
  }

  function renderImprint() {
    const imprint = activeLocalImprint();
    rockImprint.classList.toggle("is-visible", Boolean(imprint));
    if (!imprint) {
      return;
    }
    rockImprint.style.setProperty("--imprint-x", `${imprint.x}px`);
    rockImprint.style.setProperty("--imprint-y", `${imprint.y}px`);
  }

  function createLocalImprint() {
    if (motion.imprint) {
      return motion.imprint;
    }
    updateBounds();
    motion.imprint = {
      x: motion.x,
      y: motion.y,
      toleranceX:
        bounds.rockWidth * SharedPhysics.IMPRINT_TOLERANCE_FRACTION,
      toleranceY:
        bounds.rockHeight * SharedPhysics.IMPRINT_TOLERANCE_FRACTION,
    };
    renderImprint();
    return motion.imprint;
  }

  function setDragTargetFromPointer(event) {
    motion.dragTargetX = event.clientX + window.scrollX - motion.grabX;
    motion.dragTargetY = event.clientY + window.scrollY - motion.grabY;
  }

  function applyDragTargetMovement(deltaSeconds) {
    if (!motion.dragging) {
      return;
    }

    const maxLiftDistance = dragLiftSpeed() * deltaSeconds;
    const nextY =
      motion.dragTargetY < motion.y
        ? Math.max(motion.dragTargetY, motion.y - maxLiftDistance)
        : motion.dragTargetY;

    setPosition(motion.dragTargetX, nextY);
  }

  function initialLocalPosition() {
    updateBounds();
    return canonicalToLocal(
      SharedPhysics.WORLD_WIDTH / 2,
      SharedPhysics.WORLD_HEIGHT * 0.16
    );
  }

  function centerIntroRock() {
    const position = initialLocalPosition();
    setPosition(position.x, position.y);
  }

  function setSessionStatus(text, state = "local") {
    sessionStatus.textContent = text;
    sessionStatus.dataset.state = state;
  }

  function updateSessionStatus() {
    sessionShareToggle.setAttribute("aria-label", "Скопировать ссылку");
    sessionShareToggle.title = "Скопировать ссылку";
    sessionShareToggle.dataset.state = collab.connected ? "online" : "local";
    const status = deriveSessionStatus(collab);
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

  function pointerEventToCanonical(event) {
    const rect = world.getBoundingClientRect();
    updateBounds();
    const localY = event.clientY - rect.top;
    return {
      x:
        rect.width > 0
          ? clamp(
              ((event.clientX - rect.left) / rect.width) * SharedPhysics.WORLD_WIDTH,
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

  function updateLocalSharedPointer(event, mode, visible) {
    if (event) {
      const position = pointerEventToCanonical(event);
      collab.localPointer.x = position.x;
      collab.localPointer.y = position.y;
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
      pointer = { element, x, y, targetX: x, targetY: y };
      collab.remotePointers.set(clientId, pointer);
    }
    pointer.targetX = x;
    pointer.targetY = y;
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
    updateBounds();
    collab.remotePointers.forEach((pointer) => {
      pointer.x += (pointer.targetX - pointer.x) * 0.42;
      pointer.y += (pointer.targetY - pointer.y) * 0.42;
      const local = canonicalToLocal(pointer.x, pointer.y);
      const viewportX = rect.left + local.x;
      const viewportY = rect.top + local.y;
      pointer.element.style.setProperty("--cursor-x", `${viewportX}px`);
      pointer.element.style.setProperty("--cursor-y", `${viewportY}px`);
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

  function currentSharedState() {
    const position = localToCanonical(motion.x, motion.y);
    const velocity = localVelocityToCanonical(motion.vx, motion.vy);
    return {
      phase: motion.phase,
      x: position.x,
      y: position.y,
      vx: velocity.vx,
      vy: velocity.vy,
      turbTime: motion.turbTime,
    };
  }

  function applyCanonicalMotion(state) {
    const position = canonicalToLocal(state.x, state.y);
    const velocity = canonicalVelocityToLocal(state.vx, state.vy);
    setPosition(position.x, position.y);
    motion.vx = velocity.vx;
    motion.vy = velocity.vy;
    motion.turbTime = state.turbTime;
  }

  function initialSharedState() {
    const position = initialLocalPosition();
    const canonical = localToCanonical(position.x, position.y);
    return {
      phase: PHASES.INTRO,
      x: canonical.x,
      y: canonical.y,
      vx: 0,
      vy: 0,
      turbTime: 0,
    };
  }

  function currentSharedTrail() {
    updateBounds();
    const xScale =
      bounds.maxX > 0 ? SharedPhysics.WORLD_WIDTH / bounds.maxX : 0;
    const yScale =
      bounds.maxY > 0 ? SharedPhysics.WORLD_HEIGHT / bounds.maxY : 0;
    return trail.points.slice(-1000).map((point) => {
      const x =
        xScale > 0
          ? clamp(
              (point.x - bounds.rockWidth / 2) * xScale,
              0,
              SharedPhysics.WORLD_WIDTH
            )
          : SharedPhysics.WORLD_WIDTH / 2;
      const y =
        yScale > 0
          ? clamp(
              (point.y - bounds.rockHeight / 2) * yScale,
              0,
              SharedPhysics.WORLD_HEIGHT
            )
          : 0;
      return [Math.round(x), Math.round(y)];
    });
  }

  function currentSharedImprint() {
    if (collab.imprint) {
      return { ...collab.imprint };
    }
    return localImprintToCanonical(motion.imprint);
  }

  function loadSharedTrail(points) {
    if (!Array.isArray(points)) {
      return;
    }
    updateBounds();
    const xScale = bounds.maxX / SharedPhysics.WORLD_WIDTH;
    const yScale = bounds.maxY / SharedPhysics.WORLD_HEIGHT;
    trail.points = points.slice(-1000).flatMap((point) => {
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
    const last = trail.points.at(-1);
    trail.lastX = last ? last.x : null;
    trail.lastY = last ? last.y : null;
    trail.followX = trail.lastX;
    trail.followY = trail.lastY;
    drawTrail();
  }

  function applySharedPhysics(physics) {
    if (!physics || typeof physics !== "object") {
      return;
    }
    const signature = SHARED_PHYSICS_KEYS.map((key) =>
      Number(physics[key])
    ).join(":");
    collab.physicsSignature = signature;
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
      const input = settingsPanel.querySelector(`[name="${key}"]`);
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

  function scheduleSharedPhysicsUpdate() {
    if (
      !collab.enabled ||
      collab.applyingRemotePhysics
    ) {
      return;
    }
    if (!collab.connected) {
      return;
    }
    window.clearTimeout(collab.physicsTimerId);
    collab.physicsTimerId = window.setTimeout(() => {
      collab.physicsTimerId = null;
      const payload = { ...collab.pendingPhysicsChanges };
      if (Object.keys(payload).length > 0) {
        sendShared("physics.update", payload);
      }
    }, 100);
  }

  function showCopiedLinkFeedback() {
    window.clearTimeout(collab.copyFeedbackTimerId);
    sessionShareToggle.classList.add("is-copied");
    sessionShareToggle.setAttribute("aria-label", "Ссылка скопирована");
    collab.copyFeedbackTimerId = window.setTimeout(() => {
      collab.copyFeedbackTimerId = null;
      sessionShareToggle.classList.remove("is-copied");
      updateSessionStatus();
    }, 400);
  }

  async function copySessionLink(options = {}) {
    const showToggleFeedback = Boolean(options.showToggleFeedback);
    const announce = options.announce !== false;
    const link = options.link || window.location.href;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const input = document.createElement("textarea");
      input.value = link;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      if (!copied) {
        window.prompt("Скопируйте ссылку на сессию", link);
      }
    }
    if (showToggleFeedback) {
      showCopiedLinkFeedback();
    }
    if (announce) {
      setSessionStatus("Ссылка скопирована", collab.connected ? "online" : "connecting");
      window.clearTimeout(collab.statusResetTimerId);
      collab.statusResetTimerId = window.setTimeout(() => {
        collab.statusResetTimerId = null;
        if (!disposed) {
          updateSessionStatus();
        }
      }, 1600);
    }
  }

  async function createSharedSession() {
    if (disposed || collab.sessionCreateInFlight) {
      return;
    }
    if (collab.enabled && collab.sessionId && !collab.expired) {
      return;
    }
    if (window.location.protocol === "file:") {
      setSessionStatus("Для ссылки запустите приложение через Docker", "error");
      return;
    }

    collab.sessionCreateInFlight = true;
    const abortController = new AbortController();
    collab.sessionCreateAbortController = abortController;
    setSessionStatus("Создаём общую сессию…", "connecting");
    try {
      const response = await fetch(appUrl("api/sessions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          state: currentSharedState(),
          physics: sharedPhysicsPayload(),
          trail: currentSharedTrail(),
          imprint: currentSharedImprint(),
        }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const result = await response.json();
      if (disposed) {
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.set("session", result.sessionId);
      window.location.replace(url);
    } catch {
      if (disposed) {
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

  async function copyCurrentSessionLink() {
    await copySessionLink({ showToggleFeedback: true, announce: false });
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
      snapshot.phase === PHASES.PLAY &&
      snapshot.dragging &&
      SharedPhysics.stateInsideImprint(
        { phase: snapshot.phase, x: snapshot.x, y: snapshot.y },
        collab.imprint
      )
    ) {
      return true;
    }
    return false;
  }

  function sharedSnapshotTheme(snapshot) {
    if (snapshot.phase === PHASES.INTRO || snapshot.phase === PHASES.WON) {
      return "light";
    }
    return sharedSnapshotAtReturnPlace(snapshot) ? "light" : "dark";
  }

  function resetLocalExperience() {
    const pointerId = motion.activePointerId;
    window.clearTimeout(collab.firstReleaseTimerId);
    collab.firstReleaseTimerId = null;
    clearHoldTimer();
    clearFirstFallTimer();
    stopLoop();
    motion.dragging = false;
    motion.activePointerId = null;
    motion.vx = 0;
    motion.vy = 0;
    motion.pointerVx = 0;
    motion.pointerVy = 0;
    motion.turbTime = 0;
    motion.imprint = null;
    collab.imprint = null;
    collab.snapshots = [];
    clearSharedReleaseHandoff();
    collab.hasControl = false;
    collab.pendingControl = false;
    collab.releasePending = false;
    collab.remoteControllerId = null;
    rock.classList.remove("is-dragging", "is-falling");
    releasePointerCapture(pointerId);
    setGrabbingCursor(false);
    setHandToGrab();
    hideHandCursor();
    updateLocalSharedPointer(null, "grab", false);
    setPhase(PHASES.INTRO);
    setTheme("light");
    hideReturnRain({ immediate: true });
    syncScrollLock(false);
    resetTrail();
    renderImprint();
    centerIntroRock();
    updateSessionStatus();
  }

  function restartExperience() {
    if (collab.enabled) {
      if (sendShared("session.restart", initialSharedState())) {
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
    window.clearInterval(collab.pingTimerId);
    collab.reconnectTimerId = null;
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
      scheduleSharedPhysicsUpdate();
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
      collab.hasControl = false;
      collab.pendingControl = false;
      collab.releasePending = false;
      cancelSharedLocalDrag();
      updateLocalSharedPointer(null, "grab", false);
      hideHandCursor();
      clearRemotePointers();
      if (event.code === 4004) {
        collab.expired = true;
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
    } else if (message.type === "control.granted") {
      collab.pendingControl = false;
      collab.hasControl = true;
      collab.remoteControllerId = collab.clientId;
      syncScrollLock(true);
      updateSessionStatus();
    } else if (message.type === "control.denied") {
      collab.pendingControl = false;
      collab.hasControl = false;
        cancelSharedLocalDrag();
      updateSessionStatus();
    } else if (message.type === "presence.update") {
      collab.participants = Math.max(1, Number(payload.participants) || 1);
      collab.remoteControllerId = payload.controllerId || null;
      syncRemotePointers(payload.pointers);
      updateSessionStatus();
    } else if (message.type === "pointer.update") {
      receiveRemotePointer(payload);
    } else if (message.type === "pong") {
      const sample = Date.now() - Number(payload.serverTime || Date.now());
      collab.clockOffset = collab.clockOffsetReady
        ? collab.clockOffset * 0.8 + sample * 0.2
        : sample;
      collab.clockOffsetReady = true;
    } else if (message.type === "error") {
      if (payload.code === "session_not_found") {
        collab.expired = true;
        collab.connected = false;
        updateSessionStatus();
        void createSharedSession();
      }
    }
  }

  function receiveSharedSnapshot(payload) {
    if (
      typeof payload.leaveToken === "string" &&
      /^[A-Za-z0-9_-]{22}$/.test(payload.leaveToken)
    ) {
      collab.leaveToken = payload.leaveToken;
    }

    const revision = Number(payload.revision);
    if (!Number.isSafeInteger(revision) || revision <= collab.lastRevision) {
      return;
    }
    if (!Object.values(PHASES).includes(payload.phase)) {
      return;
    }

    collab.lastRevision = revision;
    const offsetSample = Date.now() - Number(payload.serverTime || Date.now());
    collab.clockOffset = collab.clockOffsetReady
      ? collab.clockOffset * 0.8 + offsetSample * 0.2
      : offsetSample;
    collab.clockOffsetReady = true;
    applySharedPhysics(payload.physics);

    collab.imprint = SharedPhysics.sanitizeImprint(payload.imprint);
    syncScrollLock(
      Boolean(collab.imprint) || payload.phase !== PHASES.INTRO
    );
    renderImprint();

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
      revision,
      serverTime: Number(payload.serverTime) || Date.now(),
    };
    if (
      collab.releasePending &&
      snapshot.dragging &&
      snapshot.controllerId === collab.clientId
    ) {
      return;
    }
    if (
      collab.releasePending &&
      (!snapshot.dragging || snapshot.controllerId !== collab.clientId)
    ) {
      collab.releasePending = false;
    }
    const localControlWasEnding =
      (collab.hasControl || collab.pendingControl || motion.dragging) &&
      (!snapshot.dragging || snapshot.controllerId !== collab.clientId) &&
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

    const ownsControl =
      snapshot.dragging && snapshot.controllerId === collab.clientId;
    collab.remoteControllerId = snapshot.controllerId;
    if (ownsControl) {
      collab.hasControl = true;
      collab.pendingControl = false;
      collab.releasePending = false;
      clearSharedReleaseHandoff();
    } else if (
      collab.hasControl ||
      collab.pendingControl ||
      (snapshot.controllerId && snapshot.controllerId !== collab.clientId)
    ) {
      collab.hasControl = false;
      collab.pendingControl = false;
      cancelSharedLocalDrag();
    }

    const snapshotAtReturnPlace = sharedSnapshotAtReturnPlace(snapshot);
    setPhase(snapshot.phase);
    setTheme(sharedSnapshotTheme(snapshot));
    if (snapshot.phase === PHASES.INTRO) {
      hideReturnRain({ immediate: true });
    } else {
      syncReturnRain(snapshotAtReturnPlace);
    }

    if (snapshot.phase === PHASES.WON) {
      collab.hasControl = false;
      collab.pendingControl = false;
      cancelSharedLocalDrag();
      collab.snapshots = [snapshot];
      applySharedFrame(snapshot);
    } else if (collab.snapshots.length === 1 && !motion.dragging) {
      applySharedFrame(snapshot);
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
    if (!snapshot || (motion.dragging && (collab.hasControl || collab.pendingControl))) {
      return;
    }
    const local = canonicalToLocal(snapshot.x, snapshot.y);
    const velocity = canonicalVelocityToLocal(snapshot.vx, snapshot.vy);
    const position = applySharedReleaseHandoff(local, snapshot.phase);
    setPosition(position.x, position.y);
    motion.vx = velocity.vx;
    motion.vy = velocity.vy;
    motion.turbTime = 0;

    const visiblyDragging = Boolean(snapshot.dragging);
    const visiblyFalling =
      !visiblyDragging &&
      snapshot.phase !== PHASES.INTRO &&
      snapshot.phase !== PHASES.WON &&
      (snapshot.phase === PHASES.FALLING ||
        Math.abs(snapshot.vx) > 0.5 ||
        Math.abs(snapshot.vy) > 0.5);
    rock.classList.toggle("is-dragging", visiblyDragging);
    rock.classList.toggle("is-falling", visiblyFalling);
    syncReturnTheme(visiblyDragging);
  }

  function renderSharedFrame(now) {
    collab.renderId = window.requestAnimationFrame(renderSharedFrame);
    const deltaSeconds = clamp(
      (now - (collab.lastRenderAt || now)) / 1000,
      0,
      MAX_FRAME_SECONDS
    );
    collab.lastRenderAt = now;

    if (!motion.dragging && collab.snapshots.length > 0) {
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

    if (motion.phase === PHASES.FALLING || motion.phase === PHASES.PLAY) {
      recordTrailPoint(deltaSeconds);
    }
    drawTrail();
    renderRemotePointers();
  }

  function startSharedRenderLoop() {
    stopLoop();
    if (collab.renderId === null) {
      collab.lastRenderAt = performance.now();
      collab.renderId = window.requestAnimationFrame(renderSharedFrame);
    }
  }

  function cancelSharedLocalDrag(releaseCapture = true) {
    window.clearTimeout(collab.firstReleaseTimerId);
    collab.firstReleaseTimerId = null;
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
    if (
      motion.phase !== PHASES.INTRO &&
      motion.phase !== PHASES.PLAY
    ) {
      return;
    }
    if (
      collab.remoteControllerId &&
      collab.remoteControllerId !== collab.clientId
    ) {
      updateSessionStatus();
      return;
    }

    event.preventDefault();
    if (params.trailReset && motion.phase === PHASES.PLAY) {
      resetTrail();
    }
    clearSharedReleaseHandoff();
    collab.releasePending = false;
    toggleHandVariant();
    updateBounds();
    const position = localToCanonical(motion.x, motion.y);
    let proposedImprint = null;
    if (motion.phase === PHASES.INTRO && !collab.imprint) {
      proposedImprint = sharedImprintAt(position);
      collab.imprint = proposedImprint;
      renderImprint();
    }
    const rect = rock.getBoundingClientRect();
    motion.dragging = true;
    motion.activePointerId = event.pointerId;
    motion.grabX = event.clientX - rect.left;
    motion.grabY = event.clientY - rect.top;
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
      imprint: proposedImprint,
      pointer,
    });
    if (motion.phase === PHASES.INTRO) {
      collab.firstReleaseTimerId = window.setTimeout(() => {
        if (motion.dragging && collab.enabled) {
          forceReleaseSharedDrag(false);
        }
      }, FIRST_FALL_DELAY_MS);
    }
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
    applyDragTargetMovement(MAX_FRAME_SECONDS);
    syncReturnTheme();

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
    const velocity = localVelocityToCanonical(
      motion.pointerVx,
      motion.pointerVy
    );
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
    recordPointerVelocity(event);
    const pointerVelocity = currentPointerVelocity();
    const velocity = localVelocityToCanonical(
      pointerVelocity.vx,
      pointerVelocity.vy
    );
    const position = localToCanonical(motion.x, motion.y);
    const pointerVisible =
      event.type !== "pointercancel" && pointerIsOverRock(event);
    const pointer = updateLocalSharedPointer(event, "grab", pointerVisible);
    startSharedReleaseHandoff();
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
    setTheme("dark");
    hideReturnRain();
    if (!pointerVisible) {
      hideHandCursor();
    }
    updateSessionStatus();
  }

  function forceReleaseSharedDrag(hidePointer = false) {
    if (!motion.dragging) {
      return;
    }
    const pointerVelocity = currentPointerVelocity();
    const velocity = localVelocityToCanonical(
      pointerVelocity.vx,
      pointerVelocity.vy
    );
    const position = localToCanonical(motion.x, motion.y);
    const pointer = updateLocalSharedPointer(
      null,
      "grab",
      hidePointer ? false : collab.localPointer.visible
    );
    startSharedReleaseHandoff();
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
    setTheme("dark");
    hideReturnRain();
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
    }
  }

  function resizeTrailCanvas() {
    ensureTrailCanvasSize();
    drawTrail();
  }

  function resetTrail() {
    trail.points.length = 0;
    trail.lastX = null;
    trail.lastY = null;
    trail.followX = null;
    trail.followY = null;
    clearTrailCanvas();
  }

  function trimTrailToLimit() {
    if (params.trailUnlimited) {
      return;
    }
    const overflow = trail.points.length - params.trailMaxPoints;
    if (overflow > 0) {
      trail.points.splice(0, overflow);
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
    if (!params.trailEnabled) {
      return;
    }

    const rockX = motion.x + bounds.rockWidth / 2;
    const rockY = motion.y + bounds.rockHeight / 2;

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
      const threshold = params.trailSampleDist * params.trailSampleDist;
      if (dx * dx + dy * dy < threshold) {
        return;
      }
    }

    trail.points.push({ x, y });
    trail.lastX = x;
    trail.lastY = y;

    trimTrailToLimit();
  }

  function trailDashArray() {
    if (params.dashStyle === "dashed") {
      return [params.dashLength, params.dashGap];
    }
    if (params.dashStyle === "dotted") {
      return [1, Math.max(params.dashGap, 2)];
    }
    return [];
  }

  function drawTrail() {
    ensureTrailCanvasSize();
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
    trailCtx.globalAlpha = params.lineOpacity;
    trailCtx.lineCap = params.lineCap;
    trailCtx.lineJoin = params.lineJoin;
    trailCtx.lineWidth = params.lineWidth;

    if (params.glow > 0) {
      trailCtx.shadowBlur = params.glow;
      trailCtx.shadowColor = params.glowColor;
    }

    if (points.length < 2) {
      // Одна точка — рисуем кружок, чтобы след был виден.
      trailCtx.fillStyle = params.lineColor;
      trailCtx.beginPath();
      trailCtx.arc(
        points[0].x,
        points[0].y,
        Math.max(0.5, params.lineWidth / 2),
        0,
        Math.PI * 2
      );
      trailCtx.fill();
      trailCtx.restore();
      return;
    }

    // Линия строится кривыми Безье через середины отрезков — плавная кривая.
    trailCtx.setLineDash(trailDashArray());
    trailCtx.beginPath();
    trailCtx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const midX = (points[i].x + points[i + 1].x) / 2;
      const midY = (points[i].y + points[i + 1].y) / 2;
      trailCtx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
    }
    const last = points[points.length - 1];
    trailCtx.lineTo(last.x, last.y);

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

    trailCtx.stroke();
    trailCtx.setLineDash([]);
    trailCtx.restore();
  }

  function showHint(target) {
    const text = target.getAttribute("data-hint");
    if (!text) {
      return;
    }

    hintEl.textContent = text;
    hintEl.classList.add("is-visible");

    const panelRect = settingsPanel.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const hintRect = hintEl.getBoundingClientRect();
    const top = clamp(targetRect.top, 8, window.innerHeight - hintRect.height - 8);
    const right = window.innerWidth - panelRect.left + 10;

    hintEl.style.left = "auto";
    hintEl.style.right = `${right}px`;
    hintEl.style.top = `${top}px`;
  }

  function hideHint() {
    hintEl.classList.remove("is-visible");
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

  function clearFirstFallTimer() {
    if (motion.firstFallTimerId === null) {
      return;
    }

    window.clearTimeout(motion.firstFallTimerId);
    motion.firstFallTimerId = null;
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

  function syncReturnTheme(isDragging = motion.dragging) {
    if (motion.phase === PHASES.INTRO || motion.phase === PHASES.WON) {
      setTheme("light");
      hideReturnRain({ immediate: motion.phase === PHASES.INTRO });
      return;
    }
    const atReturnPlace = isAtReturnPlace(isDragging);
    setTheme(atReturnPlace ? "light" : "dark");
    syncReturnRain(atReturnPlace);
  }

  function enterPlayPhase() {
    setPhase(PHASES.PLAY);
    setTheme("dark");
    hideReturnRain();
    motion.vx = 0;
    motion.vy = 0;
    setPosition(motion.x, bounds.maxY);
    rock.classList.remove("is-falling");
  }

  function beginFirstFall() {
    motion.firstFallTimerId = null;
    if (motion.phase !== PHASES.INTRO) {
      return;
    }

    const pointerId = motion.activePointerId;
    motion.dragging = false;
    motion.activePointerId = null;
    rock.classList.remove("is-dragging");
    setGrabbingCursor(false);
    releasePointerCapture(pointerId);

    const state = SharedPhysics.sanitizeState(currentSharedState());
    const pointerVelocity = currentPointerVelocity();
    const velocity = localVelocityToCanonical(
      pointerVelocity.vx,
      pointerVelocity.vy
    );
    SharedPhysics.beginFirstFall(
      state,
      SharedPhysics.sanitizePhysics(params),
      velocity.vx,
      velocity.vy
    );
    setPhase(state.phase);
    // Тёмная тема включается сразу, как только камень выпадает из руки,
    // не дожидаясь касания дна.
    setTheme("dark");
    hideReturnRain();
    applyCanonicalMotion(state);
    setHandToGrab();
    rock.classList.add("is-falling");
    startLoop();
  }

  function startFirstFall() {
    if (motion.phase !== PHASES.INTRO || motion.firstFallTimerId !== null) {
      return false;
    }

    motion.firstFallTimerId = window.setTimeout(beginFirstFall, FIRST_FALL_DELAY_MS);
    return true;
  }

  function applyPhysics(deltaSeconds) {
    if (motion.dragging || motion.phase === PHASES.WON) {
      return;
    }

    const state = SharedPhysics.sanitizeState(currentSharedState());
    const previousPhase = state.phase;
    state.turbTime = motion.turbTime;
    SharedPhysics.stepState(state, SharedPhysics.sanitizePhysics(params), deltaSeconds);
    applyCanonicalMotion(state);
    if (previousPhase === PHASES.FALLING && state.phase === PHASES.PLAY) {
      enterPlayPhase();
    } else {
      syncReturnTheme(false);
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
      recordTrailPoint(deltaSeconds);
    }

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

  function applyReleaseImpulse() {
    const state = SharedPhysics.sanitizeState(currentSharedState());
    const pointerVelocity = currentPointerVelocity();
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
    clearFirstFallTimer();
    motion.dragging = false;
    motion.activePointerId = null;
    motion.holdTimerId = null;
    rock.classList.remove("is-dragging");
    setGrabbingCursor(false);
    releasePointerCapture(pointerId);

    if (phaseAtRelease === PHASES.INTRO) {
      beginFirstFall();
      return;
    }

    if (releasedInImprint) {
      motion.vx = 0;
      motion.vy = 0;
    } else {
      applyReleaseImpulse();
    }
    setTheme("dark");
    hideReturnRain();
    setHandToGrab();
    rock.classList.add("is-falling");
    startLoop();
  }

  function startDrag(event) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    if (collab.enabled) {
      beginSharedDrag(event);
      return;
    }

    if (motion.phase === PHASES.INTRO) {
      event.preventDefault();
      if (motion.dragging || motion.firstFallTimerId !== null) {
        return;
      }

      toggleHandVariant();
      updateBounds();
      createLocalImprint();
      syncScrollLock(true);
      const rect = rock.getBoundingClientRect();
      motion.dragging = true;
      motion.activePointerId = event.pointerId;
      motion.grabX = event.clientX - rect.left;
      motion.grabY = event.clientY - rect.top;
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
      startFirstFall();
      return;
    }

    if (motion.phase !== PHASES.PLAY) {
      return;
    }

    event.preventDefault();
    if (params.trailReset) {
      resetTrail();
    }
    toggleHandVariant();
    updateBounds();
    const rect = rock.getBoundingClientRect();
    motion.dragging = true;
    motion.activePointerId = event.pointerId;
    motion.grabX = event.clientX - rect.left;
    motion.grabY = event.clientY - rect.top;
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

    if (
      !motion.dragging ||
      (motion.phase !== PHASES.INTRO && motion.phase !== PHASES.PLAY)
    ) {
      return;
    }

    event.preventDefault();
    recordPointerVelocity(event);
    setDragTargetFromPointer(event);

    if (motion.phase === PHASES.INTRO) {
      applyDragTargetMovement(MAX_FRAME_SECONDS);
    }
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
    clearFirstFallTimer();
    motion.dragging = false;
    motion.activePointerId = null;
    rock.classList.remove("is-dragging");
    setGrabbingCursor(false);
    releasePointerCapture(event.pointerId);
    recordPointerVelocity(event);

    if (phaseAtRelease === PHASES.INTRO) {
      beginFirstFall();
      return;
    }

    if (releasedInImprint) {
      motion.vx = 0;
      motion.vy = 0;
    } else {
      applyReleaseImpulse();
    }
    setTheme("dark");
    hideReturnRain();
    setHandToGrab();
    rock.classList.add("is-falling");
    startLoop();
  }

  function enterRock(event) {
    if (motion.phase === PHASES.WON) {
      return;
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
    clearFirstFallTimer();
    motion.dragging = false;
    motion.activePointerId = null;
    rock.classList.remove("is-dragging");
    setHandToGrab();
    hideHandCursor();
    syncReturnTheme(false);
    if (collab.enabled) {
      sendSharedPointer(null, "grab", false, true);
    }
  }

  settingsPanel.querySelectorAll("input, select").forEach((el) => {
    const handleControlChange = () =>
      readControls({ changedKey: el.name });
    listen(el, "input", handleControlChange);
    listen(el, "change", handleControlChange);
  });

  listen(settingsPanel.querySelector(".trail-clear"), "click", resetTrail);
  listen(sessionRestartButton, "click", restartExperience);

  listen(settingsPanel, "pointerover", (event) => {
    const target = event.target.closest("[data-hint]");
    if (target) {
      showHint(target);
    }
  });
  listen(settingsPanel, "pointerout", (event) => {
    const target = event.target.closest("[data-hint]");
    const next =
      event.relatedTarget && event.relatedTarget.closest
        ? event.relatedTarget.closest("[data-hint]")
        : null;
    if (target && next !== target) {
      hideHint();
    }
  });
  listen(settingsPanel, "focusin", (event) => {
    const target = event.target.closest("[data-hint]");
    if (target) {
      showHint(target);
    }
  });
  listen(settingsPanel, "focusout", hideHint);

  // Открытием панели управляет React-хук useSettings.
  listen(sessionShareToggle, "click", copyCurrentSessionLink);
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
      if (document.documentElement.classList.contains("is-scroll-locked")) {
        window.scrollTo(0, 0);
        return;
      }
      drawTrail();
    },
    { passive: true }
  );
  listen(window, "resize", () => {
    updateBounds();
    resizeTrailCanvas();
    if (collab.enabled && collab.snapshots.length > 0) {
      applySharedFrame(collab.snapshots.at(-1));
    } else if (motion.phase === PHASES.INTRO) {
      centerIntroRock();
    } else {
      setPosition(motion.x, motion.y);
    }
    renderImprint();
  });

  function initScene() {
    centerIntroRock();
    resizeTrailCanvas();
    updateSessionStatus();
    if (collab.enabled) {
      connectSharedSession();
    } else {
      createSharedSession();
    }
  }

  const testApi = {
    SharedPhysics,
    bounds,
    canonicalToLocal,
    collab,
    initialSharedState,
    motion,
    params,
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

  loadSettings();
  readControls();
  window.scrollTo(0, 0);

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
      stopRainRenderers();
      clearHoldTimer();
      clearFirstFallTimer();
      clearSharedConnectionTimers();
      clearSharedReleaseHandoff();
      window.clearTimeout(collab.copyFeedbackTimerId);
      window.clearTimeout(collab.statusResetTimerId);
      window.clearTimeout(collab.physicsTimerId);
      window.clearTimeout(collab.firstReleaseTimerId);
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
      if (window.__sisyphusTestApi === testApi) {
        Reflect.deleteProperty(window, "__sisyphusTestApi");
      }
      Object.entries(testApi).forEach(([name, value]) => {
        if (window[name] === value) {
          Reflect.deleteProperty(window, name);
        }
      });
      if (rain.hideTimerId !== null) {
        window.clearTimeout(rain.hideTimerId);
        rain.hideTimerId = null;
      }
    },
  };
}
