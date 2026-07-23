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
  assert.ok(
    Math.abs(
      Physics.groundFrictionAcceleration(physics, { motionScale: 100 }) - 490
    ) < 1e-9
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

test("motionScale компенсирует вертикальное ускорение и drag speed", () => {
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
    Physics.dragVerticalSpeed(physics, 1, { motionScale: 10 }),
    Physics.dragVerticalSpeed(physics, 1) * 10
  );
  assert.equal(Physics.canLift(physics, 1), false);
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

test("инерция использует шкалу от 0 до 2", () => {
  assert.equal(Physics.sanitizePhysics({ inertia: -1 }).inertia, 0);
  assert.equal(Physics.sanitizePhysics({ inertia: 1.5 }).inertia, 1.5);
  assert.equal(Physics.sanitizePhysics({ inertia: 3 }).inertia, 2);
});

test("старая шкала инерции мигрирует без потери значения", () => {
  assert.equal(
    Physics.sanitizePhysics(Physics.migratePhysics({ inertia: 0.9 }, 1)).inertia,
    0.9
  );
  assert.equal(
    Physics.sanitizePhysics(Physics.migratePhysics({ inertia: 9 }, 7)).inertia,
    0.9
  );
  assert.equal(
    Physics.sanitizePhysics(Physics.migratePhysics({ inertia: 90 }, 6)).inertia,
    0.9
  );
  assert.equal(
    Physics.sanitizePhysics(Physics.migratePhysics({ inertia: 1.4 }, 8)).inertia,
    1.4
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
  const physics = Physics.sanitizePhysics({ inertia: 2, turbulence: 0 });

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
    pointerInfluence: 1,
  });

  Physics.applyReleaseImpulse(state, physics, 300, -500);

  assert.ok(state.vx > 0);
  assert.ok(state.vy < -500);
  assert.equal(state.dragging, false);
});

test("влияние рывка масштабирует импульс отпускания", () => {
  const none = Physics.sanitizeState({ phase: Physics.PHASES.PLAY });
  const normal = Physics.sanitizeState({ phase: Physics.PHASES.PLAY });
  const boosted = Physics.sanitizeState({ phase: Physics.PHASES.PLAY });
  const base = {
    mass: 10,
    handForce: 1,
    inertia: 1,
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
  assert.equal(Math.round(normal.vx * 1000), 2100);
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
  const base = {
    mass: 4,
    handForce: 4,
    pointerInfluence: 1,
    turbulence: 0,
  };

  Physics.applyReleaseImpulse(
    half,
    Physics.sanitizePhysics({ ...base, inertia: 0.5 }),
    300,
    -400
  );
  Physics.applyReleaseImpulse(
    full,
    Physics.sanitizePhysics({ ...base, inertia: 1 }),
    300,
    -400
  );
  Physics.applyReleaseImpulse(
    low,
    Physics.sanitizePhysics({ ...base, inertia: 0.1 }),
    300,
    -400
  );
  Physics.applyReleaseImpulse(
    none,
    Physics.sanitizePhysics({ ...base, inertia: 0 }),
    300,
    -400
  );

  assert.ok(half.vx > 0);
  assert.ok(half.vy < 0);
  assert.equal(full.vx, half.vx * 2);
  assert.equal(full.vy, half.vy * 4);
  assert.equal(Math.round(full.vx * 1000), 63000);
  assert.equal(Math.round(full.vy * 1000), -84000);
  assert.ok(Math.abs(low.vy) < Math.abs(full.vy) * 0.02);
  assert.equal(none.vx, 0);
  assert.equal(none.vy, 0);
});

test("трение земли заметно и монотонно гасит инерцию", () => {
  function simulateGroundFriction(groundFriction, seconds) {
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
        motionScale: 100,
      });
    }
    return state;
  }

  const icy = simulateGroundFriction(0, 1);
  const medium = simulateGroundFriction(0.5, 1);
  const rough = simulateGroundFriction(1, 1);
  const stopped = simulateGroundFriction(1, 2);

  assert.ok(icy.vx > 800);
  assert.ok(medium.vx < icy.vx * 0.6);
  assert.ok(medium.vx > rough.vx);
  assert.equal(rough.vx, 0);
  assert.equal(stopped.vx, 0);
});

test("максимальное трение блокирует проскальзывание по земле", () => {
  [0, 0.1, 1, 2].forEach((inertia) => {
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
