import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalToLocalPosition,
  localToCanonicalPosition,
  rockRelativeToViewportPosition,
  viewportToRockRelativePosition,
} from "../../src/lib/coordinates.mjs";
import { createClientId } from "../../src/lib/clientId.mjs";
import {
  cameraFollowDirectionalScrollY,
  cameraFollowScrollY,
  cameraFollowScrollUpY,
  cameraTargetScrollY,
} from "../../src/lib/cameraFollow.mjs";
import {
  drizzleVolumeForY,
  physicalHeightProgress,
} from "../../src/lib/drizzleVolume.mjs";
import { getRainVisualProfile } from "../../src/lib/rainProfile.mjs";
import { rainScrollProfile } from "../../src/lib/rainScrollProfile.mjs";
import {
  buildFoldBlendMask,
  calculateFoldDocumentLayout,
  foldEffectEnabled,
  normalizeFoldSettings,
} from "../../src/lib/fold.mjs";
import {
  DEFAULT_GLOW_OPTIMIZATION_SETTINGS,
  resolveGlowOptimizationProfile,
  sampleGlowPoints,
  sanitizeGlowOptimizationSettings,
} from "../../src/lib/glowOptimization.mjs";
import {
  DEFAULT_ROCK_MAX_WIDTH_VW,
  DEFAULT_ROCK_MIN_WIDTH_VW,
  DEFAULT_ROCK_SCALE_EASING,
  parseCubicBezier,
  rockActivationScaleFactor,
  rockHorizontalWallCompensation,
  rockLocalXForVisualGrab,
  rockPressScaleFactor,
  rockScaleForY,
  rockSceneTwoGrabScaleFactor,
  rockWallPenetrationPixels,
} from "../../src/lib/rockScale.mjs";
import {
  calculatePreclickHopTarget,
  preclickDirectionalViewportSpan,
  preclickHopDistance,
  preclickHopDurationMs,
  preclickHopPathIsSafe,
  preclickPointerSpeed,
  preclickRadiusHopDecision,
  preclickToroidalDistance,
  wrapPreclickHopCenter,
} from "../../src/lib/preclickHop.mjs";
import { cursorCircleIntersectsRect } from "../../src/lib/rockGrab.mjs";
import {
  rockPulseProgress,
  rockPulseScaleFactor,
} from "../../src/lib/rockPulse.mjs";
import { trailAnchorPoint } from "../../src/lib/trailAnchor.mjs";
import {
  canonicalVisualTrailPointToLocal,
  localVisualTrailPointToCanonical,
  normalizeStoredTrailPoint,
  VISUAL_TRAIL_POINT_VERSION,
} from "../../src/lib/trailPersistence.mjs";
import {
  HARD_TRAIL_LIMIT,
  calculateTrailHistoryWindow,
  detectTrailRenderProfile,
  effectiveCanvasPixelRatio,
  resolveTrailRenderProfile,
  sampleTrailPoints,
  sampleTrailRuns,
} from "../../src/lib/trailOptimization.mjs";
import { shouldStartRainExit } from "../../src/lib/rainState.mjs";
import { deriveSessionStatus } from "../../src/lib/sessionStatus.mjs";
import { formatSummitElapsedMs } from "../../src/lib/summitTimer.mjs";
import {
  formatSettingsVersionOptionLabel,
  formatSettingsVersionSavedAt,
} from "../../src/lib/settingsVersions.mjs";
import {
  selectLatestSettingsVersionEntry,
  settingsFromLatestVersionEntry,
} from "../../src/lib/settingsVersionSelection.mjs";
import {
  parseSettingDependencyAttribute,
  serializeSettingDependency,
  settingDependencyMatches,
} from "../../src/lib/settingsDependencies.mjs";
import {
  normalizeRainSettings,
  normalizeRockScaleSettings,
  normalizeThemeMode,
} from "../../src/lib/settingsModel.mjs";
import {
  presetName as productionPresetName,
  settings as productionSettings,
  settingsSchemaVersion as productionSettingsSchemaVersion,
} from "../../src/config/production-preset.mjs";
import {
  resolveProductionPresetMessage,
} from "../../src/lib/productionPresetMessages.mjs";
import {
  LEGACY_SETTINGS_STORAGE_KEYS,
  SETTINGS_GROUPS,
  SETTINGS_SCENES,
  SETTINGS_SCENE_OPTIONS,
  SETTINGS_STORAGE_KEY,
  SETTINGS_VERSIONS_STORAGE_KEY,
  settingsControlScenes,
  settingsControlVisibleInScene,
  settingsGroupVisibleInScene,
  settingsGroupControls,
} from "../../src/config/settings.mjs";
import {
  createSettingsController as createProductionSettingsController,
} from "../../src/runtime/createSettingsController.prod.js";

const SharedRoomSettings = globalThis.SisyphusRoomSettings;
const LEGACY_PRECLICK_PARALLAX_SETTING_KEYS = Object.freeze([
  "preclickParallaxActivationRadiusVw",
  "preclickParallaxActivationRadiusPx",
  "preclickParallaxMaxOffsetPx",
  "preclickParallaxMaxOffsetVw",
  "preclickParallaxEndMaxOffsetVw",
  "preclickParallaxMaxOffsetEasing",
  "preclickParallaxStartDelayMs",
  "preclickParallaxEndDelayMs",
  "preclickParallaxDelayEasing",
  "preclickParallaxTransitionDurationSeconds",
  "preclickParallaxInverted",
  "preclickParallaxReturnDurationMs",
  "preclickParallaxReturnEasing",
]);
const DEFAULT_PRECLICK_HOP_SETTINGS = Object.freeze({
  preclickHopGuardClickCount:
    SharedRoomSettings.DEFAULT_ROOM_SETTINGS.preclickHopGuardClickCount,
  preclickPopupDelayMs:
    SharedRoomSettings.DEFAULT_ROOM_SETTINGS.preclickPopupDelayMs,
  preclickHopActivationRadiusPercent:
    SharedRoomSettings.DEFAULT_ROOM_SETTINGS.preclickHopActivationRadiusPercent,
  preclickHopMaxDistancePercent:
    SharedRoomSettings.DEFAULT_ROOM_SETTINGS.preclickHopMaxDistancePercent,
  preclickHopMissProbabilityPercent:
    SharedRoomSettings.DEFAULT_ROOM_SETTINGS.preclickHopMissProbabilityPercent,
  preclickHopSpeedPxPerSecond:
    SharedRoomSettings.DEFAULT_ROOM_SETTINGS.preclickHopSpeedPxPerSecond,
  preclickHopSpeedEasing:
    SharedRoomSettings.DEFAULT_ROOM_SETTINGS.preclickHopSpeedEasing,
});
const DEFAULT_CUSTOM_CURSOR_SETTINGS = Object.freeze({
  customCursorEnabled:
    SharedRoomSettings.DEFAULT_ROOM_SETTINGS.customCursorEnabled,
  customCursorSizePx:
    SharedRoomSettings.DEFAULT_ROOM_SETTINGS.customCursorSizePx,
});
const DEFAULT_ROCK_VISUAL_MIGRATION = Object.freeze({
  rockImageId: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rockImageId,
  foldRockImageId: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.foldRockImageId,
  rockPulseShrinkPercent:
    SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rockPulseShrinkPercent,
});

test("production settings controller сохраняет контракт пустой загрузки", () => {
  const controller = createProductionSettingsController();
  assert.equal(controller.enabled, false);
  assert.deepEqual(controller.load(), []);
});

test("визуальная точка следа сохраняет позицию после canonical round-trip", () => {
  const geometry = {
    viewportWidth: 1280,
    sceneHeight: 72_000,
    worldWidth: 1000,
    worldHeight: 2000,
  };
  const source = { x: 837.25, y: 45_678.75 };
  const canonical = localVisualTrailPointToCanonical(source, geometry);
  const restored = canonicalVisualTrailPointToLocal(canonical, geometry);

  assert.equal(canonical[2], VISUAL_TRAIL_POINT_VERSION);
  assert.ok(Math.abs(restored.x - source.x) < 1);
  assert.ok(Math.abs(restored.y - source.y) < 1);
});

test("нормализация различает legacy и визуальные точки следа", () => {
  const geometry = { worldWidth: 1000, worldHeight: 2000 };

  assert.deepEqual(normalizeStoredTrailPoint([100.4, 300.6], geometry), [
    100.4,
    300.6,
  ]);
  assert.deepEqual(
    normalizeStoredTrailPoint([-5, 2500, VISUAL_TRAIL_POINT_VERSION], geometry),
    [0, 2000, VISUAL_TRAIL_POINT_VERSION],
  );
});

test("client ID использует randomUUID в secure context", () => {
  const expected = "12345678-1234-4234-8234-123456789abc";
  let getRandomValuesCalled = false;
  const clientId = createClientId({
    randomUUID: () => expected,
    getRandomValues: () => {
      getRandomValuesCalled = true;
    },
  });

  assert.equal(clientId, expected);
  assert.equal(getRandomValuesCalled, false);
});

test("client ID работает без randomUUID на HTTP", () => {
  const clientId = createClientId({
    getRandomValues: (bytes) => {
      bytes.set(Array.from({ length: 16 }, (_, index) => index));
      return bytes;
    },
  });

  assert.equal(clientId, "00010203-0405-4607-8809-0a0b0c0d0e0f");
});

test("client ID имеет допустимый fallback без Web Crypto", () => {
  assert.match(createClientId(null), /^[A-Za-z0-9_-]{16,64}$/);
});

test("координаты сохраняют каноническое положение между viewport", () => {
  const world = { width: 1000, height: 2000 };
  const firstBounds = { maxX: 500, maxY: 1200 };
  const secondBounds = { maxX: 900, maxY: 2400 };
  const canonical = localToCanonicalPosition(
    250,
    600,
    firstBounds,
    world.width,
    world.height,
  );
  const local = canonicalToLocalPosition(
    canonical.x,
    canonical.y,
    secondBounds,
    world.width,
    world.height,
  );

  assert.deepEqual(canonical, { x: 500, y: 1000 });
  assert.deepEqual(local, { x: 450, y: 1200 });
});

test("курсор сохраняет положение относительно камня между viewport", () => {
  const sourceRock = { left: 1075, top: 450, width: 100, height: 100 };
  const sourceCursor = { x: 930, y: 340 };
  const relative = viewportToRockRelativePosition(
    sourceCursor.x,
    sourceCursor.y,
    sourceRock,
    1905,
    899,
  );
  const targetRock = { left: 890, top: 636, width: 100, height: 100 };
  const targetCursor = rockRelativeToViewportPosition(
    relative.x,
    relative.y,
    targetRock,
    1580,
    745,
  );
  const targetRelative = viewportToRockRelativePosition(
    targetCursor.x,
    targetCursor.y,
    targetRock,
    1580,
    745,
  );

  assert.ok(Math.abs(relative.x - -195 / 1905) < 1e-12);
  assert.ok(Math.abs(relative.y - -160 / 899) < 1e-12);
  assert.ok(Math.abs(targetRelative.x - relative.x) < 1e-12);
  assert.ok(Math.abs(targetRelative.y - relative.y) < 1e-12);
});

test("настройка темы содержит автоматический и ручные режимы", () => {
  const viewGroup = SETTINGS_GROUPS.find((group) => group.title === "Вид");
  const themeMode = viewGroup.controls.find(
    (control) => control.name === "themeMode"
  );

  assert.equal(normalizeThemeMode("dark"), "dark");
  assert.equal(normalizeThemeMode("light"), "light");
  assert.equal(normalizeThemeMode("invalid"), "auto");
  assert.equal(themeMode.type, "select");
  assert.equal(themeMode.label, "Тема");
  assert.equal(themeMode.defaultValue, "auto");
  assert.deepEqual(themeMode.options, [
    ["auto", "Авто"],
    ["dark", "Тёмная"],
    ["light", "Светлая"],
  ]);
  assert.equal(
    viewGroup.controls.some(
      (control) =>
        control.name === "returnScrollDurationSeconds" ||
        control.name === "returnScrollEasing",
    ),
    false,
  );
  assert.deepEqual(
    SharedRoomSettings.sanitizeRoomSettings({
      returnScrollDurationSeconds: 15,
      returnScrollEasing: "not-a-curve",
    }),
    {
      ...SharedRoomSettings.DEFAULT_ROOM_SETTINGS,
      returnScrollDurationSeconds: 10,
    },
  );
});

test("session status сохраняет публичные тексты управления", () => {
  assert.deepEqual(
    deriveSessionStatus({
      enabled: true,
      connected: true,
      participants: 2,
      hasControl: false,
      pendingControl: false,
      remoteControllerId: "other",
      holderId: "other",
      liftReady: false,
    }),
    {
      text: "В сессии: 2 · камень удерживается",
      state: "online",
    },
  );
});

test("настройки дождя ограничиваются и используют безопасные fallback", () => {
  const defaults = {
    rainEnterEasing: "ease-in",
    rainExitEasing: "ease-out",
    rainEnterMs: 1100,
    rainExitMs: 2000,
    rainMaxVolume: 0.5,
    rainZIndex: 5,
    rainBlendMode: "multiply",
    rainBlurBlendMode: "normal",
    rainBackgroundBlurSteps: 3,
    rainBlurPx: 14,
    rainBlurOpacity: 0.2,
    rainBlurSaturation: 1.1,
  };
  const settings = normalizeRainSettings(
    {
      rainStrength: 8,
      rainMaxVolume: 8,
      rainBlendMode: "invalid",
      rainBlurBlendMode: "also-invalid",
      rainBackgroundBlurSteps: 100,
      rainBlurPx: -10,
      rainBlurOpacity: 4,
      rainBlurSaturation: -1,
      rainZIndex: 100,
      rainEnterEasing: "invalid",
      rainExitEasing: " linear ",
      rainEnterMs: -10,
      rainExitMs: 100000,
      rainAudioEnterMs: -25,
      rainAudioExitMs: 100000,
    },
    {
      defaults,
      isTimingFunctionSupported: (value) => value === "linear",
    },
  );

  assert.deepEqual(settings, {
    rainStrength: 1.5,
    rainMaxVolume: 3,
    rainBlendMode: "multiply",
    rainBlurBlendMode: "normal",
    rainBackgroundBlurSteps: 8,
    rainBlurPx: 0,
    rainBlurOpacity: 1,
    rainBlurSaturation: 0,
    rainZIndex: 30,
    rainEnterEasing: "ease-in",
    rainExitEasing: "linear",
    rainEnterMs: 0,
    rainExitMs: 20000,
  });
});

test("mix blend дождя и blur нормализуются независимо", () => {
  const settings = normalizeRainSettings(
    {
      rainBlendMode: "screen",
      rainBlurBlendMode: "overlay",
    },
    {
      defaults: {
        rainBlendMode: "multiply",
        rainBlurBlendMode: "normal",
        rainEnterEasing: "ease-in",
        rainExitEasing: "ease-out",
        rainEnterMs: 1100,
        rainExitMs: 2000,
        rainMaxVolume: 0.5,
        rainZIndex: 5,
      },
    },
  );

  assert.equal(settings.rainBlendMode, "screen");
  assert.equal(settings.rainBlurBlendMode, "overlay");
});

test("повторный hide не перезапускает таймер исчезновения дождя", () => {
  assert.equal(
    shouldStartRainExit({
      isActive: true,
      isHiding: false,
      isVisible: true,
    }),
    true,
  );
  assert.equal(
    shouldStartRainExit({
      isActive: true,
      isHiding: true,
      isVisible: false,
    }),
    false,
  );
});

test("scroll-профиль дождя имеет плато 5 viewport вокруг середины пути", () => {
  const options = { scrollHeight: 11_000, viewportHeight: 1_000 };
  const start = rainScrollProfile({ ...options, scrollY: 0 });
  const plateauStart = rainScrollProfile({ ...options, scrollY: 2_500 });
  const middle = rainScrollProfile({ ...options, scrollY: 5_000 });
  const plateauEnd = rainScrollProfile({ ...options, scrollY: 7_500 });
  const bottom = rainScrollProfile({ ...options, scrollY: 10_000 });

  assert.equal(start.opacity, 0);
  assert.equal(start.audio, 0);
  assert.equal(plateauStart.risingEnd, 0.25);
  assert.equal(plateauStart.fallingStart, 0.75);
  assert.equal(plateauStart.hill, 1);
  assert.equal(middle.hill, 1);
  assert.equal(plateauEnd.hill, 1);
  assert.equal(bottom.opacity, 0);
  assert.equal(bottom.audio, 0);
  assert.equal(bottom.atBottom, true);
});

test("настройки инерции и hop отображают актуальные шкалы", () => {
  const controls = SETTINGS_GROUPS.flatMap(settingsGroupControls);
  const inertia = controls.find(
    (control) => control.name === "inertia"
  );
  const horizontalInertia = controls.find(
    (control) => control.name === "horizontalInertia"
  );
  const preclickHopMaxDistance = controls.find(
    (control) => control.name === "preclickHopMaxDistancePercent"
  );
  const preclickHopActivationRadius = controls.find(
    (control) => control.name === "preclickHopActivationRadiusPercent"
  );
  const preclickHopGuardClickCount = controls.find(
    (control) => control.name === "preclickHopGuardClickCount"
  );
  const preclickPopupDelay = controls.find(
    (control) => control.name === "preclickPopupDelayMs"
  );
  const preclickPopupSize = controls.find(
    (control) => control.name === "preclickPopupSizeMultiplier"
  );
  const birchBackgroundEnabled = controls.find(
    (control) => control.name === "birchBackgroundEnabled"
  );
  const birchScale = controls.find(
    (control) => control.name === "birchScalePercent"
  );
  const rockWallPenetration = controls.find(
    (control) => control.name === "rockWallPenetrationPercent"
  );
  const cameraFollowDown = controls.find(
    (control) => control.name === "cameraFollowDownEnabled",
  );
  const upperZoneAutoScroll = controls.find(
    (control) => control.name === "upperZoneAutoScrollEnabled",
  );
  const sceneTwoOverflowY = controls.find(
    (control) => control.name === "sceneTwoOverflowYVisible",
  );
  const gachiClickSound = controls.find(
    (control) => control.name === "gachiClickSoundFilename",
  );

  assert.equal(SETTINGS_STORAGE_KEY, "sisyphus-czar-settings-v48");
  assert.equal(LEGACY_SETTINGS_STORAGE_KEYS[0], "sisyphus-czar-settings-v47");
  assert.equal(
    SETTINGS_VERSIONS_STORAGE_KEY,
    "sisyphus-czar-settings-versions-v1"
  );
  assert.deepEqual(
    {
      type: cameraFollowDown.type,
      defaultChecked: cameraFollowDown.defaultChecked,
      activeLabel: cameraFollowDown.activeLabel,
      inactiveLabel: cameraFollowDown.inactiveLabel,
    },
    {
      type: "toggle-button",
      defaultChecked: true,
      activeLabel: "Следовать",
      inactiveLabel: "Не следовать",
    },
  );
  assert.deepEqual(
    {
      type: sceneTwoOverflowY.type,
      defaultChecked: sceneTwoOverflowY.defaultChecked,
      activeLabel: sceneTwoOverflowY.activeLabel,
      inactiveLabel: sceneTwoOverflowY.inactiveLabel,
    },
    {
      type: "toggle-button",
      defaultChecked: false,
      activeLabel: "Показать",
      inactiveLabel: "Скрыть",
    },
  );
  assert.deepEqual(
    {
      type: upperZoneAutoScroll.type,
      defaultChecked: upperZoneAutoScroll.defaultChecked,
      activeLabel: upperZoneAutoScroll.activeLabel,
      inactiveLabel: upperZoneAutoScroll.inactiveLabel,
    },
    {
      type: "toggle-button",
      defaultChecked: true,
      activeLabel: "Включён",
      inactiveLabel: "Выключен",
    },
  );
  assert.equal(gachiClickSound.type, "select");
  assert.equal(gachiClickSound.defaultValue, "Camen.mp3");
  assert.deepEqual(
    gachiClickSound.options.map(([filename]) => filename),
    [...SharedRoomSettings.GACHI_SOUND_FILENAMES],
  );
  assert.deepEqual(
    {
      min: preclickHopActivationRadius.min,
      max: preclickHopActivationRadius.max,
      step: preclickHopActivationRadius.step,
      defaultValue: preclickHopActivationRadius.defaultValue,
    },
    { min: 0, max: 300, step: 1, defaultValue: 50 }
  );
  assert.deepEqual(
    {
      min: preclickHopGuardClickCount.min,
      max: preclickHopGuardClickCount.max,
      step: preclickHopGuardClickCount.step,
      defaultValue: preclickHopGuardClickCount.defaultValue,
    },
    { min: 0, max: 10, step: 1, defaultValue: 1 }
  );
  assert.equal(
    preclickHopGuardClickCount.label,
    "Количество фейковых кликов"
  );
  assert.deepEqual(
    {
      label: preclickPopupDelay.label,
      min: preclickPopupDelay.min,
      max: preclickPopupDelay.max,
      step: preclickPopupDelay.step,
      defaultValue: preclickPopupDelay.defaultValue,
    },
    {
      label: "Задержка всплывающего окна, мс",
      min: 0,
      max: 1000,
      step: 1,
      defaultValue: 200,
    }
  );
  assert.deepEqual(
    {
      label: preclickPopupSize.label,
      min: preclickPopupSize.min,
      max: preclickPopupSize.max,
      step: preclickPopupSize.step,
      defaultValue: preclickPopupSize.defaultValue,
    },
    {
      label: "Размер окон с картинами",
      min: 1,
      max: 4,
      step: 1,
      defaultValue: 2,
    },
  );
  assert.deepEqual(
    {
      label: birchBackgroundEnabled.label,
      type: birchBackgroundEnabled.type,
      defaultChecked: birchBackgroundEnabled.defaultChecked,
    },
    {
      label: "Показывать фон с берёзами",
      type: "checkbox",
      defaultChecked: false,
    },
  );
  assert.deepEqual(
    {
      label: birchScale.label,
      min: birchScale.min,
      max: birchScale.max,
      step: birchScale.step,
      defaultValue: birchScale.defaultValue,
      enabledWhen: birchScale.enabledWhen,
    },
    {
      label: "Размер берёз, %",
      min: 100,
      max: 400,
      step: 10,
      defaultValue: 100,
      enabledWhen: "birchBackgroundEnabled",
    },
  );
  assert.deepEqual(
    {
      min: rockWallPenetration.min,
      max: rockWallPenetration.max,
      step: rockWallPenetration.step,
      defaultValue: rockWallPenetration.defaultValue,
    },
    { min: 0, max: 50, step: 1, defaultValue: 20 }
  );
  assert.deepEqual(
    {
      min: inertia.min,
      max: inertia.max,
      step: inertia.step,
      defaultValue: inertia.defaultValue,
    },
    { min: 0, max: 5, step: 0.01, defaultValue: 0.9 }
  );
  assert.deepEqual(
    {
      min: horizontalInertia.min,
      max: horizontalInertia.max,
      step: horizontalInertia.step,
      defaultValue: horizontalInertia.defaultValue,
    },
    { min: 0, max: 5, step: 0.01, defaultValue: 0.02 }
  );
  assert.deepEqual(
    {
      label: preclickHopMaxDistance.label,
      min: preclickHopMaxDistance.min,
      max: preclickHopMaxDistance.max,
      step: preclickHopMaxDistance.step,
      defaultValue: preclickHopMaxDistance.defaultValue,
    },
    {
      label: "Максимальный отскок, %",
      min: 0,
      max: 150,
      step: 0.1,
      defaultValue: 62.5,
    },
  );
});

test("UI классифицирует параметры по сценам без копирования значений", () => {
  const controls = SETTINGS_GROUPS.flatMap(settingsGroupControls);
  const physicsGroup = SETTINGS_GROUPS.find(
    (group) => group.title === "Физика"
  );
  const rockGroup = SETTINGS_GROUPS.find((group) => group.title === "Камень");
  const obstacleGroup = SETTINGS_GROUPS.find(
    (group) => group.title === "Препятствия"
  );
  const trailGroup = SETTINGS_GROUPS.find(
    (group) => group.title === "Траектория"
  );

  assert.deepEqual(SETTINGS_SCENE_OPTIONS, [
    {
      id: SETTINGS_SCENES.CATS_AND_MICE,
      label: "Сцена 1. Кошки-мышки",
    },
    { id: SETTINGS_SCENES.TURNIP, label: "Сцена 2. Репка" },
  ]);
  assert.deepEqual(
    controls
      .filter((control) => {
        const scenes = settingsControlScenes(control);
        return (
          scenes.length === 1 &&
          scenes.includes(SETTINGS_SCENES.CATS_AND_MICE)
        );
      })
      .map((control) => control.name),
    [
      "preclickHopGuardClickCount",
      "preclickPopupDelayMs",
      "preclickPopupSizeMultiplier",
      "birchBackgroundEnabled",
      "birchScalePercent",
      "preclickHopActivationRadiusPercent",
      "preclickHopMaxDistancePercent",
      "preclickHopMissProbabilityPercent",
      "preclickHopSpeedPxPerSecond",
      "preclickHopSpeedEasing",
    ]
  );
  assert.deepEqual(settingsControlScenes("rockMinWidthVw"), [
    SETTINGS_SCENES.TURNIP,
  ]);
  assert.deepEqual(settingsControlScenes("rockActivatedWidthVw"), [
    SETTINGS_SCENES.TURNIP,
  ]);
  assert.deepEqual(settingsControlScenes("rockMaxWidthVw"), [
    SETTINGS_SCENES.TURNIP,
  ]);
  [
    "cameraFollowDownEnabled",
    "upperZoneAutoScrollEnabled",
    "sceneTwoOverflowYVisible",
    "gachiClickSoundFilename",
  ].forEach((name) => {
    assert.deepEqual(settingsControlScenes(name), [SETTINGS_SCENES.TURNIP]);
  });
  assert.deepEqual(
    rockGroup.controls
      .filter((control) =>
        ["rockMinWidthVw", "rockActivatedWidthVw", "rockMaxWidthVw"].includes(
          control.name,
        ),
      )
      .map((control) => control.name),
    ["rockMinWidthVw", "rockActivatedWidthVw", "rockMaxWidthVw"],
  );
  ["themeMode", "rockImageId", "handVisibilityMode"].forEach((name) => {
    const control = controls.find((candidate) => candidate.name === name);
    assert.deepEqual(settingsControlScenes(control), [
      SETTINGS_SCENES.CATS_AND_MICE,
      SETTINGS_SCENES.TURNIP,
    ]);
  });
  settingsGroupControls(trailGroup).forEach((control) => {
    assert.deepEqual(settingsControlScenes(control), [
      SETTINGS_SCENES.CATS_AND_MICE,
      SETTINGS_SCENES.TURNIP,
    ]);
  });
  assert.equal(
    settingsControlVisibleInScene("gravity", SETTINGS_SCENES.CATS_AND_MICE),
    false
  );
  assert.equal(
    settingsControlVisibleInScene("gravity", SETTINGS_SCENES.TURNIP),
    true
  );
  assert.equal(
    settingsGroupVisibleInScene(physicsGroup, SETTINGS_SCENES.CATS_AND_MICE),
    false
  );
  assert.equal(
    settingsGroupVisibleInScene(obstacleGroup, SETTINGS_SCENES.CATS_AND_MICE),
    false
  );
  assert.equal(
    settingsGroupVisibleInScene(rockGroup, SETTINGS_SCENES.CATS_AND_MICE),
    true
  );
  assert.equal(
    settingsGroupVisibleInScene(rockGroup, SETTINGS_SCENES.TURNIP),
    true
  );
  assert.equal(
    settingsGroupVisibleInScene(trailGroup, SETTINGS_SCENES.CATS_AND_MICE),
    true
  );
  assert.equal(
    settingsGroupVisibleInScene(trailGroup, SETTINGS_SCENES.TURNIP),
    true
  );
  assert.equal(
    controls.every((control) => settingsControlScenes(control).length > 0),
    true
  );
});

test("сохраненная версия настроек показывает дату без года в option select", () => {
  assert.equal(
    formatSettingsVersionSavedAt(new Date(2026, 6, 23, 12, 53)),
    "23.07 12:53",
  );
  assert.equal(
    formatSettingsVersionOptionLabel({
      name: "Проверка",
      updatedAt: new Date(2026, 6, 23, 12, 53),
    }),
    "Проверка — 23.07 12:53",
  );
  assert.equal(formatSettingsVersionSavedAt(""), "");
  assert.equal(formatSettingsVersionSavedAt("не дата"), "");
  assert.equal(
    formatSettingsVersionOptionLabel({ name: "Черновик" }),
    "Черновик",
  );
});

test("production preset совместим с актуальной схемой и shared payload", () => {
  assert.equal(productionPresetName, "prod");
  assert.equal(productionSettingsSchemaVersion, 48);
  assert.deepEqual(
    SharedRoomSettings.sanitizeRoomSettings(productionSettings),
    {
      ...SharedRoomSettings.DEFAULT_ROOM_SETTINGS,
      sceneHeightScreens: 1,
    },
  );
  assert.equal(productionSettings.mass, 1);
  assert.equal(productionSettings.gravity, 9.8);
  assert.deepEqual(
    SETTINGS_GROUPS.flatMap(settingsGroupControls)
      .filter((control) => control.scope !== "local")
      .map((control) => control.name)
      .filter((name) => !Object.hasOwn(productionSettings, name)),
    [],
  );
});

test("settings page распознаёт состояние и ошибки production preset", () => {
  const selection = {
    selectedAt: "2026-08-09T10:00:00.000Z",
    source: { id: "flagged", name: "Помеченный" },
  };
  assert.deepEqual(
    resolveProductionPresetMessage({
      type: "productionPreset.current",
      payload: { canSelect: true, selection },
    }),
    {
      kind: "state",
      payload: { canSelect: true, selection },
    },
  );
  assert.deepEqual(
    resolveProductionPresetMessage({
      type: "productionPreset.selected",
      payload: { canSelect: true, selection },
    }),
    {
      kind: "state",
      payload: { canSelect: true, selection },
    },
  );
  assert.deepEqual(
    resolveProductionPresetMessage({
      type: "error",
      payload: {
        code: "production_preset_store_unavailable",
        message: "Не удалось сохранить production preset",
      },
    }),
    {
      kind: "error",
      message: "Не удалось сохранить production preset",
    },
  );
  assert.equal(
    resolveProductionPresetMessage({
      type: "settingsTemplates.saved",
      payload: {},
    }),
    null,
  );
});

test("production preset source выбирает последнюю версию по updatedAt", () => {
  const older = {
    id: "older",
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-22T10:00:00.000Z",
    settings: { gravity: 7 },
  };
  const fallbackByCreatedAt = {
    id: "fallback",
    createdAt: "2026-07-23T10:00:00.000Z",
    settings: { gravity: 8 },
  };
  const latest = {
    id: "latest",
    createdAt: "2026-07-21T10:00:00.000Z",
    updatedAt: "2026-07-24T10:00:00.000Z",
    settings: { gravity: 9 },
  };

  assert.equal(
    selectLatestSettingsVersionEntry([older, latest, fallbackByCreatedAt]),
    latest,
  );
  assert.deepEqual(
    settingsFromLatestVersionEntry([older, fallbackByCreatedAt]),
    { gravity: 8 },
  );
  assert.equal(
    selectLatestSettingsVersionEntry([
      { ...latest, id: "version-a" },
      { ...latest, id: "version-b" },
    ]).id,
    "version-b",
  );
  assert.equal(
    selectLatestSettingsVersionEntry([
      { ...latest, id: "version-b" },
      { ...latest, id: "version-a" },
    ]).id,
    "version-b",
  );
});

test("параметры формул подъёма и падения имеют ожидаемые диапазоны в UI", () => {
  const controls = SETTINGS_GROUPS.flatMap(settingsGroupControls);
  const mass = controls.find((control) => control.name === "mass");
  const gravity = controls.find((control) => control.name === "gravity");
  const handForce = controls.find((control) => control.name === "handForce");
  const handForceDeficitEasing = controls.find(
    (control) => control.name === "handForceDeficitEasing",
  );
  const pointerInfluence = controls.find(
    (control) => control.name === "pointerInfluence",
  );

  assert.deepEqual(
    {
      min: mass.min,
      max: mass.max,
      step: mass.step,
      defaultValue: mass.defaultValue,
    },
    { min: 0.1, max: 100, step: 0.1, defaultValue: 1 }
  );
  assert.deepEqual(
    {
      min: gravity.min,
      max: gravity.max,
      step: gravity.step,
      defaultValue: gravity.defaultValue,
    },
    { min: 0.1, max: 100, step: 0.05, defaultValue: 9.8 }
  );
  assert.deepEqual(
    {
      min: handForce.min,
      max: handForce.max,
      step: handForce.step,
      defaultValue: handForce.defaultValue,
    },
    { min: 1, max: 1000, step: 1, defaultValue: 50 }
  );
  assert.deepEqual(
    {
      min: pointerInfluence.min,
      max: pointerInfluence.max,
      step: pointerInfluence.step,
      defaultValue: pointerInfluence.defaultValue,
    },
    { min: 0, max: 10, step: 0.1, defaultValue: 1 }
  );
  assert.ok(mass.formulas.includes("F_g = m \\cdot g"));
  assert.ok(gravity.formulas.includes("a_g = \\frac{F_g}{m} = g"));
  assert.equal(
    controls.some((control) => control.name === "firstFallVelocity"),
    false,
  );
  assert.ok(handForce.formulas.some((formula) => formula.includes("F_{hand}")));
  assert.deepEqual(
    {
      label: handForceDeficitEasing.label,
      type: handForceDeficitEasing.type,
      defaultValue: handForceDeficitEasing.defaultValue,
      spellCheck: handForceDeficitEasing.spellCheck,
    },
    {
      label: "Кривая нехватки силы",
      type: "cubic-bezier",
      defaultValue: "cubic-bezier(0.42, 0, 1, 1)",
      spellCheck: false,
    },
  );
  assert.ok(
    handForceDeficitEasing.formulas.some((formula) =>
      formula.includes("bezier(r)"),
    ),
  );
  assert.ok(
    pointerInfluence.formulas.some((formula) => formula.includes("\\cdot p")),
  );
});

test("физика содержит параметры мира и движения без начальной скорости", () => {
  const physicsGroup = SETTINGS_GROUPS.find((group) => group.title === "Физика");
  const controls = physicsGroup.controls.map((control) => control.name);
  const visiblePhysicsNames = [
    "gravity",
    "bounce",
    "wallBounce",
    "inertia",
    "horizontalInertia",
    "groundFriction",
    "turbulence",
  ];

  assert.deepEqual(controls, visiblePhysicsNames);
  assert.equal(
    SETTINGS_GROUPS.flatMap(settingsGroupControls).some(
      (control) => control.name === "firstFallVelocity",
    ),
    false,
  );
  visiblePhysicsNames.forEach((name) => {
    const control = physicsGroup.controls.find((item) => item.name === name);
    assert.equal(control.type, "range");
    assert.ok(Array.isArray(control.formulas));
    assert.ok(control.formulas.length > 0);
  });
});

test("масштаб камня считается по высоте и размеру viewport", () => {
  const linear = "cubic-bezier(0, 0, 1, 1)";
  const options = {
    easing: linear,
    minWidthVw: 10,
    maxWidthVw: 40,
    baseWidthPx: 200,
    viewportWidthPx: 1000,
  };

  assert.equal(rockScaleForY(0, 900, options), 2);
  assert.equal(rockScaleForY(900, 900, options), 0.5);
  assert.equal(
    Math.round(rockScaleForY(450, 900, options) * 1000) / 1000,
    1.25,
  );
  assert.deepEqual(parseCubicBezier("cubic-bezier(0.4, 0, 0.2, 1)"), [
    0.4,
    0,
    0.2,
    1,
  ]);
  assert.equal(parseCubicBezier("linear"), null);

  const shrinkingOptions = {
    ...options,
    minWidthVw: 40,
    maxWidthVw: 10,
  };
  assert.equal(rockScaleForY(900, 900, shrinkingOptions), 2);
  assert.equal(rockScaleForY(0, 900, shrinkingOptions), 0.5);
});

test("нажатие уменьшает текущий масштаб камня на заданный процент", () => {
  assert.equal(rockPressScaleFactor(0), 1);
  assert.equal(rockPressScaleFactor(10), 0.9);
  assert.equal(rockPressScaleFactor(100), 0);
  assert.equal(rockPressScaleFactor(999), 0);
  assert.equal(rockPressScaleFactor("invalid"), 1);
});

test("пульс использует BPM и не накапливает уменьшение", () => {
  assert.equal(rockPulseProgress(1000, 0, 60), 0);
  assert.equal(rockPulseProgress(1500, 0, 60), 0.5);
  assert.equal(rockPulseScaleFactor(0.2, 20) < 1, true);
  assert.equal(rockPulseScaleFactor(0.9, 20), 1);
  assert.equal(rockPulseScaleFactor(1.2, 20), rockPulseScaleFactor(0.2, 20));
});

test("камера вычисляет ограниченную цель и приближается к ней через lerp", () => {
  assert.equal(
    cameraTargetScrollY({
      rockCenterDocumentY: 5000,
      viewportHeight: 1000,
      documentHeight: 10000,
    }),
    4500,
  );
  assert.equal(
    cameraTargetScrollY({
      rockCenterDocumentY: 100,
      viewportHeight: 1000,
      documentHeight: 10000,
    }),
    0,
  );
  assert.equal(
    cameraTargetScrollY({
      rockCenterDocumentY: 9900,
      viewportHeight: 1000,
      documentHeight: 10000,
    }),
    9000,
  );
  assert.equal(cameraFollowScrollY(1000, 2000, 0.1), 1100);
  assert.equal(cameraFollowScrollY(1000, 2000, 1), 2000);
  assert.equal(cameraFollowScrollY(1000, 1000.05, 0.1), 1000.05);
  assert.equal(cameraFollowScrollY(1000, 2000, 0), 1010);
  assert.equal(cameraFollowScrollUpY(2000, 1000, 0.1), 1900);
  assert.equal(cameraFollowScrollUpY(1000, 2000, 0.1), 1000);
  assert.equal(
    cameraFollowDirectionalScrollY({
      currentScrollY: 1000,
      targetScrollY: 2000,
      lerp: 0.1,
      followDown: true,
      followUp: false,
    }),
    1100,
  );
  assert.equal(
    cameraFollowDirectionalScrollY({
      currentScrollY: 1000,
      targetScrollY: 2000,
      lerp: 0.1,
      followDown: false,
      followUp: true,
    }),
    1000,
  );
  assert.equal(
    cameraFollowDirectionalScrollY({
      currentScrollY: 2000,
      targetScrollY: 1000,
      lerp: 0.1,
      followDown: true,
      followUp: true,
    }),
    1900,
  );
  assert.equal(
    cameraFollowDirectionalScrollY({
      currentScrollY: 2000,
      targetScrollY: 1000,
      lerp: 0.1,
      followDown: true,
      followUp: false,
    }),
    2000,
  );
});

test("точка траектории задаётся по высоте масштабированного камня", () => {
  const base = {
    x: 40,
    y: 100,
    width: 200,
    height: 100,
    scale: 2,
  };

  assert.deepEqual(trailAnchorPoint({
    ...base,
    heightPercent: 0,
  }), { x: 140, y: 50 });
  assert.deepEqual(trailAnchorPoint({
    ...base,
    heightPercent: 50,
  }), { x: 140, y: 150 });
  assert.deepEqual(trailAnchorPoint({
    ...base,
    heightPercent: 100,
  }), { x: 140, y: 250 });
});

test("громкость капели зависит от физической высоты и ограничена диапазоном", () => {
  const settings = {
    startVolume: 0.1,
    endVolume: 1,
    easing: "cubic-bezier(0, 0, 1, 1)",
  };

  assert.equal(physicalHeightProgress(1000, 1000), 0);
  assert.equal(physicalHeightProgress(500, 1000), 0.5);
  assert.equal(physicalHeightProgress(0, 1000), 1);
  assert.equal(drizzleVolumeForY(1000, 1000, settings), 0.1);
  assert.equal(drizzleVolumeForY(0, 1000, settings), 1);
  assert.ok(Math.abs(drizzleVolumeForY(500, 1000, settings) - 0.55) < 1e-9);
  assert.equal(
    drizzleVolumeForY(-100, 1000, {
      startVolume: -2,
      endVolume: 4,
      easing: "invalid",
    }),
    1,
  );
});

test("preclick hop зависит от скорости, сохраняет длину и переносится через края", () => {
  assert.equal(
    preclickHopDurationMs({ distancePx: 600, speedPxPerSecond: 1200 }),
    500,
  );
  assert.equal(
    preclickHopDurationMs({ distancePx: 600, speedPxPerSecond: 0 }),
    0,
  );
  assert.equal(
    preclickPointerSpeed({
      previousX: 0,
      previousY: 0,
      previousAtMs: 100,
      x: 100,
      y: 0,
      atMs: 150,
    }),
    2000,
  );
  assert.ok(
    Math.abs(preclickHopDistance({ speedPxPerSecond: 0, maxDistance: 100 }) - 28) <
      Number.EPSILON * 100,
  );
  assert.equal(
    preclickHopDistance({ speedPxPerSecond: 2000, maxDistance: 100 }),
    100,
  );

  const first = preclickRadiusHopDecision({
    successfulHopCount: 0,
    forcedMissConsumed: false,
    missProbabilityPercent: 100,
  });
  const second = preclickRadiusHopDecision({
    successfulHopCount: 1,
    forcedMissConsumed: false,
    missProbabilityPercent: 100,
  });
  const third = preclickRadiusHopDecision({
    successfulHopCount: 2,
    forcedMissConsumed: false,
    missProbabilityPercent: 0,
  });
  assert.equal(first.shouldHop, true);
  assert.equal(second.shouldHop, true);
  assert.deepEqual(third, {
    forcedMissConsumed: true,
    reason: "forced-miss",
    shouldHop: false,
  });
  assert.equal(
    preclickRadiusHopDecision({
      successfulHopCount: 2,
      forcedMissConsumed: true,
      missProbabilityPercent: 0,
      random: () => 0,
    }).shouldHop,
    true,
  );
  assert.equal(
    preclickRadiusHopDecision({
      successfulHopCount: 2,
      forcedMissConsumed: true,
      missProbabilityPercent: 100,
      random: () => 0.999,
    }).shouldHop,
    false,
  );

  const slow = calculatePreclickHopTarget({
    pointerX: 50,
    pointerY: 100,
    centerX: 100,
    centerY: 100,
    speedPxPerSecond: 0,
    maxDistance: 100,
    currentOffsetX: 10,
  });
  assert.equal(slow.x, 38);
  assert.equal(slow.y, 0);
  assert.equal(slow.directionX, 1);

  const fullDistance = calculatePreclickHopTarget({
    pointerX: 200,
    pointerY: 100,
    centerX: 260,
    centerY: 100,
    speedPxPerSecond: 2000,
    maxDistance: 100,
    currentOffsetX: 0,
  });
  assert.equal(fullDistance.x, 100);
  assert.equal(fullDistance.actualDistance, 100);

  assert.deepEqual(
    wrapPreclickHopCenter({
      x: 315,
      y: -25,
      viewportWidth: 300,
      viewportHeight: 200,
    }),
    { x: 15, y: 175 },
  );
  assert.deepEqual(
    wrapPreclickHopCenter({
      x: -620,
      y: 425,
      viewportWidth: 300,
      viewportHeight: 200,
    }),
    { x: 280, y: 25 },
  );

  assert.equal(
    preclickDirectionalViewportSpan({
      directionX: 1,
      directionY: 0,
      viewportWidth: 300,
      viewportHeight: 200,
    }),
    300,
  );
  assert.equal(
    preclickDirectionalViewportSpan({
      directionX: 0,
      directionY: 1,
      viewportWidth: 300,
      viewportHeight: 200,
    }),
    200,
  );
  assert.ok(
    Math.abs(
      preclickDirectionalViewportSpan({
        directionX: 1,
        directionY: 1,
        viewportWidth: 300,
        viewportHeight: 200,
      }) - Math.sqrt(2) * 200,
    ) < 1e-9,
  );

  const safeWrapped = calculatePreclickHopTarget({
    pointerX: 90,
    pointerY: 100,
    centerX: 100,
    centerY: 100,
    speedPxPerSecond: 2000,
    maxDistancePercent: 100,
    viewportWidth: 300,
    viewportHeight: 200,
    activationRadius: 20,
  });
  assert.equal(safeWrapped.safe, true);
  assert.ok(
    preclickToroidalDistance({
      x1: 100,
      y1: 100,
      x2: safeWrapped.wrappedEnd.x,
      y2: safeWrapped.wrappedEnd.y,
      viewportWidth: 300,
      viewportHeight: 200,
    }) >= 2,
  );
  assert.equal(
    preclickHopPathIsSafe({
      startX: 100,
      startY: 100,
      deltaX: 300,
      deltaY: 0,
      pointerX: 90,
      pointerY: 100,
      activationRadius: 20,
      viewportWidth: 300,
      viewportHeight: 200,
    }),
    false,
  );
});

test("радиус курсора пересекает визуальные границы камня", () => {
  const rect = { left: 100, right: 200, top: 200, bottom: 300 };

  assert.equal(
    cursorCircleIntersectsRect({ x: 150, y: 250, radius: 0, rect }),
    true,
  );
  assert.equal(
    cursorCircleIntersectsRect({ x: 95, y: 250, radius: 0, rect }),
    false,
  );
  assert.equal(
    cursorCircleIntersectsRect({ x: 95, y: 250, radius: 5, rect }),
    true,
  );
  assert.equal(
    cursorCircleIntersectsRect({ x: 96, y: 196, radius: 5, rect }),
    false,
  );
  assert.equal(
    cursorCircleIntersectsRect({ x: 96.5, y: 196.5, radius: 5, rect }),
    true,
  );
  assert.equal(
    cursorCircleIntersectsRect({ x: 150, y: 250, radius: -1, rect }),
    true,
  );
  assert.equal(
    cursorCircleIntersectsRect({ x: Number.NaN, y: 250, radius: 5, rect }),
    false,
  );
});

test("настройки размера камня есть в UI и получают fallback", () => {
  const rockSizeGroup = SETTINGS_GROUPS.find(
    (group) => group.title === "Камень",
  );
  const controls = SETTINGS_GROUPS.flatMap(settingsGroupControls);
  const rockScaleEasing = controls.find(
    (control) => control.name === "rockScaleEasing",
  );
  const rockActivatedWidthVw = controls.find(
    (control) => control.name === "rockActivatedWidthVw",
  );
  const rockPressShrinkPercent = controls.find(
    (control) => control.name === "rockPressShrinkPercent",
  );
  const rockPulseShrinkPercent = controls.find(
    (control) => control.name === "rockPulseShrinkPercent",
  );
  const rockImageId = controls.find(
    (control) => control.name === "rockImageId",
  );
  const foldRockImageId = controls.find(
    (control) => control.name === "foldRockImageId",
  );
  const preclickHopGuardClickCount = controls.find(
    (control) => control.name === "preclickHopGuardClickCount",
  );
  const preclickHopActivationRadiusPercent = controls.find(
    (control) => control.name === "preclickHopActivationRadiusPercent",
  );
  const preclickHopMissProbabilityPercent = controls.find(
    (control) => control.name === "preclickHopMissProbabilityPercent",
  );
  const preclickHopSpeedPxPerSecond = controls.find(
    (control) => control.name === "preclickHopSpeedPxPerSecond",
  );
  const preclickHopSpeedEasing = controls.find(
    (control) => control.name === "preclickHopSpeedEasing",
  );
  const rockMinWidthVw = controls.find(
    (control) => control.name === "rockMinWidthVw",
  );
  const rockMaxWidthVw = controls.find(
    (control) => control.name === "rockMaxWidthVw",
  );

  assert.deepEqual(
    normalizeRockScaleSettings(
      {
        rockMinWidthVw: 80,
        rockMaxWidthVw: 20,
        rockScaleEasing: "invalid",
      },
      {
        defaults: {
          rockMinWidthVw: DEFAULT_ROCK_MIN_WIDTH_VW,
          rockMaxWidthVw: DEFAULT_ROCK_MAX_WIDTH_VW,
          rockScaleEasing: DEFAULT_ROCK_SCALE_EASING,
        },
      },
    ),
    {
      rockMinWidthVw: 80,
      rockMaxWidthVw: 20,
      rockScaleEasing: DEFAULT_ROCK_SCALE_EASING,
    },
  );
  assert.ok(rockSizeGroup);
  assert.deepEqual(
    rockSizeGroup.controls.map((control) => control.name),
    [
      "gachiClickSoundFilename",
      "randomDropEnabled",
      "rockJumpEnabled",
      "rockJumpIntervalSeconds",
      "rockJumpAngleSpreadDegrees",
      "rockJumpInertiaSpreadPercent",
      "mass",
      "rockImageId",
      "foldRockImageId",
      "rockScaleEasing",
      "rockPressShrinkPercent",
      "rockWallPenetrationPercent",
      "rockPulseEnabled",
      "rockPulseShrinkPercent",
      "rockPulseBpm",
      "preclickHopGuardClickCount",
      "preclickPopupDelayMs",
      "preclickPopupSizeMultiplier",
      "birchBackgroundEnabled",
      "birchScalePercent",
      "preclickHopActivationRadiusPercent",
      "preclickHopMaxDistancePercent",
      "preclickHopMissProbabilityPercent",
      "preclickHopSpeedPxPerSecond",
      "preclickHopSpeedEasing",
      "rockMinWidthVw",
      "rockActivatedWidthVw",
      "rockMaxWidthVw",
    ],
  );
  assert.equal(rockScaleEasing.type, "cubic-bezier");
  assert.equal(rockScaleEasing.label, "Кривая размера");
  assert.equal(rockScaleEasing.defaultValue, DEFAULT_ROCK_SCALE_EASING);
  assert.equal(rockActivatedWidthVw.type, "number");
  assert.equal(
    rockActivatedWidthVw.label,
    "Размер после запуска физики, %",
  );
  assert.equal(rockActivatedWidthVw.defaultValue, 10);
  assert.deepEqual(
    {
      label: rockImageId.label,
      type: rockImageId.type,
      options: rockImageId.options,
      defaultValue: rockImageId.defaultValue,
    },
    {
      label: "Изображение основного камня",
      type: "select",
      options: [
        ["rock-03", "rock-03.png"],
        ["rock", "rock.webp"],
        ["rock2", "rock2.png"],
      ],
      defaultValue: "rock-03",
    },
  );
  assert.deepEqual(
    {
      label: preclickHopMissProbabilityPercent.label,
      type: preclickHopMissProbabilityPercent.type,
      min: preclickHopMissProbabilityPercent.min,
      max: preclickHopMissProbabilityPercent.max,
      step: preclickHopMissProbabilityPercent.step,
      defaultValue: preclickHopMissProbabilityPercent.defaultValue,
    },
    {
      label: "Несрабатывание отскока, %",
      type: "range",
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 10,
    },
  );
  assert.deepEqual(
    {
      label: preclickHopSpeedPxPerSecond.label,
      type: preclickHopSpeedPxPerSecond.type,
      min: preclickHopSpeedPxPerSecond.min,
      max: preclickHopSpeedPxPerSecond.max,
      step: preclickHopSpeedPxPerSecond.step,
      defaultValue: preclickHopSpeedPxPerSecond.defaultValue,
    },
    {
      label: "Скорость камня при отскоке, px/s",
      type: "range",
      min: 100,
      max: 5000,
      step: 50,
      defaultValue: 1200,
    },
  );
  assert.equal(preclickHopSpeedEasing.type, "cubic-bezier");
  assert.equal(
    preclickHopSpeedEasing.defaultValue,
    "cubic-bezier(0.22, 1, 0.36, 1)",
  );
  assert.deepEqual(
    {
      label: foldRockImageId.label,
      type: foldRockImageId.type,
      options: foldRockImageId.options,
      defaultValue: foldRockImageId.defaultValue,
    },
    {
      label: "Изображение камня в fold-зеркале",
      type: "select",
      options: [
        ["rock-03", "rock-03.png"],
        ["rock", "rock.webp"],
        ["rock2", "rock2.png"],
      ],
      defaultValue: "rock-03",
    },
  );
  assert.deepEqual(
    {
      label: rockPressShrinkPercent.label,
      type: rockPressShrinkPercent.type,
      min: rockPressShrinkPercent.min,
      max: rockPressShrinkPercent.max,
      step: rockPressShrinkPercent.step,
      defaultValue: rockPressShrinkPercent.defaultValue,
    },
    {
      label: "Уменьшение при нажатии, %",
      type: "range",
      min: 0,
      max: 50,
      step: 1,
      defaultValue: 5,
    },
  );
  const rockPulseEnabled = controls.find(
    (control) => control.name === "rockPulseEnabled",
  );
  const rockPulseBpm = controls.find(
    (control) => control.name === "rockPulseBpm",
  );
  assert.equal(rockPulseEnabled.type, "checkbox");
  assert.equal(rockPulseEnabled.defaultChecked, false);
  assert.deepEqual(
    {
      label: rockPulseShrinkPercent.label,
      type: rockPulseShrinkPercent.type,
      min: rockPulseShrinkPercent.min,
      max: rockPulseShrinkPercent.max,
      step: rockPulseShrinkPercent.step,
      defaultValue: rockPulseShrinkPercent.defaultValue,
      enabledWhen: rockPulseShrinkPercent.enabledWhen,
    },
    {
      label: "Уменьшение при пульсе, %",
      type: "range",
      min: 0,
      max: 50,
      step: 1,
      defaultValue: 5,
      enabledWhen: "rockPulseEnabled",
    },
  );
  assert.deepEqual(
    {
      label: rockPulseBpm.label,
      type: rockPulseBpm.type,
      min: rockPulseBpm.min,
      max: rockPulseBpm.max,
      defaultValue: rockPulseBpm.defaultValue,
    },
    {
      label: "Частота пульса, BPM",
      type: "range",
      min: 20,
      max: 240,
      defaultValue: 60,
    },
  );
  assert.deepEqual(
    {
      label: preclickHopGuardClickCount.label,
      type: preclickHopGuardClickCount.type,
      min: preclickHopGuardClickCount.min,
      max: preclickHopGuardClickCount.max,
      step: preclickHopGuardClickCount.step,
      defaultValue: preclickHopGuardClickCount.defaultValue,
    },
    {
      label: "Количество фейковых кликов",
      type: "range",
      min: 0,
      max: 10,
      step: 1,
      defaultValue: 1,
    },
  );
  assert.deepEqual(
    {
      label: preclickHopActivationRadiusPercent.label,
      type: preclickHopActivationRadiusPercent.type,
      min: preclickHopActivationRadiusPercent.min,
      max: preclickHopActivationRadiusPercent.max,
      step: preclickHopActivationRadiusPercent.step,
      defaultValue: preclickHopActivationRadiusPercent.defaultValue,
    },
    {
      label: "Радиус срабатывания, % камня",
      type: "range",
      min: 0,
      max: 300,
      step: 1,
      defaultValue: 50,
    },
  );
  assert.equal(
    controls.some((control) =>
      LEGACY_PRECLICK_PARALLAX_SETTING_KEYS.includes(control.name)
    ),
    false,
  );
  assert.equal(rockMinWidthVw.type, "number");
  assert.equal(rockMinWidthVw.label, "Начальный размер, %");
  assert.equal(rockMinWidthVw.defaultValue, DEFAULT_ROCK_MIN_WIDTH_VW);
  assert.equal(rockMaxWidthVw.type, "number");
  assert.equal(rockMaxWidthVw.label, "Конечный размер, %");
  assert.equal(rockMaxWidthVw.defaultValue, DEFAULT_ROCK_MAX_WIDTH_VW);
  const byName = (name) =>
    rockSizeGroup.controls.find((control) => control.name === name);
  assert.equal(byName("randomDropEnabled").defaultChecked, true);
  assert.equal(byName("rockJumpEnabled").defaultChecked, true);
  assert.deepEqual(
    {
      min: byName("rockJumpIntervalSeconds").min,
      max: byName("rockJumpIntervalSeconds").max,
      step: byName("rockJumpIntervalSeconds").step,
      defaultValue: byName("rockJumpIntervalSeconds").defaultValue,
      enabledWhen: byName("rockJumpIntervalSeconds").enabledWhen,
    },
    {
      min: 1,
      max: 10,
      step: 1,
      defaultValue: 5,
      enabledWhen: "rockJumpEnabled",
    },
  );
  assert.deepEqual(
    {
      label: byName("rockJumpAngleSpreadDegrees").label,
      min: byName("rockJumpAngleSpreadDegrees").min,
      max: byName("rockJumpAngleSpreadDegrees").max,
      step: byName("rockJumpAngleSpreadDegrees").step,
      defaultValue: byName("rockJumpAngleSpreadDegrees").defaultValue,
      enabledWhen: byName("rockJumpAngleSpreadDegrees").enabledWhen,
    },
    {
      label: "Разброс угла",
      min: 0,
      max: 180,
      step: 1,
      defaultValue: 90,
      enabledWhen: "rockJumpEnabled",
    },
  );
  assert.deepEqual(
    {
      label: byName("rockJumpInertiaSpreadPercent").label,
      min: byName("rockJumpInertiaSpreadPercent").min,
      max: byName("rockJumpInertiaSpreadPercent").max,
      step: byName("rockJumpInertiaSpreadPercent").step,
      defaultValue: byName("rockJumpInertiaSpreadPercent").defaultValue,
      enabledWhen: byName("rockJumpInertiaSpreadPercent").enabledWhen,
    },
    {
      label: "Разброс силы",
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 25,
      enabledWhen: "rockJumpEnabled",
    },
  );
});

test("коэффициент активации приводит камень к целевой ширине vw", () => {
  const factor = rockActivationScaleFactor(0.5, {
    targetWidthVw: 10,
    baseWidthPx: 400,
    viewportWidthPx: 1000,
  });
  assert.equal(factor, 0.5);
  assert.equal(400 * 0.5 * factor, 100);
  assert.equal(
    rockActivationScaleFactor(0, {
      targetWidthVw: 10,
      baseWidthPx: 400,
      viewportWidthPx: 1000,
    }),
    1,
  );
});

test("захват сцены 2 возвращает уменьшенный камень к начальному масштабу", () => {
  assert.equal(rockSceneTwoGrabScaleFactor(false, 0.25), 0.25);
  assert.equal(rockSceneTwoGrabScaleFactor(true, 0.25), 1);
  assert.equal(rockSceneTwoGrabScaleFactor(true, 1), 1);
  assert.equal(rockSceneTwoGrabScaleFactor(true, 1.5), 1.5);
});

test("масштабированный камень касается обеих боковых границ", () => {
  const baseWidth = 200;
  const maxX = 800;

  [0.5, 1, 2].forEach((scale) => {
    const visualOffset = (baseWidth * (1 - scale)) / 2;
    const leftCompensation = rockHorizontalWallCompensation(
      0,
      maxX,
      baseWidth,
      scale,
    );
    const rightCompensation = rockHorizontalWallCompensation(
      maxX,
      maxX,
      baseWidth,
      scale,
    );

    assert.equal(leftCompensation + visualOffset, 0);
    assert.equal(
      maxX + rightCompensation + baseWidth - visualOffset,
      maxX + baseWidth,
    );
    assert.equal(
      rockHorizontalWallCompensation(maxX / 2, maxX, baseWidth, scale),
      0,
    );
  });

  assert.equal(rockLocalXForVisualGrab(0, 0, maxX, baseWidth, 0.5), 0);
  assert.equal(
    rockLocalXForVisualGrab(1000, baseWidth, maxX, baseWidth, 0.5),
    maxX,
  );
  assert.equal(
    rockLocalXForVisualGrab(500, baseWidth / 2, maxX, baseWidth, 0.5),
    maxX / 2,
  );
});

test("камень входит в боковые стены на заданную долю визуальной ширины", () => {
  const baseWidth = 200;
  const maxX = 800;
  const worldWidth = maxX + baseWidth;

  [0.5, 1, 2].forEach((scale) => {
    const visualWidth = baseWidth * scale;
    const visualOffset = (baseWidth * (1 - scale)) / 2;
    const penetration = rockWallPenetrationPixels(visualWidth, 20);
    const leftCompensation = rockHorizontalWallCompensation(
      0,
      maxX,
      baseWidth,
      scale,
      20,
    );
    const rightCompensation = rockHorizontalWallCompensation(
      maxX,
      maxX,
      baseWidth,
      scale,
      20,
    );

    assert.equal(leftCompensation + visualOffset, -penetration);
    assert.equal(
      maxX + rightCompensation + baseWidth - visualOffset,
      worldWidth + penetration,
    );
    assert.equal(
      rockHorizontalWallCompensation(
        maxX / 2,
        maxX,
        baseWidth,
        scale,
        20,
      ),
      0,
    );
  });

  assert.equal(rockWallPenetrationPixels(200, 20), 40);
  assert.equal(rockWallPenetrationPixels(200, 150), 200);
  assert.equal(rockWallPenetrationPixels(-200, 20), 0);
});

test("профили свечения ограничивают стоимость glow-слоя", () => {
  assert.deepEqual(
    sanitizeGlowOptimizationSettings({
      glowOptimizationMode: "manual",
      glowBufferScalePercent: 5,
      glowUpdateFps: 100,
      glowMaxPoints: 9999,
      glowDecimation: 0,
      glowTargetFps: 44,
    }),
    {
      glowOptimizationMode: "manual",
      glowBufferScalePercent: 25,
      glowUpdateFps: 60,
      glowMaxPoints: 2000,
      glowDecimation: 1,
      glowTargetFps: 60,
    },
  );
  assert.deepEqual(resolveGlowOptimizationProfile({}), {
    mode: "balanced",
    bufferScale: 0.5,
    updateFps: 30,
    maxPoints: 700,
    decimation: 3,
    targetFps: 60,
  });
  assert.equal(
    DEFAULT_GLOW_OPTIMIZATION_SETTINGS.glowOptimizationMode,
    "balanced",
  );
});

test("glow sampling сохраняет концы и соблюдает бюджет", () => {
  const points = Array.from({ length: 10_000 }, (_, index) => ({
    x: index,
    y: index % 17,
  }));
  const sampled = sampleGlowPoints(points, 350, 6);

  assert.ok(sampled.length <= 350);
  assert.equal(sampled[0], points[0]);
  assert.equal(sampled.at(-1), points.at(-1));
});

test("зависимости настроек поддерживают checkbox и значения select", () => {
  const serialized = serializeSettingDependency({
    name: "dashStyle",
    values: ["dashed", "dotted"],
  });
  const parsed = parseSettingDependencyAttribute(serialized);

  assert.deepEqual(parsed, {
    name: "dashStyle",
    values: ["dashed", "dotted"],
  });
  assert.equal(settingDependencyMatches(parsed, { value: "solid" }), false);
  assert.equal(settingDependencyMatches(parsed, { value: "dotted" }), true);
  assert.equal(
    settingDependencyMatches(
      parseSettingDependencyAttribute("rockJumpEnabled"),
      { type: "checkbox", checked: true },
    ),
    true,
  );
});

test("UI описывает локальные glow-параметры и select-зависимости", () => {
  const controls = SETTINGS_GROUPS.flatMap(settingsGroupControls);
  const byName = (name) => controls.find((control) => control.name === name);

  assert.equal(byName("glowOptimizationMode").scope, "local");
  assert.deepEqual(
    byName("glowOptimizationMode").options.map(([value]) => value),
    ["auto", "performance", "balanced", "quality", "manual"],
  );
  assert.deepEqual(byName("dashLength").enabledWhen, {
    name: "dashStyle",
    values: ["dashed"],
  });
  assert.deepEqual(byName("dashGap").enabledWhen, {
    name: "dashStyle",
    values: ["dashed", "dotted"],
  });
  assert.deepEqual(byName("glowTargetFps").enabledWhen, {
    name: "glowOptimizationMode",
    values: ["auto"],
  });
});

test("3D Fold входит в общую схему настроек с утверждёнными значениями", () => {
  const foldGroup = SETTINGS_GROUPS.find((group) => group.title === "3D Fold");
  const byName = (name) =>
    foldGroup.controls.find((control) => control.name === name);

  assert.ok(foldGroup);
  assert.deepEqual(
    foldGroup.controls.map((control) => control.name),
    [
      "foldPositionPercent",
      "foldPanelHeightVh",
      "foldAngle",
      "foldZoneSize",
      "foldBlendEnabled",
      "foldBlendCurve",
    ],
  );
  assert.deepEqual(
    {
      min: byName("foldPositionPercent").min,
      max: byName("foldPositionPercent").max,
      defaultValue: byName("foldPositionPercent").defaultValue,
    },
    { min: 0, max: 100, defaultValue: 0 },
  );
  assert.deepEqual(
    {
      min: byName("foldPanelHeightVh").min,
      max: byName("foldPanelHeightVh").max,
      defaultValue: byName("foldPanelHeightVh").defaultValue,
    },
    { min: 1, max: 100, defaultValue: 20 },
  );
  assert.deepEqual(
    {
      min: byName("foldAngle").min,
      max: byName("foldAngle").max,
      defaultValue: byName("foldAngle").defaultValue,
    },
    { min: 0, max: 180, defaultValue: 30 },
  );
  assert.deepEqual(
    {
      min: byName("foldZoneSize").min,
      max: byName("foldZoneSize").max,
      defaultValue: byName("foldZoneSize").defaultValue,
    },
    { min: 0, max: 50, defaultValue: 20 },
  );
  assert.equal(byName("foldBlendEnabled").defaultChecked, true);
  assert.equal(
    byName("foldBlendCurve").defaultValue,
    "cubic-bezier(0.333, 0, 0.667, 1)",
  );
  assert.equal(
    byName("foldBlendCurve").enabledWhen,
    "foldBlendEnabled",
  );

  assert.deepEqual(
    normalizeFoldSettings({
      foldPositionPercent: 120,
      foldPanelHeightVh: 0,
      foldAngle: 200,
      foldZoneSize: -10,
      foldBlendCurve: "invalid",
    }),
    {
      foldPositionPercent: 100,
      foldPanelHeightVh: 1,
      foldAngle: 180,
      foldZoneSize: 0,
      foldBlendEnabled: true,
      foldBlendCurve: "cubic-bezier(0.333, 0, 0.667, 1)",
    },
  );
  assert.deepEqual(
    calculateFoldDocumentLayout(
      { foldPositionPercent: 50, foldPanelHeightVh: 25 },
      5000,
      1000,
    ),
    { panelHeightPx: 250, maxTopPx: 4750, topPx: 2375 },
  );
  assert.deepEqual(
    calculateFoldDocumentLayout(
      { foldPositionPercent: 100, foldPanelHeightVh: 100 },
      800,
      1000,
    ),
    { panelHeightPx: 1000, maxTopPx: 0, topPx: 0 },
  );
  assert.equal(foldEffectEnabled({ foldZoneSize: 0 }), false);
  assert.equal(
    foldEffectEnabled({ foldZoneSize: 20 }),
    true,
  );
  assert.match(
    buildFoldBlendMask("cubic-bezier(0.333, 0, 0.667, 1)"),
    /^linear-gradient\(to bottom, /,
  );
});

test("UI содержит настройки камеры, физики, overflow и anchor", () => {
  const cameraGroup = SETTINGS_GROUPS.find(
    (group) => group.title === "Камера",
  );
  const cursorGroup = SETTINGS_GROUPS.find(
    (group) => group.title === "Курсор",
  );
  const handGroup = SETTINGS_GROUPS.find((group) => group.title === "Рука");
  const finalFallGroup = SETTINGS_GROUPS.find(
    (group) => group.title === "Финальное падение",
  );
  const drizzleGroup = SETTINGS_GROUPS.find(
    (group) => group.title === "Капель",
  );
  const controls = SETTINGS_GROUPS.flatMap(settingsGroupControls);
  const byName = (name) =>
    controls.find((control) => control.name === name);

  assert.ok(cameraGroup);
  assert.ok(cursorGroup);
  assert.ok(handGroup);
  assert.ok(finalFallGroup);
  assert.ok(drizzleGroup);
  assert.deepEqual(
    cameraGroup.controls.map((control) => control.name),
    [
      "cameraFollowLerp",
      "cameraFollowDownEnabled",
      "upperZoneAutoScrollEnabled",
      "sceneTwoOverflowYVisible",
    ],
  );
  assert.deepEqual(
    [
      byName("cameraFollowLerp").min,
      byName("cameraFollowLerp").max,
      byName("cameraFollowLerp").step,
      byName("cameraFollowLerp").defaultValue,
    ],
    [0.01, 1, 0.01, 0.1],
  );
  assert.deepEqual(
    cursorGroup.controls.map((control) => control.name),
    ["customCursorEnabled", "customCursorSizePx"],
  );
  assert.equal(byName("customCursorEnabled").defaultChecked, false);
  assert.deepEqual(
    {
      min: byName("customCursorSizePx").min,
      max: byName("customCursorSizePx").max,
      step: byName("customCursorSizePx").step,
      defaultValue: byName("customCursorSizePx").defaultValue,
      enabledWhen: byName("customCursorSizePx").enabledWhen,
    },
    {
      min: 8,
      max: 128,
      step: 1,
      defaultValue: 32,
      enabledWhen: "customCursorEnabled",
    },
  );
  assert.deepEqual(
    {
      type: byName("handVisibilityMode").type,
      defaultValue: byName("handVisibilityMode").defaultValue,
      options: byName("handVisibilityMode").options,
    },
    {
      type: "select",
      defaultValue: "always",
      options: [
        ["always", "Показывать всегда"],
        ["hover", "Показывать по hover"],
        ["hidden", "Не показывать"],
      ],
    },
  );
  assert.deepEqual(
    [
      byName("handImageChangeDelayMs").min,
      byName("handImageChangeDelayMs").max,
      byName("handImageChangeDelayMs").step,
      byName("handImageChangeDelayMs").defaultValue,
    ],
    [0, 1000, 1, 0],
  );
  assert.deepEqual(
    [
      byName("rockGrabRadiusVh").min,
      byName("rockGrabRadiusVh").max,
      byName("rockGrabRadiusVh").step,
      byName("rockGrabRadiusVh").defaultValue,
    ],
    [0, 10, 0.1, 0],
  );
  assert.deepEqual(
    finalFallGroup.controls.map((control) => control.name),
    ["finalFallEnabled", "finalFallDelaySeconds"],
  );
  assert.equal(byName("finalFallEnabled").defaultChecked, false);
  assert.deepEqual(
    [
      byName("finalFallDelaySeconds").min,
      byName("finalFallDelaySeconds").max,
      byName("finalFallDelaySeconds").step,
      byName("finalFallDelaySeconds").defaultValue,
    ],
    [0, 10, 0.1, 2],
  );
  assert.deepEqual(
    drizzleGroup.controls.map((control) => control.name),
    [
      "drizzleEnabled",
      "drizzleStartVolume",
      "drizzleEndVolume",
      "drizzleVolumeEasing",
    ],
  );
  assert.equal(byName("drizzleEnabled").type, "checkbox");
  assert.equal(byName("drizzleEnabled").defaultChecked, true);
  [
    "drizzleStartVolume",
    "drizzleEndVolume",
    "drizzleVolumeEasing",
  ].forEach((name) => {
    assert.equal(byName(name).enabledWhen, "drizzleEnabled");
  });
  assert.deepEqual(
    [
      byName("drizzleStartVolume").min,
      byName("drizzleStartVolume").max,
      byName("drizzleStartVolume").step,
      byName("drizzleStartVolume").defaultValue,
    ],
    [0, 1, 0.01, 0.1],
  );
  assert.equal(byName("drizzleEndVolume").defaultValue, 1);
  assert.deepEqual(
    [
      byName("trailAnchorHeightPercent").min,
      byName("trailAnchorHeightPercent").max,
      byName("trailAnchorHeightPercent").step,
      byName("trailAnchorHeightPercent").defaultValue,
    ],
    [0, 100, 1, 100],
  );
  assert.equal(byName("bounce").step, 0.01);

  [
    "rockScaleEasing",
    "handForceDeficitEasing",
    "drizzleVolumeEasing",
    "rainEnterEasing",
    "rainExitEasing",
  ].forEach((name) => {
    assert.equal(byName(name).type, "cubic-bezier");
  });
});

test("общие визуальные настройки комнаты есть в UI", () => {
  const viewGroup = SETTINGS_GROUPS.find((group) => group.title === "Вид");
  const physicsGroup = SETTINGS_GROUPS.find((group) => group.title === "Физика");
  const controls = SETTINGS_GROUPS.flatMap(settingsGroupControls);
  const sceneHeightScreens = controls.find(
    (control) => control.name === "sceneHeightScreens"
  );
  const rainDropColor = controls.find(
    (control) => control.name === "rainDropColor"
  );
  const rainHighlightColor = controls.find(
    (control) => control.name === "rainHighlightColor"
  );

  assert.deepEqual(
    {
      type: sceneHeightScreens.type,
      min: sceneHeightScreens.min,
      max: sceneHeightScreens.max,
      step: sceneHeightScreens.step,
      defaultValue: sceneHeightScreens.defaultValue,
    },
    {
      type: "range",
      min: 1,
      max: 100,
      step: 1,
      defaultValue: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.sceneHeightScreens,
    }
  );
  assert.equal(
    SharedRoomSettings.sceneMotionMultiplier({ sceneHeightScreens: 1 }),
    1000
  );
  assert.equal(
    SharedRoomSettings.sceneMotionMultiplier({ sceneHeightScreens: 10 }),
    100
  );
  assert.equal(
    SharedRoomSettings.sceneMotionMultiplier({ sceneHeightScreens: 100 }),
    10
  );
  assert.deepEqual(
    viewGroup.controls.map((control) => control.name),
    [
      "themeMode",
      "lightBackgroundColor",
      "lightBackgroundDeepColor",
      "lightBackgroundLowColor",
      "darkBackgroundColor",
      "darkBackgroundDeepColor",
      "darkBackgroundLowColor",
      "sceneHeightScreens",
    ],
  );
  [
    "lightBackgroundColor",
    "lightBackgroundDeepColor",
    "lightBackgroundLowColor",
    "darkBackgroundColor",
    "darkBackgroundDeepColor",
    "darkBackgroundLowColor",
  ].forEach((name) => {
    const control = viewGroup.controls.find((item) => item.name === name);
    assert.equal(control.type, "color");
    assert.equal(
      control.defaultValue,
      SharedRoomSettings.DEFAULT_ROOM_SETTINGS[name],
    );
  });
  assert.deepEqual(
    physicsGroup.controls.map((control) => control.name),
    [
      "gravity",
      "bounce",
      "wallBounce",
      "inertia",
      "horizontalInertia",
      "groundFriction",
      "turbulence",
    ],
  );
  assert.equal(rainDropColor.type, "color");
  assert.equal(
    rainDropColor.defaultValue,
    SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rainDropColor
  );
  assert.equal(rainHighlightColor.type, "color");
  assert.equal(
    rainHighlightColor.defaultValue,
    SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rainHighlightColor
  );
});

test("параметры единственной руки вынесены в отдельную категорию UI", () => {
  const handSizeGroup = SETTINGS_GROUPS.find(
    (group) => group.title === "Рука",
  );
  const controls = SETTINGS_GROUPS.flatMap(settingsGroupControls);
  const handWidthVw = controls.find((control) => control.name === "handWidthVw");
  const heightGates = controls.find((control) => control.name === "heightGates");

  assert.ok(handSizeGroup);
  assert.deepEqual(
    handSizeGroup.controls.map((control) => control.name),
    [
      "handVisibilityMode",
      "handImageChangeDelayMs",
      "rockGrabRadiusVh",
      "handAudioEnabled",
      "handForce",
      "handForceDeficitEasing",
      "pointerInfluence",
      "heightGates",
      "handWidthVw",
    ],
  );
  const handAudioEnabled = controls.find(
    (control) => control.name === "handAudioEnabled",
  );
  assert.equal(handAudioEnabled.type, "checkbox");
  assert.equal(handAudioEnabled.defaultChecked, true);
  assert.equal(heightGates.type, "height-gates");
  assert.equal(heightGates.defaultValue, "[]");
  assert.deepEqual(
    SharedRoomSettings.sanitizeHeightGates([
      { id: "invalid id", heightPercent: 0, durationSeconds: 0 },
      { id: "top", heightPercent: 100, durationSeconds: 61 },
      { id: "duplicate", heightPercent: 99, durationSeconds: 5 },
    ]),
    [
      { id: "height-gate-1-1", heightPercent: 1, durationSeconds: 1 },
      { id: "top", heightPercent: 99, durationSeconds: 60 },
    ],
  );
  assert.equal(
    SharedRoomSettings.sanitizeHeightGates(
      Array.from({ length: 12 }, (_, index) => ({
        id: `gate-${index + 1}`,
        heightPercent: index + 1,
        durationSeconds: index + 1,
      })),
    ).length,
    10,
  );
  const maximumLengthId = "a".repeat(64);
  assert.deepEqual(
    SharedRoomSettings.sanitizeHeightGates([
      { id: maximumLengthId, heightPercent: 20, durationSeconds: 5 },
      { id: maximumLengthId, heightPercent: 40, durationSeconds: 5 },
    ]).map((gate) => gate.id),
    [maximumLengthId, `${"a".repeat(62)}-2`],
  );
  assert.deepEqual(
    SharedRoomSettings.sanitizeRoomSettings({
      handRestSeconds: 10,
      stationaryAutoSlipEnabled: true,
    }).heightGates,
    [],
  );
  assert.deepEqual(
    {
      type: handWidthVw.type,
      min: handWidthVw.min,
      max: handWidthVw.max,
      step: handWidthVw.step,
      defaultValue: handWidthVw.defaultValue,
    },
    {
      type: "range",
      min: 10,
      max: 90,
      step: 0.125,
      defaultValue: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.handWidthVw,
    }
  );
  assert.equal(SharedRoomSettings.DEFAULT_ROOM_SETTINGS.handWidthVw, 28.75 / 2);
});

test("невидимая линия сцены 2 имеет независимые параметры и мигрирует Окна", () => {
  const obstacleGroup = SETTINGS_GROUPS.find(
    (group) => group.title === "Препятствия",
  );
  const barrierGroup = obstacleGroup?.subgroups?.find(
    (group) => group.title === "Невидимая линия",
  );
  const controls = barrierGroup?.controls || [];

  assert.ok(barrierGroup);
  assert.deepEqual(
    controls.map((control) => control.name),
    [
      "sceneTwoBarrierEnabled",
      "sceneTwoBarrierHeightVh",
      "sceneTwoBarrierHopActivationRadiusPercent",
      "sceneTwoBarrierHopMaxDistancePercent",
      "sceneTwoBarrierHopMissProbabilityPercent",
      "sceneTwoBarrierHopSpeedPxPerSecond",
      "sceneTwoBarrierHopSpeedEasing",
    ],
  );
  const clean = SharedRoomSettings.sanitizeRoomSettings({
    sceneTwoBarrierEnabled: true,
    sceneTwoBarrierHeightVh: 99999,
    sceneTwoBarrierHopMissProbabilityPercent: -1,
  });
  assert.equal(clean.sceneTwoBarrierEnabled, true);
  assert.equal(clean.sceneTwoBarrierHeightVh, 10000);
  assert.equal(clean.sceneTwoBarrierHopMissProbabilityPercent, 0);

  const migrated = SharedRoomSettings.migrateRoomSettings({
    windowObstacleEnabled: true,
    preclickHopActivationRadiusPercent: 80,
    preclickHopMaxDistancePercent: 89.7,
    preclickHopMissProbabilityPercent: 10,
    preclickHopSpeedPxPerSecond: 1200,
    preclickHopSpeedEasing: "cubic-bezier(0.22, 1, 0.36, 1)",
  }, 46);
  assert.equal(migrated.sceneTwoBarrierEnabled, true);
  assert.equal(migrated.sceneTwoBarrierHeightVh, 1250);
  assert.equal(migrated.sceneTwoBarrierHopActivationRadiusPercent, 80);
  assert.equal(migrated.sceneTwoBarrierHopMaxDistancePercent, 89.7);
  assert.equal(migrated.sceneTwoBarrierHopMissProbabilityPercent, 10);
  assert.equal(migrated.sceneTwoBarrierHopSpeedPxPerSecond, 1200);
  assert.equal(
    migrated.sceneTwoBarrierHopSpeedEasing,
    "cubic-bezier(0.22, 1, 0.36, 1)",
  );
  assert.equal(Object.hasOwn(migrated, "windowObstacleEnabled"), false);
  assert.equal(
    SharedRoomSettings.sceneTwoBarrierCanonicalY({
      sceneHeightScreens: 20,
      sceneTwoBarrierHeightVh: 1250,
    }),
    750,
  );
});

test("траектория включена по умолчанию и выключается через настройку", () => {
  const trailGroup = SETTINGS_GROUPS.find((group) => group.title === "Траектория");
  const trailStyleGroup = trailGroup?.subgroups?.find(
    (group) => group.title === "Стиль"
  );
  const controls = SETTINGS_GROUPS.flatMap(settingsGroupControls);
  const trailEnabled = controls.find((control) => control.name === "trailEnabled");
  const trailReset = controls.find((control) => control.name === "trailReset");
  const trailMaxPoints = controls.find(
    (control) => control.name === "trailMaxPoints"
  );
  const trailRenderProfile = controls.find(
    (control) => control.name === "trailRenderProfile"
  );
  const lineOpacity = controls.find(
    (control) => control.name === "lineOpacity"
  );
  const linePassOpacity = controls.find(
    (control) => control.name === "linePassOpacity"
  );

  assert.ok(trailGroup);
  assert.ok(trailStyleGroup);
  assert.equal(
    SETTINGS_GROUPS.some((group) => group.title === "Траектория — стиль"),
    false,
  );
  assert.ok(
    trailStyleGroup.controls.some((control) => control.name === "blendMode"),
  );
  assert.equal(trailEnabled.label, "Показывать траекторию");
  assert.equal(trailEnabled.defaultChecked, true);
  assert.equal(trailReset.label, "Сбрасывать при касании земли");
  assert.equal(trailMaxPoints.label, "Хранимых точек");
  assert.equal(trailMaxPoints.max, HARD_TRAIL_LIMIT);
  assert.equal(trailRenderProfile.scope, "local");
  assert.equal(
    controls.some((control) => control.name === "trailUnlimited"),
    false,
  );
  assert.equal(lineOpacity.label, "Общая непрозрачность");
  assert.equal(linePassOpacity.label, "Непрозрачность линии");
  assert.equal(linePassOpacity.defaultValue, 1);
  assert.deepEqual(
    SharedRoomSettings.sanitizeRoomSettings({
      lineOpacity: 0.4,
    }),
    {
      ...SharedRoomSettings.DEFAULT_ROOM_SETTINGS,
      lineOpacity: 0.4,
      linePassOpacity: 1,
    }
  );
  assert.equal(
    SharedRoomSettings.sanitizeRoomSettings({
      linePassOpacity: 2,
    }).linePassOpacity,
    1
  );
});

test("настройка трения земли заменяет скольжение", () => {
  const controls = SETTINGS_GROUPS.flatMap(settingsGroupControls);
  const groundFriction = controls.find(
    (control) => control.name === "groundFriction"
  );

  assert.equal(controls.some((control) => control.name === "sliding"), false);
  assert.equal(groundFriction.label, "Трение земли");
  assert.deepEqual(
    {
      min: groundFriction.min,
      max: groundFriction.max,
      step: groundFriction.step,
      defaultValue: groundFriction.defaultValue,
    },
    { min: 0, max: 1, step: 0.05, defaultValue: 0.35 }
  );
  assert.ok(
    groundFriction.formulas.some((formula) => formula.includes("e^{-k_f"))
  );
  assert.equal(
    groundFriction.formulas.some((formula) => formula.includes("k_{scene}")),
    false,
  );
});

test("группа дождя содержит общий toggle и blur тёмной темы", () => {
  const rainGroup = SETTINGS_GROUPS.find((group) => group.title === "Дождь");
  const rainEnabled = rainGroup.controls.find(
    (control) => control.name === "rainEnabled"
  );
  const rainBackgroundBlurSteps = rainGroup.controls.find(
    (control) => control.name === "rainBackgroundBlurSteps"
  );
  const rainMaxVolume = rainGroup.controls.find(
    (control) => control.name === "rainMaxVolume"
  );
  const rainBlendMode = rainGroup.controls.find(
    (control) => control.name === "rainBlendMode"
  );
  const rainBlurBlendMode = rainGroup.controls.find(
    (control) => control.name === "rainBlurBlendMode"
  );
  const rainBlurPx = rainGroup.controls.find(
    (control) => control.name === "rainBlurPx"
  );
  const rainBlurOpacity = rainGroup.controls.find(
    (control) => control.name === "rainBlurOpacity"
  );
  const rainBlurSaturation = rainGroup.controls.find(
    (control) => control.name === "rainBlurSaturation"
  );
  const rainZIndex = rainGroup.controls.find(
    (control) => control.name === "rainZIndex"
  );
  const rainEnterMs = rainGroup.controls.find(
    (control) => control.name === "rainEnterMs"
  );
  const rainExitMs = rainGroup.controls.find(
    (control) => control.name === "rainExitMs"
  );

  assert.equal(rainEnabled.type, "checkbox");
  assert.equal(rainEnabled.label, "Включить дождь");
  assert.equal(
    rainEnabled.defaultChecked,
    SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rainEnabled
  );
  assert.deepEqual(
    {
      label: rainMaxVolume.label,
      type: rainMaxVolume.type,
      min: rainMaxVolume.min,
      max: rainMaxVolume.max,
      step: rainMaxVolume.step,
      defaultValue: rainMaxVolume.defaultValue,
    },
    {
      label: "Максимальная громкость",
      type: "range",
      min: 0,
      max: 3,
      step: 0.01,
      defaultValue: 0.5,
    },
  );
  assert.equal(SharedRoomSettings.ROOM_SETTINGS_VERSION, 48);
  const visualSettings = SharedRoomSettings.sanitizeRoomSettings({
    lightBackgroundColor: "#ABC",
    darkBackgroundLowColor: "invalid",
    rockActivatedWidthVw: 999,
    rockPressShrinkPercent: 999,
    rockWallPenetrationPercent: 999,
    rockPulseShrinkPercent: 999,
    rockImageId: "unknown",
    foldRockImageId: "rock",
    rockPulseEnabled: "true",
    rockPulseBpm: 999,
    preclickParallaxMaxOffsetPx: 9999,
    preclickHopGuardClickCount: 999,
    preclickPopupDelayMs: 9999,
    preclickPopupSizeMultiplier: 999,
    birchBackgroundEnabled: "true",
    birchScalePercent: 9999,
    preclickHopActivationRadiusPercent: -1,
    preclickHopMaxDistancePercent: -5,
    preclickHopMissProbabilityPercent: 999,
    preclickHopSpeedPxPerSecond: 99999,
    preclickHopSpeedEasing: "invalid",
    preclickParallaxActivationRadiusVw: 80,
    preclickParallaxStartDelayMs: 9999,
    preclickParallaxEndDelayMs: -1,
    preclickParallaxEndMaxOffsetVw: 999,
    preclickParallaxTransitionDurationSeconds: 999,
    preclickParallaxInverted: "true",
    preclickParallaxReturnDurationMs: 9999,
    preclickParallaxReturnEasing: "invalid",
    customCursorEnabled: "true",
    customCursorSizePx: 999,
    handVisibilityMode: "invalid",
    handImageChangeDelayMs: 9999,
    rockGrabRadiusVh: 999,
    cameraFollowDownEnabled: "false",
    upperZoneAutoScrollEnabled: "true",
    sceneTwoOverflowYVisible: "true",
    gachiClickSoundFilename: "missing.mp3",
  });
  assert.equal(visualSettings.lightBackgroundColor, "#aabbcc");
  assert.equal(
    visualSettings.darkBackgroundLowColor,
    SharedRoomSettings.DEFAULT_ROOM_SETTINGS.darkBackgroundLowColor,
  );
  assert.equal(visualSettings.rockActivatedWidthVw, 150);
  assert.equal(visualSettings.rockPressShrinkPercent, 50);
  assert.equal(visualSettings.rockWallPenetrationPercent, 50);
  assert.equal(visualSettings.rockPulseShrinkPercent, 50);
  assert.equal(visualSettings.rockImageId, "rock-03");
  assert.equal(visualSettings.foldRockImageId, "rock");
  assert.equal(visualSettings.rockPulseEnabled, true);
  assert.equal(visualSettings.rockPulseBpm, 240);
  assert.equal(visualSettings.preclickHopGuardClickCount, 10);
  assert.equal(visualSettings.preclickPopupDelayMs, 1000);
  assert.equal(visualSettings.preclickPopupSizeMultiplier, 4);
  assert.equal(visualSettings.birchBackgroundEnabled, true);
  assert.equal(visualSettings.birchScalePercent, 400);
  assert.equal(visualSettings.preclickHopActivationRadiusPercent, 0);
  assert.equal(visualSettings.preclickHopMaxDistancePercent, 0);
  assert.equal(visualSettings.preclickHopMissProbabilityPercent, 100);
  assert.equal(visualSettings.preclickHopSpeedPxPerSecond, 5000);
  assert.equal(
    visualSettings.preclickHopSpeedEasing,
    SharedRoomSettings.DEFAULT_ROOM_SETTINGS.preclickHopSpeedEasing,
  );
  for (const legacyKey of LEGACY_PRECLICK_PARALLAX_SETTING_KEYS) {
    assert.equal(Object.hasOwn(visualSettings, legacyKey), false);
  }
  assert.equal(visualSettings.customCursorEnabled, true);
  assert.equal(visualSettings.customCursorSizePx, 128);
  assert.equal(visualSettings.handVisibilityMode, "always");
  assert.equal(visualSettings.handImageChangeDelayMs, 1000);
  assert.equal(visualSettings.rockGrabRadiusVh, 10);
  assert.equal(visualSettings.cameraFollowDownEnabled, false);
  assert.equal(visualSettings.upperZoneAutoScrollEnabled, true);
  assert.equal(visualSettings.sceneTwoOverflowYVisible, true);
  assert.equal(visualSettings.gachiClickSoundFilename, "Camen.mp3");
  assert.deepEqual(SharedRoomSettings.GACHI_SOUND_FILENAMES, [
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
  const legacyV42 = SharedRoomSettings.migrateRoomSettings({}, 42);
  assert.equal(legacyV42.cameraFollowDownEnabled, true);
  assert.equal(legacyV42.upperZoneAutoScrollEnabled, true);
  assert.equal(legacyV42.sceneTwoOverflowYVisible, false);
  assert.equal(legacyV42.gachiClickSoundFilename, "Camen.mp3");
  const legacyV43 = SharedRoomSettings.migrateRoomSettings({}, 43);
  assert.equal(legacyV43.sceneTwoOverflowYVisible, false);
  assert.equal(legacyV43.upperZoneAutoScrollEnabled, true);
  const legacyV44 = SharedRoomSettings.migrateRoomSettings({}, 44);
  assert.equal(legacyV44.upperZoneAutoScrollEnabled, true);
  const legacyV45 = SharedRoomSettings.migrateRoomSettings({}, 45);
  assert.equal(legacyV45.preclickPopupDelayMs, 200);
  const legacyV47 = SharedRoomSettings.migrateRoomSettings({}, 47);
  assert.equal(legacyV47.preclickPopupSizeMultiplier, 2);
  assert.equal(legacyV47.birchBackgroundEnabled, false);
  assert.equal(legacyV47.birchScalePercent, 100);
  assert.deepEqual(
    SharedRoomSettings.migrateRockVisualSettings({
      rockPressShrinkPercent: 17,
    }),
    {
      rockPressShrinkPercent: 17,
      rockPulseShrinkPercent: 17,
      rockImageId: "rock-03",
      foldRockImageId: "rock-03",
    },
  );
  const legacyV17 = SharedRoomSettings.migrateRoomSettings({}, 17);
  assert.equal(legacyV17.lightBackgroundColor, "#f8f8f5");
  assert.equal(legacyV17.handAudioEnabled, true);
  assert.deepEqual(
    {
      preclickHopGuardClickCount: legacyV17.preclickHopGuardClickCount,
      preclickHopActivationRadiusPercent:
        legacyV17.preclickHopActivationRadiusPercent,
      preclickHopMaxDistancePercent:
        legacyV17.preclickHopMaxDistancePercent,
      preclickPopupDelayMs: legacyV17.preclickPopupDelayMs,
      preclickHopMissProbabilityPercent:
        legacyV17.preclickHopMissProbabilityPercent,
      preclickHopSpeedPxPerSecond:
        legacyV17.preclickHopSpeedPxPerSecond,
      preclickHopSpeedEasing: legacyV17.preclickHopSpeedEasing,
    },
    DEFAULT_PRECLICK_HOP_SETTINGS,
  );

  const legacyPx = SharedRoomSettings.migrateRoomSettings(
    { preclickParallaxActivationRadiusPx: 480 },
    21,
  );
  assert.equal(legacyPx.preclickHopActivationRadiusPercent, 24);
  assert.equal(legacyPx.preclickHopMaxDistancePercent, 30);

  const migratedFold = SharedRoomSettings.migrateRoomSettings(
    {
      draftFoldAngle: 15,
      draftFoldZoneSize: 12,
      draftFoldBlendEnabled: false,
      draftFoldBlendCurve: "cubic-bezier(0, 0, 1, 1)",
      foldAngle: 45,
    },
    30,
  );
  assert.deepEqual(
    {
      foldAngle: migratedFold.foldAngle,
      foldZoneSize: migratedFold.foldZoneSize,
      foldBlendEnabled: migratedFold.foldBlendEnabled,
      foldBlendCurve: migratedFold.foldBlendCurve,
      preclickHopGuardClickCount: migratedFold.preclickHopGuardClickCount,
      preclickHopActivationRadiusPercent:
        migratedFold.preclickHopActivationRadiusPercent,
      preclickHopMaxDistancePercent:
        migratedFold.preclickHopMaxDistancePercent,
    },
    {
      foldAngle: 45,
      foldZoneSize: 12,
      foldBlendEnabled: false,
      foldBlendCurve: "cubic-bezier(0, 0, 1, 1)",
      preclickHopGuardClickCount: 1,
      preclickHopActivationRadiusPercent: 50,
      preclickHopMaxDistancePercent: 62.5,
    },
  );

  const migratedV33 = SharedRoomSettings.migrateRoomSettings(
    {
      preclickParallaxActivationRadiusVw: 80,
      preclickHopMaxDistanceVw: 45,
      preclickParallaxMaxOffsetVw: 12,
      preclickParallaxStartDelayMs: 320,
      preclickParallaxInverted: true,
    },
    33,
  );
  assert.equal(migratedV33.preclickHopActivationRadiusPercent, 80);
  assert.equal(migratedV33.preclickHopMaxDistancePercent, 45);
  for (const legacyKey of LEGACY_PRECLICK_PARALLAX_SETTING_KEYS) {
    assert.equal(Object.hasOwn(migratedV33, legacyKey), false);
  }

  const legacyV37 = SharedRoomSettings.migrateRoomSettings(
    {
      preclickHopActivationRadiusVw: 11,
      preclickHopMaxDistanceVw: 184.3,
    },
    37,
  );
  assert.deepEqual(legacyV37, {
    preclickHopActivationRadiusPercent: 11,
    preclickHopMaxDistancePercent: 150,
    preclickHopGuardClickCount: 1,
    preclickHopMissProbabilityPercent: 10,
    preclickHopSpeedPxPerSecond: 1200,
    preclickHopSpeedEasing: "cubic-bezier(0.22, 1, 0.36, 1)",
    preclickPopupDelayMs: 200,
    preclickPopupSizeMultiplier: 2,
    birchBackgroundEnabled: false,
    birchScalePercent: 100,
    cameraFollowDownEnabled: true,
    upperZoneAutoScrollEnabled: true,
    sceneTwoOverflowYVisible: false,
    gachiClickSoundFilename: "Camen.mp3",
    sceneTwoBarrierEnabled: false,
    sceneTwoBarrierHeightVh: 1250,
    sceneTwoBarrierHopActivationRadiusPercent: 11,
    sceneTwoBarrierHopMaxDistancePercent: 150,
    sceneTwoBarrierHopMissProbabilityPercent: 10,
    sceneTwoBarrierHopSpeedPxPerSecond: 1200,
    sceneTwoBarrierHopSpeedEasing: "cubic-bezier(0.22, 1, 0.36, 1)",
  });
  assert.deepEqual(
    SharedRoomSettings.migrateRoomSettings({ foldZoneSize: 32 }, 35),
    {
      foldZoneSize: 32,
      foldPositionPercent: 0,
      foldPanelHeightVh: 32,
      ...DEFAULT_PRECLICK_HOP_SETTINGS,
      preclickPopupSizeMultiplier: 2,
      birchBackgroundEnabled: false,
      birchScalePercent: 100,
      cameraFollowDownEnabled: true,
      upperZoneAutoScrollEnabled: true,
      sceneTwoOverflowYVisible: false,
      gachiClickSoundFilename: "Camen.mp3",
      sceneTwoBarrierEnabled: false,
      sceneTwoBarrierHeightVh: 1250,
      sceneTwoBarrierHopActivationRadiusPercent: 50,
      sceneTwoBarrierHopMaxDistancePercent: 62.5,
      sceneTwoBarrierHopMissProbabilityPercent: 10,
      sceneTwoBarrierHopSpeedPxPerSecond: 1200,
      sceneTwoBarrierHopSpeedEasing: "cubic-bezier(0.22, 1, 0.36, 1)",
    },
  );
  assert.deepEqual(
    SharedRoomSettings.sanitizeRoomSettings({
      handAudioEnabled: "false",
      drizzleEnabled: false,
    }),
    {
      ...SharedRoomSettings.DEFAULT_ROOM_SETTINGS,
      handAudioEnabled: false,
      drizzleEnabled: false,
    },
  );
  assert.equal(
    SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rockJumpAngleSpreadDegrees,
    90,
  );
  assert.equal(
    SharedRoomSettings.sanitizeRoomSettings({
      rockJumpAngleSpreadDegrees: 999,
    }).rockJumpAngleSpreadDegrees,
    180,
  );
  assert.equal(
    SharedRoomSettings.DEFAULT_ROOM_SETTINGS.handForceDeficitEasing,
    "cubic-bezier(0.42, 0, 1, 1)",
  );
  assert.equal(SharedRoomSettings.DEFAULT_ROOM_SETTINGS.rainMaxVolume, 0.5);
  assert.equal(rainBlendMode.label, "Mix blend дождя");
  assert.equal(rainBlendMode.type, "select");
  assert.equal(rainBlendMode.defaultValue, "multiply");
  assert.equal(rainBlurBlendMode.label, "Mix blend blur");
  assert.equal(rainBlurBlendMode.type, "select");
  assert.equal(rainBlurBlendMode.defaultValue, "normal");
  assert.equal(
    rainBlendMode.options.some(([value]) => value === "screen"),
    true,
  );
  assert.equal(
    rainBlurBlendMode.options.some(([value]) => value === "overlay"),
    true,
  );
  assert.deepEqual(
    {
      label: rainBackgroundBlurSteps.label,
      min: rainBackgroundBlurSteps.min,
      max: rainBackgroundBlurSteps.max,
      step: rainBackgroundBlurSteps.step,
      defaultValue: rainBackgroundBlurSteps.defaultValue,
    },
    {
      label: "Blur FX, шаги",
      min: 0,
      max: 8,
      step: 1,
      defaultValue: 3,
    },
  );
  assert.equal(rainBlurPx.label, "Blur фона");
  assert.equal(rainBlurOpacity.label, "Прозрачность blur");
  assert.equal(rainBlurSaturation.label, "Насыщенность blur");
  assert.equal(rainZIndex.type, "number");
  assert.equal(rainZIndex.label, "Z-index дождя");
  assert.deepEqual(
    {
      min: rainZIndex.min,
      max: rainZIndex.max,
      step: rainZIndex.step,
      defaultValue: rainZIndex.defaultValue,
    },
    { min: 0, max: 30, step: 1, defaultValue: 5 },
  );
  assert.deepEqual(
    {
      label: rainEnterMs.label,
      type: rainEnterMs.type,
      min: rainEnterMs.min,
      max: rainEnterMs.max,
      step: rainEnterMs.step,
      defaultValue: rainEnterMs.defaultValue,
    },
    {
      label: "Появление, с",
      type: "range",
      min: 0,
      max: 20,
      step: 0.1,
      defaultValue: 1.1,
    },
  );
  assert.deepEqual(
    {
      label: rainExitMs.label,
      type: rainExitMs.type,
      min: rainExitMs.min,
      max: rainExitMs.max,
      step: rainExitMs.step,
      defaultValue: rainExitMs.defaultValue,
    },
    {
      label: "Затухание, с",
      type: "range",
      min: 0,
      max: 20,
      step: 0.1,
      defaultValue: 2,
    },
  );
  assert.equal(
    rainGroup.controls.some((control) => control.name === "rainAudioEnterMs"),
    false,
  );
  assert.equal(
    rainGroup.controls.some((control) => control.name === "rainAudioExitMs"),
    false,
  );
});

test("секундомер вершины форматирует накопленное время без сброса часов", () => {
  assert.equal(formatSummitElapsedMs(0), "00:00:00");
  assert.equal(formatSummitElapsedMs(3_661_000), "01:01:01");
  assert.equal(formatSummitElapsedMs(25 * 60 * 60 * 1000), "25:00:00");
  assert.equal(formatSummitElapsedMs(-1000), "00:00:00");
});

test("профиль дождя различает светлую и тёмную тему", () => {
  const lightProfile = getRainVisualProfile({
    rainStrength: 1,
    theme: "light",
  });
  const darkProfile = getRainVisualProfile({
    rainStrength: 1,
    theme: "dark",
  });

  assert.equal(lightProfile.theme, "light");
  assert.equal(lightProfile.dropletsPerSecond, 1300);
  assert.deepEqual(lightProfile.spawnInterval, [0.018, 0.05]);
  assert.deepEqual(lightProfile.spawnSize, [38, 104]);
  assert.deepEqual(lightProfile.fallbackColor, [82, 113, 143]);
  assert.deepEqual(lightProfile.mistColor, [0.04, 0.04, 0.05, 0.48]);
  assert.deepEqual(lightProfile.raindropDiffuseLight, [0.42, 0.42, 0.44]);
  assert.deepEqual(lightProfile.raindropSpecularLight, [0.78, 0.78, 0.8]);

  assert.equal(darkProfile.theme, "dark");
  assert.equal(darkProfile.dropletsPerSecond, 1800);
  assert.equal(darkProfile.spawnLimit, 1800);
  assert.deepEqual(darkProfile.spawnInterval, [0.01, 0.04]);
  assert.deepEqual(darkProfile.spawnSize, [45, 120]);
  assert.deepEqual(darkProfile.fallbackColor, [82, 82, 82]);
  assert.deepEqual(darkProfile.mistColor, [0.04, 0.04, 0.04, 0.8]);
  assert.deepEqual(darkProfile.raindropDiffuseLight, [0.55, 0.55, 0.55]);
  assert.deepEqual(darkProfile.raindropSpecularLight, [1, 1, 1]);
});

test("профиль дождя принимает общий цвет капель и блика", () => {
  const profile = getRainVisualProfile({
    rainStrength: 1,
    theme: "dark",
    rainDropColor: "#336699",
    rainHighlightColor: "#ffcc00",
  });

  assert.deepEqual(profile.fallbackColor, [51, 102, 153]);
  assert.deepEqual(profile.raindropDiffuseLight, [0.27, 0.54, 0.81]);
  assert.deepEqual(profile.raindropSpecularLight, [1, 1, 0]);
  assert.deepEqual(profile.mistColor, [0.16, 0.128, 0.02, 0.8]);
  assert.equal(profile.fxOpacity, 0.59);
  assert.ok(profile.fallbackAlpha[1] > 0.46);
});

test("тёмный профиль принимает число blur-шагов raindrop-fx", () => {
  const profile = getRainVisualProfile({
    rainStrength: 1,
    theme: "dark",
    backgroundBlurSteps: 6,
  });

  assert.equal(profile.backgroundBlurSteps, 6);
});

test("сила дождя масштабирует тёмный профиль дождя", () => {
  const weakProfile = getRainVisualProfile({
    rainStrength: 0.5,
    theme: "dark",
  });
  const strongProfile = getRainVisualProfile({
    rainStrength: 1.5,
    theme: "dark",
  });

  assert.equal(weakProfile.dropletsPerSecond, 900);
  assert.equal(strongProfile.dropletsPerSecond, 2700);
  assert.equal(strongProfile.spawnLimit, 2700);
  assert.ok(strongProfile.spawnSize[0] > weakProfile.spawnSize[0]);
  assert.ok(strongProfile.fxOpacity > weakProfile.fxOpacity);
  assert.equal(strongProfile.fxOpacity, 0.5);
});

test("настройки trail v40 мигрируют в обязательный лимит 10000", () => {
  const migratedUnlimited = SharedRoomSettings.migrateRoomSettings(
    { trailMaxPoints: 1000, trailUnlimited: true },
    40,
  );
  const migratedLimited = SharedRoomSettings.migrateRoomSettings(
    { trailMaxPoints: 1500, trailUnlimited: false },
    40,
  );

  assert.equal(migratedUnlimited.trailMaxPoints, HARD_TRAIL_LIMIT);
  assert.equal(migratedLimited.trailMaxPoints, 1500);
  assert.equal(Object.hasOwn(migratedUnlimited, "trailUnlimited"), false);
  assert.equal(Object.hasOwn(migratedLimited, "trailUnlimited"), false);
  assert.equal(
    SharedRoomSettings.sanitizeRoomSettings({ trailMaxPoints: 99_999 })
      .trailMaxPoints,
    HARD_TRAIL_LIMIT,
  );
});

test("auto trail-профиль учитывает устройство и допускает ручной override", () => {
  assert.equal(detectTrailRenderProfile({ saveData: true }), "low");
  assert.equal(
    detectTrailRenderProfile({ deviceMemory: 4, hardwareConcurrency: 8 }),
    "low",
  );
  assert.equal(
    detectTrailRenderProfile({ coarsePointer: true, hardwareConcurrency: 8 }),
    "mobile",
  );
  assert.equal(
    detectTrailRenderProfile({
      deviceMemory: 8,
      hardwareConcurrency: 8,
      coarsePointer: false,
    }),
    "high",
  );
  assert.equal(detectTrailRenderProfile({}), "desktop");
  assert.equal(resolveTrailRenderProfile("low", {}).historyMaxPoints, 3000);
  assert.equal(resolveTrailRenderProfile("mobile", {}).checkpointPoints, 192);
  assert.equal(resolveTrailRenderProfile("desktop", {}).historyMaxPoints, 10000);
});

test("history window квантуется по viewport и sampling сохраняет края", () => {
  assert.deepEqual(calculateTrailHistoryWindow(0, 1000, 100_000), {
    top: 0,
    height: 3000,
    viewport: 1000,
  });
  assert.deepEqual(calculateTrailHistoryWindow(50_500, 1000, 100_000), {
    top: 49_000,
    height: 3000,
    viewport: 1000,
  });
  assert.deepEqual(calculateTrailHistoryWindow(99_000, 1000, 100_000), {
    top: 97_000,
    height: 3000,
    viewport: 1000,
  });

  const points = Array.from({ length: 10_001 }, (_, index) => ({
    x: index,
    y: index * 2,
  }));
  const sampled = sampleTrailPoints(points, 3000);
  assert.equal(sampled.length, 3000);
  assert.equal(sampled[0], points[0]);
  assert.equal(sampled.at(-1), points.at(-1));

  const ratio = effectiveCanvasPixelRatio({
    cssWidth: 1920,
    cssHeight: 3240,
    devicePixelRatio: 2,
    dprCap: 2,
    maxPixels: 12_000_000,
  });
  assert.ok(ratio < 1.5);
  assert.ok(1920 * 3240 * ratio * ratio <= 12_000_001);
});

test("sampling видимых trail-участков соблюдает общий бюджет без склейки", () => {
  const runs = Array.from({ length: 2000 }, (_, runIndex) =>
    Array.from({ length: 10 }, (_, pointIndex) => ({
      runIndex,
      pointIndex,
    })),
  );
  const sampled = sampleTrailRuns(runs, 3000);

  assert.ok(sampled.reduce((sum, run) => sum + run.length, 0) <= 3000);
  assert.equal(sampled[0][0], runs[0][0]);
  assert.equal(sampled[0].at(-1), runs[0].at(-1));
  assert.equal(sampled.at(-1)[0], runs.at(-1)[0]);
  assert.equal(sampled.at(-1).at(-1), runs.at(-1).at(-1));
  assert.ok(sampled.every((run) => new Set(run.map((point) => point.runIndex)).size === 1));
});
