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
  drizzleVolumeForY,
  physicalHeightProgress,
} from "../../src/lib/drizzleVolume.mjs";
import { getRainVisualProfile } from "../../src/lib/rainProfile.mjs";
import {
  buildFoldBlendMask,
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
  rockScaleForY,
} from "../../src/lib/rockScale.mjs";
import {
  positionScrollDistancePx,
  positionScrollState,
} from "../../src/lib/positionScroll.mjs";
import { trailAnchorPoint } from "../../src/lib/trailAnchor.mjs";
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
  SETTINGS_GROUPS,
  SETTINGS_STORAGE_KEY,
  SETTINGS_VERSIONS_STORAGE_KEY,
  settingsGroupControls,
} from "../../src/config/settings.mjs";

const SharedRoomSettings = globalThis.SisyphusRoomSettings;

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

test("настройки инерции отображают шкалу 0–1", () => {
  const controls = SETTINGS_GROUPS.flatMap(settingsGroupControls);
  const inertia = controls.find(
    (control) => control.name === "inertia"
  );
  const horizontalInertia = controls.find(
    (control) => control.name === "horizontalInertia"
  );

  assert.equal(SETTINGS_STORAGE_KEY, "sisyphus-czar-settings-v22");
  assert.equal(
    SETTINGS_VERSIONS_STORAGE_KEY,
    "sisyphus-czar-settings-versions-v1"
  );
  assert.deepEqual(
    {
      min: inertia.min,
      max: inertia.max,
      step: inertia.step,
      defaultValue: inertia.defaultValue,
    },
    { min: 0, max: 1, step: 0.01, defaultValue: 0.9 }
  );
  assert.deepEqual(
    {
      min: horizontalInertia.min,
      max: horizontalInertia.max,
      step: horizontalInertia.step,
      defaultValue: horizontalInertia.defaultValue,
    },
    { min: 0, max: 1, step: 0.01, defaultValue: 0.02 }
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
  assert.equal(productionSettingsSchemaVersion, 22);
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

test("позиционный скролл следует за камнем в верхней и нижней viewport-зонах", () => {
  const settings = {
    enabled: true,
    zonePercent: 20,
    startSpeedVh: 0.2,
    endSpeedVh: 1,
    easing: "cubic-bezier(0, 0, 1, 1)",
  };

  assert.deepEqual(positionScrollState(201, 1000, settings), {
    active: false,
    direction: 0,
    progress: 0,
    speedVh: 0,
    zoneHeight: 200,
  });
  assert.deepEqual(positionScrollState(200, 1000, settings), {
    active: true,
    direction: -1,
    progress: 0,
    speedVh: 0.2,
    zoneHeight: 200,
  });
  assert.deepEqual(positionScrollState(800, 1000, settings), {
    active: true,
    direction: 1,
    progress: 0,
    speedVh: 0.2,
    zoneHeight: 200,
  });
  assert.equal(positionScrollState(1000, 1000, settings).direction, 1);
  assert.equal(positionScrollState(1000, 1000, settings).speedVh, 1);
  assert.equal(positionScrollState(0, 1000, settings).speedVh, 1);
  assert.ok(
    Math.abs(positionScrollState(100, 1000, settings).speedVh - 0.6) <
      1e-9,
  );
  assert.equal(positionScrollState(0, 1000, {
    ...settings,
    enabled: false,
  }).active, false);
  assert.equal(positionScrollState(0, 1000, {
    ...settings,
    zonePercent: 0,
  }).active, false);
  assert.equal(positionScrollDistancePx(1, 1000, 1 / 60), 10);
  assert.equal(positionScrollDistancePx(0.2, 500, 1 / 60), 1);
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

test("настройки размера камня есть в UI и получают fallback", () => {
  const rockSizeGroup = SETTINGS_GROUPS.find(
    (group) => group.title === "Камень",
  );
  const controls = SETTINGS_GROUPS.flatMap(settingsGroupControls);
  const rockScaleEasing = controls.find(
    (control) => control.name === "rockScaleEasing",
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
      "randomDropEnabled",
      "rockJumpEnabled",
      "rockJumpIntervalSeconds",
      "rockJumpAngleSpreadDegrees",
      "rockJumpInertiaSpreadPercent",
      "mass",
      "rockScaleEasing",
      "rockMinWidthVw",
      "rockMaxWidthVw",
    ],
  );
  assert.equal(rockScaleEasing.type, "cubic-bezier");
  assert.equal(rockScaleEasing.label, "Кривая размера");
  assert.equal(rockScaleEasing.defaultValue, DEFAULT_ROCK_SCALE_EASING);
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
      "draftFoldAngle",
      "draftFoldZoneSize",
      "draftFoldBlendEnabled",
      "draftFoldBlendCurve",
    ],
  );
  assert.deepEqual(
    {
      min: byName("draftFoldAngle").min,
      max: byName("draftFoldAngle").max,
      defaultValue: byName("draftFoldAngle").defaultValue,
    },
    { min: 0, max: 180, defaultValue: 30 },
  );
  assert.deepEqual(
    {
      min: byName("draftFoldZoneSize").min,
      max: byName("draftFoldZoneSize").max,
      defaultValue: byName("draftFoldZoneSize").defaultValue,
    },
    { min: 0, max: 50, defaultValue: 20 },
  );
  assert.equal(byName("draftFoldBlendEnabled").defaultChecked, true);
  assert.equal(
    byName("draftFoldBlendCurve").defaultValue,
    "cubic-bezier(0.333, 0, 0.667, 1)",
  );
  assert.equal(
    byName("draftFoldBlendCurve").enabledWhen,
    "draftFoldBlendEnabled",
  );

  assert.deepEqual(
    normalizeFoldSettings({
      draftFoldAngle: 200,
      draftFoldZoneSize: -10,
      draftFoldBlendCurve: "invalid",
      positionScrollEnabled: false,
    }),
    {
      draftFoldAngle: 180,
      draftFoldZoneSize: 0,
      draftFoldBlendEnabled: true,
      draftFoldBlendCurve: "cubic-bezier(0.333, 0, 0.667, 1)",
      positionScrollEnabled: false,
    },
  );
  assert.equal(foldEffectEnabled({ draftFoldZoneSize: 0 }), false);
  assert.equal(
    foldEffectEnabled({
      draftFoldZoneSize: 20,
      positionScrollEnabled: true,
    }),
    true,
  );
  assert.match(
    buildFoldBlendMask("cubic-bezier(0.333, 0, 0.667, 1)"),
    /^linear-gradient\(to bottom, /,
  );
});

test("UI содержит настройки автоматики, scroll, overflow и anchor", () => {
  const automationGroup = SETTINGS_GROUPS.find(
    (group) => group.title === "Автоматика и скролл",
  );
  const finalFallGroup = SETTINGS_GROUPS.find(
    (group) => group.title === "Финальное падение",
  );
  const drizzleGroup = SETTINGS_GROUPS.find(
    (group) => group.title === "Капель",
  );
  const controls = SETTINGS_GROUPS.flatMap(settingsGroupControls);
  const byName = (name) =>
    controls.find((control) => control.name === name);

  assert.ok(automationGroup);
  assert.ok(finalFallGroup);
  assert.ok(drizzleGroup);
  assert.deepEqual(
    automationGroup.controls.map((control) => control.name),
    [
      "positionScrollEnabled",
      "positionScrollZonePercent",
      "positionScrollStartSpeedVh",
      "positionScrollEndSpeedVh",
      "positionScrollEasing",
      "manualVerticalScrollEnabled",
    ],
  );
  assert.equal(byName("positionScrollEnabled").defaultChecked, true);
  assert.equal(byName("manualVerticalScrollEnabled").defaultChecked, true);
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
      "drizzleStartVolume",
      "drizzleEndVolume",
      "drizzleVolumeEasing",
    ],
  );
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
      byName("positionScrollZonePercent").min,
      byName("positionScrollZonePercent").max,
      byName("positionScrollZonePercent").step,
      byName("positionScrollZonePercent").defaultValue,
    ],
    [0, 20, 0.1, 20],
  );
  assert.deepEqual(
    [
      byName("positionScrollStartSpeedVh").min,
      byName("positionScrollStartSpeedVh").max,
      byName("positionScrollStartSpeedVh").step,
      byName("positionScrollStartSpeedVh").defaultValue,
    ],
    [0, 2, 0.01, 0.2],
  );
  assert.equal(byName("positionScrollEndSpeedVh").defaultValue, 1);
  assert.equal(byName("positionScrollEasing").type, "cubic-bezier");
  assert.equal(
    byName("positionScrollEasing").defaultValue,
    "cubic-bezier(0.17, 0.67, 0.83, 0.67)",
  );
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
    "positionScrollEasing",
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
    ["themeMode", "sceneHeightScreens"],
  );
  assert.deepEqual(
    physicsGroup.controls.map((control) => control.name),
    [
      "gravity",
      "bounce",
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
      "handForce",
      "handForceDeficitEasing",
      "pointerInfluence",
      "heightGates",
      "handWidthVw",
    ],
  );
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

test("настройки препятствия Окна нормализуют диапазоны и мигрируют с версии 16", () => {
  const obstacleGroup = SETTINGS_GROUPS.find(
    (group) => group.title === "Препятствия",
  );
  const windowsGroup = obstacleGroup?.subgroups?.find(
    (group) => group.title === "Окна",
  );
  const controls = windowsGroup?.controls || [];

  assert.ok(windowsGroup);
  assert.equal(windowsGroup.permissionControl, "window-obstacle");
  assert.deepEqual(
    controls.map((control) => control.name),
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
    ],
  );
  assert.deepEqual(
    SharedRoomSettings.sanitizeRoomSettings({
      windowObstacleEnabled: true,
      windowObstacleMinHeightVh: 2000,
      windowObstacleMaxHeightVh: 1000,
      windowObstacleMinIntervalSeconds: 99,
      windowObstacleMaxIntervalSeconds: 0,
      windowObstacleMinWidthPx: 2000,
      windowObstacleMaxWidthPx: 50,
      windowObstacleMinHeightPx: 1200,
      windowObstacleMaxHeightPx: 80,
    }),
    {
      ...SharedRoomSettings.DEFAULT_ROOM_SETTINGS,
      windowObstacleEnabled: true,
      windowObstacleMinHeightVh: 1000,
      windowObstacleMaxHeightVh: 2000,
      windowObstacleMinIntervalSeconds: 0.1,
      windowObstacleMaxIntervalSeconds: 30,
      windowObstacleMinWidthPx: 100,
      windowObstacleMaxWidthPx: 1920,
      windowObstacleMinHeightPx: 100,
      windowObstacleMaxHeightPx: 1080,
    },
  );
  assert.deepEqual(
    SharedRoomSettings.migrateRoomSettings(
      { windowObstacleEnabled: true },
      16,
    ),
    {
      windowObstacleEnabled: false,
      windowObstacleMinHeightVh: 1000,
      windowObstacleMaxHeightVh: 1500,
      windowObstacleMinIntervalSeconds: 0.5,
      windowObstacleMaxIntervalSeconds: 1.5,
      windowObstacleMinWidthPx: 240,
      windowObstacleMaxWidthPx: 640,
      windowObstacleMinHeightPx: 160,
      windowObstacleMaxHeightPx: 480,
    },
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
  assert.equal(trailMaxPoints.label, "Длина траектории");
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
    groundFriction.formulas.some((formula) => formula.includes("k_{scene}"))
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
  assert.equal(SharedRoomSettings.ROOM_SETTINGS_VERSION, 17);
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
