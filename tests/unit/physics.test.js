"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Physics = require("../../shared/physics");

test("масса ограничивается диапазоном от 0.1 до 100", () => {
  assert.equal(Physics.DEFAULT_PHYSICS.mass, 1);
  assert.equal(Physics.sanitizePhysics({ mass: 0 }).mass, 0.1);
  assert.equal(Physics.sanitizePhysics({ mass: 0.1 }).mass, 0.1);
  assert.equal(Physics.sanitizePhysics({ mass: 100 }).mass, 100);
  assert.equal(Physics.sanitizePhysics({ mass: 101 }).mass, 100);
});

test("тяготение ограничивается диапазоном от 0.1 до 100", () => {
  assert.equal(Physics.DEFAULT_PHYSICS.gravity, 9.8);
  assert.equal(Physics.sanitizePhysics({ gravity: 0 }).gravity, 0.1);
  assert.equal(Physics.sanitizePhysics({ gravity: 0.1 }).gravity, 0.1);
  assert.equal(Physics.sanitizePhysics({ gravity: 0.45 }).gravity, 0.45);
  assert.equal(Physics.sanitizePhysics({ gravity: 100 }).gravity, 100);
  assert.equal(Physics.sanitizePhysics({ gravity: 101 }).gravity, 100);
});

test("начальная скорость первого падения ограничивается диапазоном от -10 до 10", () => {
  assert.equal(Physics.DEFAULT_PHYSICS.firstFallVelocity, 0);
  assert.equal(
    Physics.sanitizePhysics({ firstFallVelocity: -11 }).firstFallVelocity,
    -10
  );
  assert.equal(
    Physics.sanitizePhysics({ firstFallVelocity: -10 }).firstFallVelocity,
    -10
  );
  assert.equal(
    Physics.sanitizePhysics({ firstFallVelocity: 10 }).firstFallVelocity,
    10
  );
  assert.equal(
    Physics.sanitizePhysics({ firstFallVelocity: 11 }).firstFallVelocity,
    10
  );
});

test("сила тяжести и затухание трения считаются независимо", () => {
  const physics = Physics.sanitizePhysics({
    mass: 2,
    gravity: 9.8,
    groundFriction: 0.5,
    handForce: 60,
  });

  assert.equal(Math.round(Physics.gravityForce(physics) * 100) / 100, 19.6);
  assert.equal(Physics.gravityAcceleration(physics), 9.8);
  assert.equal(Physics.effectiveHandForce(physics), 60);
  assert.equal(Math.round(Physics.liftForceSurplus(physics) * 100) / 100, 40.4);
  assert.equal(Physics.handForceRatio(physics), 1);
  assert.equal(Physics.handAcceleration(physics), 30);
  assert.equal(Physics.GROUND_FRICTION_DECAY_RATE, 5);
  assert.ok(
    Math.abs(
      Physics.groundFrictionRetention(physics, Physics.FIXED_STEP_SECONDS) -
        Math.exp(-5 * 0.5 * Physics.FIXED_STEP_SECONDS)
    ) < 1e-12
  );
});

test("сила руки ограничивается диапазоном от 1 до 1000", () => {
  assert.equal(Physics.DEFAULT_PHYSICS.handForce, 50);
  assert.equal(Physics.sanitizePhysics({ handForce: 0 }).handForce, 1);
  assert.equal(Physics.sanitizePhysics({ handForce: 1 }).handForce, 1);
  assert.equal(Physics.sanitizePhysics({ handForce: 1000 }).handForce, 1000);
  assert.equal(Physics.sanitizePhysics({ handForce: 1001 }).handForce, 1000);
});

test("влияние рывка ограничивается диапазоном от 0 до 10", () => {
  assert.equal(Physics.DEFAULT_PHYSICS.pointerInfluence, 1);
  assert.equal(
    Physics.sanitizePhysics({ pointerInfluence: -1 }).pointerInfluence,
    0
  );
  assert.equal(
    Physics.sanitizePhysics({ pointerInfluence: 0 }).pointerInfluence,
    0
  );
  assert.equal(
    Physics.sanitizePhysics({ pointerInfluence: 10 }).pointerInfluence,
    10
  );
  assert.equal(
    Physics.sanitizePhysics({ pointerInfluence: 11 }).pointerInfluence,
    10
  );
});

test("старая шкала силы руки мигрирует без потери значения", () => {
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

test("подъём использует силу единственной руки", () => {
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

  assert.equal(Physics.canLift(heavy), false);
  assert.equal(Physics.canLift(barelyEnough), true);
  assert.equal(Physics.handForceRatio(heavy), 0.9);
  assert.equal(Physics.dragLiftSpeed(heavy), 0);
  assert.ok(Physics.dragDropSpeed(heavy) >= Physics.DRAG_LIFT.minSpeed);
  assert.ok(Physics.dragDeficitLiftSpeed(heavy) > 0);
  assert.ok(
    Physics.dragDeficitLiftSpeed(heavy) < Physics.DRAG_LIFT.minSpeed
  );
  assert.ok(
    Physics.dragLiftSpeed(strong) > Physics.dragLiftSpeed(barelyEnough)
  );
});

test("кривая нехватки силы управляет FPS-независимым отставанием", () => {
  const linear = [0, 0, 1, 1];
  const heavy = Physics.sanitizePhysics({
    mass: 10,
    gravity: 10,
    handForce: 50,
  });
  const equal = Physics.sanitizePhysics({
    mass: 10,
    gravity: 10,
    handForce: 100,
  });

  assert.equal(Physics.cubicBezierProgress(0, linear), 0);
  assert.ok(Math.abs(Physics.cubicBezierProgress(0.5, linear) - 0.5) < 1e-6);
  assert.equal(Physics.cubicBezierProgress(1, linear), 1);
  assert.ok(
    Physics.cubicBezierProgress(
      0.5,
      Physics.DEFAULT_FORCE_DEFICIT_CURVE
    ) < 0.5
  );
  assert.ok(
    Math.abs(
      Physics.dragFollowProgress(heavy, Physics.FIXED_STEP_SECONDS, {
        forceDeficitCurve: linear,
      }) - 0.5
    ) < 1e-6
  );
  assert.equal(
    Physics.dragFollowProgress(equal, Physics.FIXED_STEP_SECONDS, {
      forceDeficitCurve: linear,
    }),
    1
  );

  const oneStep = Physics.sanitizeState({
    phase: Physics.PHASES.PLAY,
    x: 0,
    y: 1000,
  });
  const twoSteps = Physics.sanitizeState({
    phase: Physics.PHASES.PLAY,
    x: 0,
    y: 1000,
  });
  Physics.stepDragState(
    oneStep,
    heavy,
    1000,
    0,
    Physics.FIXED_STEP_SECONDS,
    { forceDeficitCurve: linear },
  );
  Physics.stepDragState(
    twoSteps,
    heavy,
    1000,
    0,
    Physics.FIXED_STEP_SECONDS / 2,
    { forceDeficitCurve: linear },
  );
  Physics.stepDragState(
    twoSteps,
    heavy,
    1000,
    0,
    Physics.FIXED_STEP_SECONDS / 2,
    { forceDeficitCurve: linear },
  );
  assert.ok(Math.abs(oneStep.x - twoSteps.x) < 1e-9);
  assert.ok(Math.abs(oneStep.y - twoSteps.y) < 1e-9);
  assert.ok(oneStep.x > 0 && oneStep.x < 1000);
  assert.ok(oneStep.y > 0 && oneStep.y < 1000);
  assert.equal(oneStep.dragging, true);
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

test("подвешенный игровой старт не падает до первого касания", () => {
  const state = Physics.sanitizeState({
    phase: Physics.PHASES.PLAY,
    x: 500,
    y: 1800,
    suspended: true,
  });
  const physics = Physics.sanitizePhysics({
    gravity: 100,
    turbulence: 0,
    bounce: 0,
  });

  assert.equal(Physics.isMoving(state), false);
  assert.equal(
    Physics.stepState(state, physics, Physics.FIXED_STEP_SECONDS),
    false
  );
  assert.equal(state.y, 1800);
  assert.equal(state.vy, 0);
  assert.equal(state.suspended, true);

  Physics.applyReleaseImpulse(state, physics, 0, 0);

  assert.equal(state.suspended, false);
  assert.equal(Physics.isMoving(state), true);
});

test("motionScale компенсирует падение, но не отношение силы руки", () => {
  const normal = Physics.sanitizeState({
    phase: Physics.PHASES.PLAY,
    x: 500,
    y: 700,
  });
  const compensated = Physics.sanitizeState({
    phase: Physics.PHASES.PLAY,
    x: 500,
    y: 700,
  });
  const physics = Physics.sanitizePhysics({
    gravity: 1,
    turbulence: 0,
    bounce: 0,
    handForce: 50,
    mass: 100,
  });

  Physics.stepState(normal, physics, 0.5);
  Physics.stepState(compensated, physics, 0.5, { motionScale: 10 });

  assert.equal(compensated.vy, normal.vy * 10);
  assert.ok(
    Math.abs(compensated.y - 700 - (normal.y - 700) * 10) < 1e-9
  );
  assert.equal(
    Physics.dragFollowProgress(physics, Physics.FIXED_STEP_SECONDS, {
      motionScale: 10,
    }),
    Physics.dragFollowProgress(physics, Physics.FIXED_STEP_SECONDS)
  );
  assert.equal(Physics.canLift(physics), false);
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

test("инерция использует шкалу от 0 до 5", () => {
  assert.equal(Physics.sanitizePhysics({ inertia: -1 }).inertia, 0);
  assert.equal(Physics.sanitizePhysics({ inertia: 0.5 }).inertia, 0.5);
  assert.equal(Physics.sanitizePhysics({ inertia: 1.5 }).inertia, 1.5);
  assert.equal(Physics.sanitizePhysics({ inertia: 6 }).inertia, 5);
  assert.equal(
    Physics.sanitizePhysics({ horizontalInertia: -1 }).horizontalInertia,
    0
  );
  assert.equal(
    Physics.sanitizePhysics({ horizontalInertia: 0.04 }).horizontalInertia,
    0.04
  );
  assert.equal(
    Physics.sanitizePhysics({ horizontalInertia: 1.5 }).horizontalInertia,
    1.5
  );
  assert.equal(
    Physics.sanitizePhysics({ horizontalInertia: 6 }).horizontalInertia,
    5
  );
});

test("старая шкала инерции мигрирует в ослабленную шкалу", () => {
  const migratedInertia = (value, version) =>
    Math.round(
      Physics.sanitizePhysics(Physics.migratePhysics({ inertia: value }, version))
        .inertia * 1000
    ) / 1000;

  assert.equal(
    migratedInertia(0.9, 1),
    0.9
  );
  assert.equal(
    migratedInertia(9, 7),
    0.9
  );
  assert.equal(
    migratedInertia(90, 6),
    0.9
  );
  assert.equal(
    migratedInertia(1.4, 8),
    1.4
  );
  assert.equal(
    migratedInertia(0.09, 9),
    0.9
  );
  assert.equal(
    Physics.sanitizePhysics(Physics.migratePhysics({ inertia: 0.9 }, 8))
      .horizontalInertia,
    Physics.DEFAULT_PHYSICS.horizontalInertia
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
  const physics = Physics.sanitizePhysics({ inertia: 1, turbulence: 0 });

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

test("первое падение получает стартовую вертикальную скорость из физики", () => {
  const down = Physics.sanitizeState({
    phase: Physics.PHASES.INTRO,
    x: 500,
    y: 500,
  });
  const up = Physics.sanitizeState({
    phase: Physics.PHASES.INTRO,
    x: 500,
    y: 500,
  });

  assert.equal(
    Physics.beginFirstFall(
      down,
      Physics.sanitizePhysics({ firstFallVelocity: 10 })
    ),
    true
  );
  assert.equal(down.vy, 10);

  assert.equal(
    Physics.beginFirstFall(
      up,
      Physics.sanitizePhysics({ firstFallVelocity: -10 })
    ),
    true
  );
  assert.equal(up.vy, -10);
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

test("значение пружинистости меняет отскок при одинаковом ударе", () => {
  const resting = Physics.sanitizeState({
    phase: Physics.PHASES.FALLING,
    x: 500,
    y: Physics.WORLD_HEIGHT - 1,
    vx: 0,
    vy: 300,
  });
  const bouncing = Physics.sanitizeState({
    phase: Physics.PHASES.FALLING,
    x: 500,
    y: Physics.WORLD_HEIGHT - 1,
    vx: 0,
    vy: 300,
  });

  Physics.stepState(
    resting,
    Physics.sanitizePhysics({ bounce: 0, turbulence: 0 }),
    Physics.FIXED_STEP_SECONDS,
  );
  Physics.stepState(
    bouncing,
    Physics.sanitizePhysics({ bounce: 0.75, turbulence: 0 }),
    Physics.FIXED_STEP_SECONDS,
  );

  assert.equal(resting.vy, 0);
  assert.ok(bouncing.vy < resting.vy);
});

test("максимальная пружинистость отрабатывает слабые и сильные настоящие удары", () => {
  [1, 119, 300, 1200].forEach((initialVy) => {
    const state = Physics.sanitizeState({
      phase: Physics.PHASES.PLAY,
      x: 500,
      y: Physics.WORLD_HEIGHT - 0.001,
      vx: 0,
      vy: initialVy,
    });
    const physics = Physics.sanitizePhysics({ bounce: 1, turbulence: 0 });
    const impact = Math.min(
      initialVy +
        Physics.gravityAcceleration(physics) * Physics.FIXED_STEP_SECONDS,
      900,
    );

    Physics.stepState(state, physics, Physics.FIXED_STEP_SECONDS);

    assert.equal(state.y, Physics.WORLD_HEIGHT);
    assert.ok(Math.abs(state.vy + impact) < 1e-9);
  });
});

test("максимальная пружинистость не раскачивает лежащий камень", () => {
  const state = Physics.sanitizeState({
    phase: Physics.PHASES.PLAY,
    x: 500,
    y: Physics.WORLD_HEIGHT,
    vx: 0,
    vy: 0,
  });
  const physics = Physics.sanitizePhysics({ bounce: 1, turbulence: 0 });

  for (let index = 0; index < 120; index += 1) {
    Physics.stepState(state, physics, Physics.FIXED_STEP_SECONDS);
  }

  assert.equal(state.y, Physics.WORLD_HEIGHT);
  assert.equal(state.vy, 0);
});

test("пружинистость не зависит от трения земли", () => {
  const reboundSpeeds = [0, 0.5, 1].map((groundFriction) => {
    const state = Physics.sanitizeState({
      phase: Physics.PHASES.FALLING,
      x: 500,
      y: Physics.WORLD_HEIGHT - 1,
      vx: 300,
      vy: 300,
    });
    const physics = Physics.sanitizePhysics({
      bounce: 0.5,
      groundFriction,
      turbulence: 0,
    });

    Physics.stepState(state, physics, Physics.FIXED_STEP_SECONDS, {
      motionScale: 10,
    });
    return state.vy;
  });

  assert.deepEqual(reboundSpeeds, [
    reboundSpeeds[0],
    reboundSpeeds[0],
    reboundSpeeds[0],
  ]);
  assert.ok(reboundSpeeds[0] < 0);
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

test("верхний отпечаток центрируется по X и сохраняет заданную высоту", () => {
  assert.deepEqual(
    Physics.createSummitImprint({
      x: 250,
      y: 700,
      toleranceX: 40,
      toleranceY: 30,
    }),
    {
      x: Physics.WORLD_WIDTH / 2,
      y: 700,
      toleranceX: 40,
      toleranceY: 30,
    }
  );
  assert.deepEqual(Physics.createSummitImprint(null), {
    x: Physics.WORLD_WIDTH / 2,
    y: 100,
    toleranceX: 100,
    toleranceY: 80,
  });
});

test("импульс отпускания учитывает массу, силу и направление указателя", () => {
  const state = Physics.sanitizeState({ phase: Physics.PHASES.PLAY, y: 4000 });
  const physics = Physics.sanitizePhysics({
    mass: 2,
    handForce: 80,
    inertia: 1,
    horizontalInertia: 0.1,
    pointerInfluence: 1,
  });

  Physics.applyReleaseImpulse(state, physics, 300, -500);

  assert.ok(state.vx > 0);
  assert.ok(state.vy < 0);
  assert.equal(state.dragging, false);
});

test("выпрыгивание поддерживает весь верхний сектор ±90 градусов", () => {
  const physics = Physics.sanitizePhysics({
    mass: 1,
    handForce: 50,
    inertia: 0.9,
  });

  for (const angle of [-120, -90, -45, 0, 45, 90, 120]) {
    const state = Physics.sanitizeState({
      phase: Physics.PHASES.PLAY,
      x: 500,
      y: 700,
      vy: 9000,
    });
    const result = Physics.applyRockJumpImpulse(
      state,
      physics,
      angle,
      angle === 0 ? 0 : 2,
    );

    assert.equal(result.angleDegrees, Physics.clamp(angle, -90, 90));
    assert.ok(result.speed >= Physics.ROCK_JUMP_MIN_SPEED);
    assert.ok(state.vy <= 0);
    assert.equal(Math.sign(state.vx), Math.sign(result.angleDegrees));
    assert.equal(state.dragging, false);
    assert.equal(state.suspended, false);
  }
});

test("влияние рывка масштабирует импульс отпускания", () => {
  const none = Physics.sanitizeState({ phase: Physics.PHASES.PLAY });
  const normal = Physics.sanitizeState({ phase: Physics.PHASES.PLAY });
  const boosted = Physics.sanitizeState({ phase: Physics.PHASES.PLAY });
  const base = {
    mass: 10,
    handForce: 1,
    inertia: 1,
    horizontalInertia: 0.1,
    turbulence: 0,
  };

  Physics.applyReleaseImpulse(
    none,
    Physics.sanitizePhysics({ ...base, pointerInfluence: 0 }),
    100,
    0
  );
  Physics.applyReleaseImpulse(
    normal,
    Physics.sanitizePhysics({ ...base, pointerInfluence: 1 }),
    100,
    0
  );
  Physics.applyReleaseImpulse(
    boosted,
    Physics.sanitizePhysics({ ...base, pointerInfluence: 10 }),
    100,
    0
  );

  assert.equal(none.vx, 0);
  assert.ok(normal.vx > 0);
  assert.equal(Math.round(normal.vx * 1_000_000), 420);
  assert.equal(
    Math.round(boosted.vx * 1000),
    Math.round(normal.vx * 10 * 1000)
  );
});

test("инерция масштабирует импульс и сохраняет направление движения руки", () => {
  const half = Physics.sanitizeState({ phase: Physics.PHASES.PLAY });
  const full = Physics.sanitizeState({ phase: Physics.PHASES.PLAY });
  const low = Physics.sanitizeState({ phase: Physics.PHASES.PLAY });
  const none = Physics.sanitizeState({ phase: Physics.PHASES.PLAY });
  const verticalOnly = Physics.sanitizeState({ phase: Physics.PHASES.PLAY });
  const horizontalOnly = Physics.sanitizeState({ phase: Physics.PHASES.PLAY });
  const base = {
    mass: 4,
    handForce: 4,
    pointerInfluence: 1,
    turbulence: 0,
  };

  Physics.applyReleaseImpulse(
    half,
    Physics.sanitizePhysics({
      ...base,
      inertia: 0.5,
      horizontalInertia: 0.05,
    }),
    300,
    -400
  );
  Physics.applyReleaseImpulse(
    full,
    Physics.sanitizePhysics({
      ...base,
      inertia: 1,
      horizontalInertia: 0.1,
    }),
    300,
    -400
  );
  Physics.applyReleaseImpulse(
    low,
    Physics.sanitizePhysics({
      ...base,
      inertia: 0.1,
      horizontalInertia: 0.01,
    }),
    300,
    -400
  );
  Physics.applyReleaseImpulse(
    none,
    Physics.sanitizePhysics({ ...base, inertia: 0, horizontalInertia: 0 }),
    300,
    -400
  );
  Physics.applyReleaseImpulse(
    verticalOnly,
    Physics.sanitizePhysics({
      ...base,
      inertia: 1,
      horizontalInertia: 0,
    }),
    300,
    -400
  );
  Physics.applyReleaseImpulse(
    horizontalOnly,
    Physics.sanitizePhysics({
      ...base,
      inertia: 0,
      horizontalInertia: 0.1,
    }),
    300,
    -400
  );

  assert.ok(half.vx > 0);
  assert.ok(half.vy < 0);
  assert.equal(full.vx, half.vx * 2);
  assert.equal(full.vy, half.vy * 4);
  assert.equal(Math.round(full.vx * 1_000_000), 12600);
  assert.equal(Math.round(full.vy * 1_000_000), -1680000);
  assert.ok(Math.abs(low.vy) < Math.abs(full.vy) * 0.02);
  assert.equal(none.vx, 0);
  assert.equal(none.vy, 0);
  assert.equal(verticalOnly.vx, 0);
  assert.ok(verticalOnly.vy < 0);
  assert.ok(horizontalOnly.vx > 0);
  assert.equal(horizontalOnly.vy, 0);
});

test("значения инерции выше единицы усиливают обе компоненты импульса", () => {
  const release = (inertia, horizontalInertia) => {
    const state = Physics.sanitizeState({ phase: Physics.PHASES.PLAY });
    Physics.applyReleaseImpulse(
      state,
      Physics.sanitizePhysics({
        mass: 10,
        handForce: 1,
        pointerInfluence: 1,
        inertia,
        horizontalInertia,
      }),
      100,
      -100,
    );
    return state;
  };

  const normal = release(1, 1);
  const high = release(5, 5);

  assert.ok(Math.abs(high.vx - normal.vx * 5) < 1e-12);
  assert.ok(Math.abs(high.vy - normal.vy * 25) < 1e-12);
});

test("ограничители release-скорости работают независимо по осям", () => {
  const state = Physics.sanitizeState({ phase: Physics.PHASES.PLAY });
  Physics.applyReleaseImpulse(
    state,
    Physics.sanitizePhysics({
      mass: 0.1,
      handForce: 1000,
      pointerInfluence: 10,
      inertia: 5,
      horizontalInertia: 5,
    }),
    4000,
    -9000,
  );

  assert.equal(state.vx, 900);
  assert.equal(state.vy, -1800);
});

test("горизонтальная инерция не участвует в трении земли", () => {
  const stepWithHorizontalInertia = (horizontalInertia) => {
    const state = Physics.sanitizeState({
      phase: Physics.PHASES.PLAY,
      x: 500,
      y: Physics.WORLD_HEIGHT,
      vx: 600,
      vy: 0,
    });
    Physics.stepState(
      state,
      Physics.sanitizePhysics({
        groundFriction: 0.5,
        horizontalInertia,
        turbulence: 0,
        bounce: 0,
      }),
      Physics.FIXED_STEP_SECONDS,
    );
    return state;
  };

  const withoutHorizontalInertia = stepWithHorizontalInertia(0);
  const withMaximumHorizontalInertia = stepWithHorizontalInertia(5);
  assert.equal(
    withMaximumHorizontalInertia.x,
    withoutHorizontalInertia.x,
  );
  assert.equal(
    withMaximumHorizontalInertia.vx,
    withoutHorizontalInertia.vx,
  );
});

test("трение земли заметно и монотонно гасит инерцию при любом масштабе", () => {
  function simulateGroundFriction(groundFriction, seconds, motionScale) {
    const state = Physics.sanitizeState({
      phase: Physics.PHASES.PLAY,
      x: 50,
      y: Physics.WORLD_HEIGHT,
      vx: 900,
      vy: 0,
    });
    const physics = Physics.sanitizePhysics({
      groundFriction,
      turbulence: 0,
      bounce: 0,
    });
    const steps = Math.round(seconds / Physics.FIXED_STEP_SECONDS);

    for (let index = 0; index < steps; index += 1) {
      Physics.stepState(state, physics, Physics.FIXED_STEP_SECONDS, {
        motionScale,
      });
    }
    return state;
  }

  const scales = [10, 100, 1000];
  const results = scales.map((motionScale) =>
    [0, 0.25, 0.5, 0.75, 0.99, 1].map((groundFriction) =>
      simulateGroundFriction(groundFriction, 1, motionScale),
    ),
  );
  const [baseline] = results;

  results.forEach((states) => {
    states.slice(1).forEach((state, index) => {
      assert.ok(state.vx < states[index].vx);
      assert.ok(state.x < states[index].x);
    });
    states.forEach((state, index) => {
      assert.ok(Math.abs(state.vx - baseline[index].vx) < 1e-9);
      assert.ok(Math.abs(state.x - baseline[index].x) < 1e-9);
    });
  });
  assert.ok(baseline[0].vx > 800);
  assert.ok(baseline[2].vx < baseline[0].vx * 0.1);
  assert.ok(baseline[4].vx > 0);
  assert.equal(baseline[5].vx, 0);
  assert.equal(baseline[5].x, 50);
  assert.equal(simulateGroundFriction(1, 2, 10).vx, 0);
});

test("максимальное трение мгновенно блокирует проскальзывание по земле", () => {
  [0, 0.1, 1].forEach((inertia) => {
    const state = Physics.sanitizeState({
      phase: Physics.PHASES.PLAY,
      x: 500,
      y: Physics.WORLD_HEIGHT,
      vx: 900,
      vy: 0,
    });
    const physics = Physics.sanitizePhysics({
      groundFriction: 1,
      inertia,
      turbulence: 0,
      bounce: 0,
    });

    Physics.stepState(state, physics, Physics.FIXED_STEP_SECONDS, {
      motionScale: 100,
    });

    assert.equal(state.x, 500);
    assert.equal(state.vx, 0);
  });

  const landing = Physics.sanitizeState({
    phase: Physics.PHASES.PLAY,
    x: 500,
    y: Physics.WORLD_HEIGHT - 0.1,
    vx: 900,
    vy: 300,
  });
  Physics.stepState(
    landing,
    Physics.sanitizePhysics({
      groundFriction: 1,
      turbulence: 0,
      bounce: 0,
    }),
    Physics.FIXED_STEP_SECONDS,
  );

  assert.equal(landing.y, Physics.WORLD_HEIGHT);
  assert.equal(landing.vx, 0);
});

test("трение земли не действует в воздухе или во время удержания", () => {
  const physicsWithoutFriction = Physics.sanitizePhysics({
    groundFriction: 0,
    turbulence: 0,
    bounce: 0,
  });
  const physicsWithFriction = Physics.sanitizePhysics({
    groundFriction: 1,
    turbulence: 0,
    bounce: 0,
  });
  const airborneWithoutFriction = Physics.sanitizeState({
    phase: Physics.PHASES.PLAY,
    x: 500,
    y: 500,
    vx: 300,
    vy: 0,
  });
  const airborneWithFriction = Physics.sanitizeState({
    phase: Physics.PHASES.PLAY,
    x: 500,
    y: 500,
    vx: 300,
    vy: 0,
  });
  const dragging = Physics.sanitizeState({
    phase: Physics.PHASES.PLAY,
    x: 500,
    y: Physics.WORLD_HEIGHT,
    vx: 300,
    vy: 0,
  });
  dragging.dragging = true;
  dragging.controllerId = "master";
  const suspended = Physics.sanitizeState({
    phase: Physics.PHASES.PLAY,
    x: 500,
    y: Physics.WORLD_HEIGHT,
    vx: 300,
    vy: 0,
    suspended: true,
  });
  const options = { motionScale: 100 };

  Physics.stepState(
    airborneWithoutFriction,
    physicsWithoutFriction,
    Physics.FIXED_STEP_SECONDS,
    options
  );
  Physics.stepState(
    airborneWithFriction,
    physicsWithFriction,
    Physics.FIXED_STEP_SECONDS,
    options
  );
  Physics.stepState(
    dragging,
    physicsWithFriction,
    Physics.FIXED_STEP_SECONDS,
    options
  );
  Physics.stepState(
    suspended,
    physicsWithFriction,
    Physics.FIXED_STEP_SECONDS,
    options
  );

  assert.equal(airborneWithFriction.vx, airborneWithoutFriction.vx);
  assert.equal(dragging.vx, 300);
  assert.equal(suspended.vx, 300);
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

test("пружинистость боковых стен независима от наземного отскока", () => {
  const initial = {
    phase: Physics.PHASES.PLAY,
    x: 0.1,
    y: 500,
    vx: -300,
    vy: 0,
  };
  const soft = Physics.sanitizeState(initial);
  const springy = Physics.sanitizeState(initial);
  Physics.stepState(
    soft,
    Physics.sanitizePhysics({ bounce: 1, wallBounce: 0.2, turbulence: 0 }),
    Physics.FIXED_STEP_SECONDS,
  );
  Physics.stepState(
    springy,
    Physics.sanitizePhysics({ bounce: 1, wallBounce: 0.8, turbulence: 0 }),
    Physics.FIXED_STEP_SECONDS,
  );

  assert.ok(soft.vx > 0);
  assert.ok(springy.vx > soft.vx * 3.9);
  assert.equal(Physics.migratePhysics({ bounce: 0.73 }, 11).wallBounce, 0.73);
});

test("barrier-hop освобождает камень и задаёт случайный физический импульс", () => {
  const state = Physics.sanitizeState({
    phase: Physics.PHASES.PLAY,
    x: 500,
    y: 500,
    dragging: true,
    controllerId: "master",
  });
  const values = [0.5, 0.25];
  const result = Physics.applyBarrierHopImpulse(state, {
    random: () => values.shift(),
    maxDistancePercent: 75,
    speedPxPerSecond: 1200,
    easingPoints: [0.22, 1, 0.36, 1],
  });

  assert.equal(state.dragging, false);
  assert.equal(state.controllerId, null);
  assert.equal(state.suspended, false);
  assert.ok(result.speed > 0);
  assert.ok(Math.abs(state.vx) < 1e-8);
  assert.ok(state.vy > 0);
});

test("тонкая стеклянная полоса не туннелируется при свободном падении", () => {
  const state = Physics.sanitizeState({
    phase: Physics.PHASES.PLAY,
    x: 500,
    y: 490,
    vx: 0,
    vy: 1000,
  });
  const physics = Physics.sanitizePhysics({
    gravity: 0.1,
    turbulence: 0,
  });

  Physics.stepState(state, physics, Physics.FIXED_STEP_SECONDS, {
    obstacles: [{ id: "glass", left: 200, right: 800, top: 500, bottom: 502 }],
    obstacleBounce: 0.5,
  });

  assert.equal(state.y, 499.99);
  assert.ok(state.vy < -499 && state.vy > -501);
});

test("перетаскивание останавливается у стеклянной полосы без отпускания камня", () => {
  const state = Physics.sanitizeState({
    phase: Physics.PHASES.PLAY,
    x: 500,
    y: 490,
    dragging: true,
    controllerId: "master",
  });
  const physics = Physics.sanitizePhysics({ dragResponsiveness: 100 });
  state.controllerId = "master";

  Physics.stepDragState(state, physics, 500, 700, 0.05, {
    obstacles: [{ id: "glass", left: 200, right: 800, top: 500, bottom: 502 }],
    obstacleBounce: 1,
  });

  assert.equal(state.y, 499.99);
  assert.equal(state.vy, 0);
  assert.equal(state.dragging, true);
  assert.equal(state.controllerId, "master");
});

test("частичная стеклянная полоса не мешает движению вне своей ширины", () => {
  const state = Physics.sanitizeState({
    phase: Physics.PHASES.PLAY,
    x: 900,
    y: 490,
    vx: 0,
    vy: 1000,
  });
  const physics = Physics.sanitizePhysics({
    gravity: 0.1,
    turbulence: 0,
  });

  Physics.stepState(state, physics, Physics.FIXED_STEP_SECONDS, {
    obstacles: [{ id: "glass", left: 200, right: 800, top: 500, bottom: 502 }],
    obstacleBounce: 0.5,
  });

  assert.ok(state.y > 500);
  assert.ok(state.vy > 0);
});
