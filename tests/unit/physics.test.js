"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Physics = require("../../shared/physics");

test("масса поддерживает значения до 100", () => {
  assert.equal(Physics.sanitizePhysics({ mass: 100 }).mass, 100);
  assert.equal(Physics.sanitizePhysics({ mass: 101 }).mass, 100);
});

test("тяготение ограничивается диапазоном от 1 до 10", () => {
  assert.equal(Physics.sanitizePhysics({ gravity: 0.4 }).gravity, 1);
  assert.equal(Physics.sanitizePhysics({ gravity: 10 }).gravity, 10);
  assert.equal(Physics.sanitizePhysics({ gravity: 11 }).gravity, 10);
});

test("первое падение получает серверный случайный импульс", () => {
  const state = Physics.sanitizeState({ phase: Physics.PHASES.INTRO, x: 500, y: 500 });
  const values = [0.9, 0.5];

  assert.equal(Physics.beginFirstFall(state, () => values.shift()), true);
  assert.equal(state.phase, Physics.PHASES.FALLING);
  assert.equal(state.dragging, false);
  assert.equal(state.vx, 280);
  assert.equal(state.vy, 120);
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
