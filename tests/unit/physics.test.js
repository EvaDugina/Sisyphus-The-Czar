"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Physics = require("../../shared/physics");

test("масса поддерживает значения до 100", () => {
  assert.equal(Physics.sanitizePhysics({ mass: 100 }).mass, 100);
  assert.equal(Physics.sanitizePhysics({ mass: 101 }).mass, 100);
});

test("тяготение ограничивается диапазоном от 0.2 до 10", () => {
  assert.equal(Physics.sanitizePhysics({ gravity: 0.1 }).gravity, 0.2);
  assert.equal(Physics.sanitizePhysics({ gravity: 0.45 }).gravity, 0.45);
  assert.equal(Physics.sanitizePhysics({ gravity: 10 }).gravity, 10);
  assert.equal(Physics.sanitizePhysics({ gravity: 11 }).gravity, 10);
});

test("уменьшенное тяготение замедляет падение камня", () => {
  const slow = Physics.sanitizeState({
    phase: Physics.PHASES.PLAY,
    x: 500,
    y: 700,
  });
  const fast = Physics.sanitizeState({
    phase: Physics.PHASES.PLAY,
    x: 500,
    y: 700,
  });

  Physics.stepState(
    slow,
    Physics.sanitizePhysics({ gravity: 0.45, turbulence: 0, bounce: 0 }),
    0.5
  );
  Physics.stepState(
    fast,
    Physics.sanitizePhysics({ gravity: 1, turbulence: 0, bounce: 0 }),
    0.5
  );

  assert.ok(fast.y > slow.y);
  assert.ok(fast.vy > slow.vy);
});

test("инерция использует шкалу от 0 до 100", () => {
  assert.equal(Physics.sanitizePhysics({ inertia: -1 }).inertia, 0);
  assert.equal(Physics.sanitizePhysics({ inertia: 75 }).inertia, 75);
  assert.equal(Physics.sanitizePhysics({ inertia: 101 }).inertia, 100);
});

test("старая шкала инерции мигрирует без потери значения", () => {
  assert.equal(
    Physics.sanitizePhysics(Physics.migratePhysics({ inertia: 0.9 }, 1)).inertia,
    90
  );
  assert.equal(
    Physics.sanitizePhysics(Physics.migratePhysics({ inertia: 1 }, 2)).inertia,
    1
  );
});

test("старое скольжение мигрирует в трение земли", () => {
  const migrated = Physics.sanitizePhysics(
    Physics.migratePhysics({ sliding: 0.8 }, 2)
  );

  assert.equal(migrated.groundFriction, 0.8);
  assert.equal(Physics.sanitizePhysics({ groundFriction: 1.5 }).groundFriction, 1);
  assert.equal(Physics.sanitizePhysics({ groundFriction: -0.5 }).groundFriction, 0);
});

test("первое падение получает направленный импульс руки", () => {
  const state = Physics.sanitizeState({ phase: Physics.PHASES.INTRO, x: 500, y: 500 });
  const physics = Physics.sanitizePhysics({ inertia: 100, turbulence: 0 });

  assert.equal(Physics.beginFirstFall(state, physics, 300, -400), true);
  assert.equal(state.phase, Physics.PHASES.FALLING);
  assert.equal(state.dragging, false);
  assert.ok(state.vx > 0);
  assert.ok(state.vy < 0);
  assert.equal(state.vx / state.vy, -0.75);
});

test("камень доходит до пола и переходит в игровую фазу", () => {
  const state = Physics.sanitizeState({
    phase: Physics.PHASES.FALLING,
    x: 500,
    y: 100,
    vx: 0,
    vy: 0,
  });
  const physics = Physics.sanitizePhysics({ bounce: 0, turbulence: 0 });

  for (let index = 0; index < 1200 && state.phase !== Physics.PHASES.PLAY; index += 1) {
    Physics.stepState(state, physics, Physics.FIXED_STEP_SECONDS);
  }

  assert.equal(state.phase, Physics.PHASES.PLAY);
  assert.equal(state.y, Physics.WORLD_HEIGHT);
  assert.equal(state.vy, 0);
});

test("отпечаток распознаётся без остановки камня", () => {
  const imprint = {
    x: 500,
    y: 700,
    toleranceX: 30,
    toleranceY: 20,
  };
  const falling = Physics.sanitizeState({
    phase: Physics.PHASES.FALLING,
    x: 500,
    y: 700,
    vx: 100,
    vy: -500,
  });
  assert.equal(Physics.stateInsideImprint(falling, imprint), false);

  const playing = Physics.sanitizeState({
    phase: Physics.PHASES.PLAY,
    x: 531,
    y: 700,
    vx: 100,
    vy: -500,
  });
  assert.equal(Physics.stateInsideImprint(playing, imprint), false);

  playing.x = 529;
  assert.equal(Physics.stateInsideImprint(playing, imprint), true);
  assert.equal(playing.phase, Physics.PHASES.PLAY);
  assert.equal(playing.x, 529);
  assert.equal(playing.vx, 100);
  assert.equal(playing.vy, -500);
});

test("импульс отпускания учитывает массу, силу и направление указателя", () => {
  const state = Physics.sanitizeState({ phase: Physics.PHASES.PLAY, y: 4000 });
  const physics = Physics.sanitizePhysics({
    mass: 2,
    handForce: 8,
    pointerInfluence: 1,
  });

  Physics.applyReleaseImpulse(state, physics, 300, -500);

  assert.ok(state.vx > 0);
  assert.ok(state.vy < -500);
  assert.equal(state.dragging, false);
});

test("инерция масштабирует импульс и сохраняет направление движения руки", () => {
  const half = Physics.sanitizeState({ phase: Physics.PHASES.PLAY });
  const full = Physics.sanitizeState({ phase: Physics.PHASES.PLAY });
  const none = Physics.sanitizeState({ phase: Physics.PHASES.PLAY });
  const base = {
    mass: 4,
    handForce: 4,
    pointerInfluence: 1,
    turbulence: 0,
  };

  Physics.applyReleaseImpulse(
    half,
    Physics.sanitizePhysics({ ...base, inertia: 50 }),
    300,
    -400
  );
  Physics.applyReleaseImpulse(
    full,
    Physics.sanitizePhysics({ ...base, inertia: 100 }),
    300,
    -400
  );
  Physics.applyReleaseImpulse(
    none,
    Physics.sanitizePhysics({ ...base, inertia: 0 }),
    300,
    -400
  );

  assert.equal(half.vx / half.vy, -0.75);
  assert.equal(full.vx / full.vy, -0.75);
  assert.equal(full.vx, half.vx * 2);
  assert.equal(full.vy, half.vy * 2);
  assert.equal(none.vx, 0);
  assert.equal(none.vy, 0);
});

test("трение земли уравновешивает инерцию на нижней земле", () => {
  const icy = Physics.sanitizeState({
    phase: Physics.PHASES.PLAY,
    x: 500,
    y: Physics.WORLD_HEIGHT,
    vx: 900,
    vy: 0,
  });
  const rough = Physics.sanitizeState({
    phase: Physics.PHASES.PLAY,
    x: 500,
    y: Physics.WORLD_HEIGHT,
    vx: 900,
    vy: 0,
  });

  Physics.stepState(
    icy,
    Physics.sanitizePhysics({ groundFriction: 0, turbulence: 0, bounce: 0 }),
    Physics.FIXED_STEP_SECONDS
  );
  Physics.stepState(
    rough,
    Physics.sanitizePhysics({ groundFriction: 1, turbulence: 0, bounce: 0 }),
    Physics.FIXED_STEP_SECONDS
  );

  assert.ok(icy.vx > rough.vx);
  assert.ok(rough.vx < 900);
});

test("фиксированный шаг даёт одинаковый результат независимо от кадров рендера", () => {
  const initial = {
    phase: Physics.PHASES.FALLING,
    x: 420,
    y: 800,
    vx: 190,
    vy: 120,
    turbTime: 0.4,
  };
  const first = Physics.sanitizeState(initial);
  const second = Physics.sanitizeState(initial);
  const physics = Physics.sanitizePhysics({ turbulence: 0.35, bounce: 0.2 });

  for (let index = 0; index < 180; index += 1) {
    Physics.stepState(first, physics, Physics.FIXED_STEP_SECONDS);
  }
  for (let frame = 0; frame < 60; frame += 1) {
    for (let step = 0; step < 3; step += 1) {
      Physics.stepState(second, physics, Physics.FIXED_STEP_SECONDS);
    }
  }

  assert.deepEqual(first, second);
});
