import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalToLocalPosition,
  localToCanonicalPosition,
} from "../../src/lib/coordinates.mjs";
import { getRainVisualProfile } from "../../src/lib/rainProfile.mjs";
import {
  DEFAULT_ROCK_MAX_WIDTH_VW,
  DEFAULT_ROCK_MIN_WIDTH_VW,
  DEFAULT_ROCK_SCALE_EASING,
  parseCubicBezier,
  rockScaleForY,
} from "../../src/lib/rockScale.mjs";
import { shouldStartRainExit } from "../../src/lib/rainState.mjs";
import { deriveSessionStatus } from "../../src/lib/sessionStatus.mjs";
import {
  normalizeRainSettings,
  normalizeRockScaleSettings,
} from "../../src/lib/settingsModel.mjs";
import {
  SETTINGS_GROUPS,
  SETTINGS_STORAGE_KEY,
} from "../../src/config/settings.mjs";

const SharedRoomSettings = globalThis.SisyphusRoomSettings;

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

test("session status сохраняет публичные тексты управления", () => {
  assert.deepEqual(
    deriveSessionStatus({
      enabled: true,
      connected: true,
      participants: 2,
      hasControl: false,
      pendingControl: false,
      remoteControllerId: "other",
      holderIds: ["other"],
      requiredHolders: 1,
      liftReady: false,
    }),
    {
      text: "В сессии: 2 · камень держат (1 рука)",
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
    },
    {
      defaults,
      isTimingFunctionSupported: (value) => value === "linear",
    },
  );

  assert.deepEqual(settings, {
    rainStrength: 1.5,
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
    rainExitMs: 10000,
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

test("настройка инерции отображает целочисленную шкалу 0–10", () => {
  const inertia = SETTINGS_GROUPS.flatMap((group) => group.controls).find(
    (control) => control.name === "inertia"
  );

  assert.equal(SETTINGS_STORAGE_KEY, "sisyphus-czar-settings-v9");
  assert.deepEqual(
    {
      min: inertia.min,
      max: inertia.max,
      step: inertia.step,
      defaultValue: inertia.defaultValue,
    },
    { min: 0, max: 10, step: 1, defaultValue: 9 }
  );
});

test("параметры формул подъёма и падения имеют ожидаемые диапазоны в UI", () => {
  const controls = SETTINGS_GROUPS.flatMap((group) => group.controls);
  const mass = controls.find((control) => control.name === "mass");
  const gravity = controls.find((control) => control.name === "gravity");
  const firstFallVelocity = controls.find(
    (control) => control.name === "firstFallVelocity",
  );
  const handForce = controls.find((control) => control.name === "handForce");
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
  assert.deepEqual(
    {
      min: firstFallVelocity.min,
      max: firstFallVelocity.max,
      step: firstFallVelocity.step,
      defaultValue: firstFallVelocity.defaultValue,
    },
    { min: -10, max: 10, step: 1, defaultValue: 0 },
  );
  assert.ok(mass.formulas.includes("F_g = m \\cdot g"));
  assert.ok(gravity.formulas.includes("a_g = \\frac{F_g}{m} = g"));
  assert.ok(
    firstFallVelocity.formulas.includes("v_{y0} = v_{firstFall}"),
  );
  assert.ok(handForce.formulas.some((formula) => formula.includes("F_{hand}")));
  assert.ok(
    pointerInfluence.formulas.some((formula) => formula.includes("\\cdot p")),
  );
});

test("физические UI-параметры покрывают shared physics contract", () => {
  const physicsGroup = SETTINGS_GROUPS.find((group) => group.title === "Физика");
  const controls = physicsGroup.controls.map((control) => control.name);
  const sharedPhysicsNames = [
    "mass",
    "gravity",
    "firstFallVelocity",
    "handForce",
    "pointerInfluence",
    "bounce",
    "inertia",
    "groundFriction",
    "turbulence",
  ];

  assert.deepEqual(controls.slice(0, sharedPhysicsNames.length), sharedPhysicsNames);
  sharedPhysicsNames.forEach((name) => {
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
});

test("настройки размера камня есть в UI и получают fallback", () => {
  const controls = SETTINGS_GROUPS.flatMap((group) => group.controls);
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
      rockMinWidthVw: 20,
      rockMaxWidthVw: 80,
      rockScaleEasing: DEFAULT_ROCK_SCALE_EASING,
    },
  );
  assert.equal(rockScaleEasing.type, "text");
  assert.equal(rockScaleEasing.label, "Кривая размера");
  assert.equal(rockScaleEasing.defaultValue, DEFAULT_ROCK_SCALE_EASING);
  assert.equal(rockMinWidthVw.type, "number");
  assert.equal(rockMinWidthVw.defaultValue, DEFAULT_ROCK_MIN_WIDTH_VW);
  assert.equal(rockMaxWidthVw.type, "number");
  assert.equal(rockMaxWidthVw.defaultValue, DEFAULT_ROCK_MAX_WIDTH_VW);
});

test("общие визуальные настройки комнаты есть в UI", () => {
  const controls = SETTINGS_GROUPS.flatMap((group) => group.controls);
  const handWidthVw = controls.find((control) => control.name === "handWidthVw");
  const slaveHandWidthPx = controls.find(
    (control) => control.name === "slaveHandWidthPx"
  );
  const rainDropColor = controls.find(
    (control) => control.name === "rainDropColor"
  );
  const rainHighlightColor = controls.find(
    (control) => control.name === "rainHighlightColor"
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
      min: 20,
      max: 90,
      step: 0.5,
      defaultValue: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.handWidthVw,
    }
  );
  assert.deepEqual(
    {
      type: slaveHandWidthPx.type,
      min: slaveHandWidthPx.min,
      max: slaveHandWidthPx.max,
      step: slaveHandWidthPx.step,
      defaultValue: slaveHandWidthPx.defaultValue,
    },
    {
      type: "range",
      min: 16,
      max: 96,
      step: 1,
      defaultValue: SharedRoomSettings.DEFAULT_ROOM_SETTINGS.slaveHandWidthPx,
    }
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

test("след включён по умолчанию и выключается через настройку", () => {
  const trailEnabled = SETTINGS_GROUPS.flatMap((group) => group.controls).find(
    (control) => control.name === "trailEnabled"
  );

  assert.equal(trailEnabled.label, "Показывать след");
  assert.equal(trailEnabled.defaultChecked, true);
});

test("настройка трения земли заменяет скольжение", () => {
  const controls = SETTINGS_GROUPS.flatMap((group) => group.controls);
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
});

test("группа дождя содержит локальный toggle и blur тёмной темы", () => {
  const rainGroup = SETTINGS_GROUPS.find((group) => group.title === "Дождь");
  const rainEnabled = rainGroup.controls.find(
    (control) => control.name === "rainEnabled"
  );
  const rainBackgroundBlurSteps = rainGroup.controls.find(
    (control) => control.name === "rainBackgroundBlurSteps"
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

  assert.equal(rainEnabled.type, "checkbox");
  assert.equal(rainEnabled.label, "Включить дождь");
  assert.equal(rainEnabled.defaultChecked, undefined);
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
  assert.deepEqual(profile.raindropDiffuseLight, [0.2, 0.4, 0.6]);
  assert.deepEqual(profile.raindropSpecularLight, [1, 0.8, 0]);
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
