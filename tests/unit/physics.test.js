"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Physics = require("../../shared/physics");

test("масса ограничивается диапазоном от 0.1 до 10", () => {
  assert.equal(Physics.DEFAULT_PHYSICS.mass, 1);
  assert.equal(Physics.sanitizePhysics({ mass: 0 }).mass, 0.1);
  assert.equal(Physics.sanitizePhysics({ mass: 0.1 }).mass, 0.1);
  assert.equal(Physics.sanitizePhysics({ mass: 10 }).mass, 10);
  assert.equal(Physics.sanitizePhysics({ mass: 11 }).mass, 10);
});

test("тяготение ограничивается диапазоном от 0.1 до 10", () => {
  assert.equal(Physics.DEFAULT_PHYSICS.gravity, 9.8);
  assert.equal(Physics.sanitizePhysics({ gravity: 0 }).gravity, 0.1);
  assert.equal(Physics.sanitizePhysics({ gravity: 0.1 }).gravity, 0.1);
  assert.equal(Physics.sanitizePhysics({ gravity: 0.45 }).gravity, 0.45);
  assert.equal(Physics.sanitizePhysics({ gravity: 10 }).gravity, 10);
  assert.equal(Physics.sanitizePhysics({ gravity: 11 }).gravity, 10);
});

test("сила тяжести и ускорения считаются из массы и g", () => {
  const physics = Physics.sanitizePhysics({
    mass: 2,
    gravity: 9.8,
    groundFriction: 0.5,
    handForce: 60,
  });

  assert.equal(Math.round(Physics.gravityForce(physics) * 100) / 100, 19.6);
  assert.equal(Physics.gravityAcceleration(physics), 9.8);
  assert.equal(Physics.effectiveHandForce(physics), 60);
  assert.equal(Physics.totalHandForce(physics, 2), 120);
  assert.equal(Math.round(Physics.liftForceSurplus(physics, 1) * 100) / 100, 40.4);
  assert.equal(Physics.handAcceleration(physics), 30);
  assert.equal(Physics.groundFrictionAcceleration(physics), 4.9);
});

test("сила руки ограничивается диапазоном от 1 до 100", () => {
  assert.equal(Physics.DEFAULT_PHYSICS.handForce, 50);
  assert.equal(Physics.sanitizePhysics({ handForce: 0 }).handForce, 1);
  assert.equal(Physics.sanitizePhysics({ handForce: 1 }).handForce, 1);
  assert.equal(Physics.sanitizePhysics({ handForce: 100 }).handForce, 100);
  assert.equal(Physics.sanitizePhysics({ handForce: 101 }).handForce, 100);
});

test("старая шкала силы руки мигрирует в UI-диапазон 1–100", () => {
  assert.equal(
    Physics.sanitizePhysics(Physics.migratePhysics({ handForce: 5 }, 5))
      .handForce,
    50
  );
  assert.equal(
    Physics.sanitizePhysics(Physics.migratePhysics({ handForce: 50 }, 6))
      .handForce,
    50
  );
});

test("подъём зависит от превышения суммарной силы рук над тяжестью", () => {
  const heavy = Physics.sanitizePhysics({
    mass: 10,
    gravity: 10,
    handForce: 90,
  });
  const barelyEnough = Physics.sanitizePhysics({
    mass: 1,
    gravity: 10,
    handForce: 11,
  });
  const strong = Physics.sanitizePhysics({
    mass: 1,
    gravity: 10,
    handForce: 100,
  });

  assert.equal(Physics.totalHandForce(heavy, 1), 90);
  assert.equal(Physics.totalHandForce(heavy, 2), 180);
  assert.equal(Physics.canLift(heavy, 1), false);
  assert.equal(Physics.canLift(heavy, 2), true);
  assert.equal(Physics.dragLiftSpeed(heavy, 1), 0);
  assert.ok(Physics.dragDropSpeed(heavy, 1) >= Physics.DRAG_LIFT.minSpeed);
  assert.ok(Physics.dragVerticalSpeed(heavy, 1) > 0);
  assert.ok(Physics.dragVerticalSpeed(heavy, 2) < 0);
  assert.ok(Physics.dragLiftSpeed(heavy, 2) >= Physics.DRAG_LIFT.minSpeed);
  assert.ok(
    Physics.dragLiftSpeed(strong, 1) >
      Physics.dragLiftSpeed(barelyEnough, 1)
  );
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

test("турбулентность влияет только на горизонтальную скорость", () => {
  const calm = Physics.sanitizeState({
    phase: Physics.PHASES.PLAY,
    x: 500,
    y: 700,
    vx: 0,
    vy: 0,
  });
  const windy = Physics.sanitizeState({
    phase: Physics.PHASES.PLAY,
    x: 500,
    y: 700,
    vx: 0,
    vy: 0,
  });
  const base = { gravity: 1, bounce: 0 };

  Physics.stepState(
    calm,
    Physics.sanitizePhysics({ ...base, turbulence: 0 }),
    0.5
  );
  Physics.stepState(
    windy,
    Physics.sanitizePhysics({ ...base, turbulence: 1 }),
    0.5
  );

  assert.equal(windy.vy, calm.vy);
  assert.equal(windy.y, calm.y);
  assert.notEqual(windy.vx, calm.vx);
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

test("первое падение начинается вниз без импульса руки", () => {
  const state = Physics.sanitizeState({ phase: Physics.PHASES.INTRO, x: 500, y: 500 });
  const physics = Physics.sanitizePhysics({ inertia: 100, turbulence: 0 });

  assert.equal(Physics.beginFirstFall(state, physics, 300, -400), true);
  assert.equal(state.phase, Physics.PHASES.FALLING);
  assert.equal(state.dragging, false);
  assert.equal(state.vx, 0);
  assert.equal(state.vy, 0);

  Physics.stepState(state, physics, Physics.FIXED_STEP_SECONDS);

  assert.equal(state.vx, 0);
  assert.ok(state.vy > 0);
  assert.ok(state.y > 500);
});

test("турбулентность не разворачивает первое падение вверх до земли", () => {
  const state = Physics.sanitizeState({
    phase: Physics.PHASES.INTRO,
    x: 500,
    y: 500,
  });
  const physics = Physics.sanitizePhysics({ turbulence: 1, bounce: 0 });

  Physics.beginFirstFall(state);

  for (let index = 0; index < 3000 && state.phase === Physics.PHASES.FALLING; index += 1) {
    const previousY = state.y;
    Physics.stepState(state, physics, Physics.FIXED_STEP_SECONDS);

    assert.ok(state.y >= previousY);
    if (state.phase === Physics.PHASES.FALLING) {
      assert.ok(state.vy >= 0);
    }
  }

  assert.equal(state.phase, Physics.PHASES.PLAY);
  assert.equal(state.y, Physics.WORLD_HEIGHT);
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

  for (let index = 0; index < 1500 && state.phase !== Physics.PHASES.PLAY; index += 1) {
    Physics.stepState(state, physics, Physics.FIXED_STEP_SECONDS);
  }

  assert.equal(state.phase, Physics.PHASES.PLAY);
  assert.equal(state.y, Physics.WORLD_HEIGHT);
  assert.equal(state.vy, 0);
});

test("первое падение отскакивает от земли по параметру пружинистости", () => {
  const state = Physics.sanitizeState({
    phase: Physics.PHASES.FALLING,
    x: 500,
    y: Physics.WORLD_HEIGHT - 1,
    vx: 0,
    vy: 300,
  });
  const physics = Physics.sanitizePhysics({ bounce: 0.5, turbulence: 0 });

  Physics.stepState(state, physics, Physics.FIXED_STEP_SECONDS);

  assert.equal(state.phase, Physics.PHASES.PLAY);
  assert.equal(state.y, Physics.WORLD_HEIGHT);
  assert.ok(state.vy < 0);
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
    handForce: 80,
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
