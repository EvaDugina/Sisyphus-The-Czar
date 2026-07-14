(function attachPhysics(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SisyphusPhysics = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createPhysics() {
  "use strict";

  const PHASES = Object.freeze({
    INTRO: "intro",
    FALLING: "fallingToBottom",
    PLAY: "play",
    WON: "won",
  });

  const WORLD_WIDTH = 1000;
  const WORLD_HEIGHT = 2000;
  const IMPRINT_TOLERANCE_FRACTION = 0.12;
  const DEFAULT_IMPRINT_TOLERANCE_X = 100;
  const DEFAULT_IMPRINT_TOLERANCE_Y = 80;
  const MAX_IMPRINT_TOLERANCE_Y = 1000;
  const FIXED_STEP_SECONDS = 1 / 60;
  const FIRST_FALL_DELAY_MS = 400;
  const GRAVITY_UNITS = 1260;
  const FIRST_FALL_DRIFT_MIN = 160;
  const FIRST_FALL_DRIFT_RANGE = 240;
  const LIFT_SCALE = 0.42;
  const INERTIA_MIN_RETENTION = 0.35;
  const INERTIA_MAX_RETENTION = 0.995;
  const FLOOR_FRICTION_MIN_RETENTION = 0.08;
  const FLOOR_FRICTION_MAX_RETENTION = 1;
  const BOUNCE_MIN_VELOCITY = 120;
  const BOUNCE_IMPACT_CAP = 900;
  const TURB_ACCEL = 1600;

  const PHYSICS_LIMITS = Object.freeze({
    mass: [1, 100],
    gravity: [1, 10],
    handForce: [1, 10],
    pointerInfluence: [0, 2],
    bounce: [0, 1],
    inertia: [0, 1],
    sliding: [0, 1],
    turbulence: [0, 1],
  });

  const DEFAULT_PHYSICS = Object.freeze({
    mass: 4,
    gravity: 1,
    handForce: 5,
    pointerInfluence: 1,
    bounce: 0.35,
    inertia: 0.9,
    sliding: 0.35,
    turbulence: 0.4,
  });

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function sanitizePhysics(input, fallback = DEFAULT_PHYSICS) {
    const source = input && typeof input === "object" ? input : {};
    const clean = {};

    Object.entries(PHYSICS_LIMITS).forEach(([key, [min, max]]) => {
      const base = finiteNumber(fallback[key], DEFAULT_PHYSICS[key]);
      clean[key] = clamp(finiteNumber(source[key], base), min, max);
    });

    return clean;
  }

  function sanitizeState(input) {
    const source = input && typeof input === "object" ? input : {};
    const phase = Object.values(PHASES).includes(source.phase)
      ? source.phase
      : PHASES.INTRO;

    return {
      phase,
      x: clamp(finiteNumber(source.x, WORLD_WIDTH / 2), 0, WORLD_WIDTH),
      y: clamp(finiteNumber(source.y, WORLD_HEIGHT * 0.11), 0, WORLD_HEIGHT),
      vx: clamp(finiteNumber(source.vx, 0), -4000, 4000),
      vy: clamp(finiteNumber(source.vy, 0), -9000, 9000),
      dragging: false,
      controllerId: null,
      turbTime: clamp(finiteNumber(source.turbTime, 0), 0, 1_000_000),
    };
  }

  function maxHoldMs(physics) {
    return clamp(
      (3000 * physics.handForce) / (physics.mass * physics.gravity * 5),
      500,
      3000
    );
  }

  function sanitizeImprint(input) {
    if (!input || typeof input !== "object") {
      return null;
    }
    const x = Number(input.x);
    const y = Number(input.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    return {
      x: clamp(x, 0, WORLD_WIDTH),
      y: clamp(y, 0, WORLD_HEIGHT),
      toleranceX: clamp(
        finiteNumber(input.toleranceX, DEFAULT_IMPRINT_TOLERANCE_X),
        1,
        WORLD_WIDTH
      ),
      toleranceY: clamp(
        finiteNumber(input.toleranceY, DEFAULT_IMPRINT_TOLERANCE_Y),
        1,
        MAX_IMPRINT_TOLERANCE_Y
      ),
    };
  }

  function createImprintAtState(state, input = {}) {
    return sanitizeImprint({
      x: state.x,
      y: state.y,
      toleranceX: input.toleranceX,
      toleranceY: input.toleranceY,
    });
  }

  function finishAtImprint(state, imprint) {
    const target = sanitizeImprint(imprint);
    if (
      state.phase !== PHASES.PLAY ||
      target === null ||
      Math.abs(state.x - target.x) > target.toleranceX ||
      Math.abs(state.y - target.y) > target.toleranceY
    ) {
      return false;
    }

    state.phase = PHASES.WON;
    state.x = target.x;
    state.y = target.y;
    state.vx = 0;
    state.vy = 0;
    state.dragging = false;
    state.controllerId = null;
    return true;
  }

  function beginFirstFall(state, random = Math.random) {
    if (state.phase !== PHASES.INTRO) {
      return false;
    }

    const direction = random() < 0.5 ? -1 : 1;
    state.phase = PHASES.FALLING;
    state.dragging = false;
    state.controllerId = null;
    state.vx =
      direction * (FIRST_FALL_DRIFT_MIN + random() * FIRST_FALL_DRIFT_RANGE);
    state.vy = 120;
    return true;
  }

  function applyReleaseImpulse(state, physics, pointerVx, pointerVy) {
    const safeVx = clamp(finiteNumber(pointerVx, 0), -4000, 4000);
    const safeVy = clamp(finiteNumber(pointerVy, 0), -9000, 9000);
    const strength = physics.handForce / physics.mass;
    const influence = physics.pointerInfluence;
    const liftBoost = Math.max(0, -safeVy) * strength * LIFT_SCALE * influence;
    const horizontalBoost = safeVx * strength * 0.18 * influence;

    state.vx = clamp(horizontalBoost, -900, 900);
    state.vy = clamp(safeVy * 0.18 * influence - liftBoost, -1800, 900);
    state.dragging = false;
    state.controllerId = null;
  }

  function stepState(state, physics, deltaSeconds) {
    if (
      state.dragging ||
      state.phase === PHASES.INTRO ||
      state.phase === PHASES.WON
    ) {
      return false;
    }

    const dt = clamp(finiteNumber(deltaSeconds, 0), 0, 0.05);
    if (dt === 0) {
      return false;
    }

    state.vy += GRAVITY_UNITS * physics.gravity * dt;

    if (physics.turbulence > 0 && state.y < WORLD_HEIGHT - 1) {
      state.turbTime += dt;
      const t = state.turbTime;
      const strength = physics.turbulence * TURB_ACCEL;
      state.vx +=
        strength * (Math.sin(t * 5.3) + 0.6 * Math.sin(t * 11.7 + 1.3)) * dt;
      state.vy += strength * 0.35 * Math.sin(t * 4.1 + 2.6) * dt;
    }

    state.x += state.vx * dt;
    state.y += state.vy * dt;

    const inertiaRetentionPerSecond =
      INERTIA_MIN_RETENTION +
      physics.inertia * (INERTIA_MAX_RETENTION - INERTIA_MIN_RETENTION);
    state.vx *= Math.pow(inertiaRetentionPerSecond, dt);

    if (state.x <= 0 || state.x >= WORLD_WIDTH) {
      state.x = clamp(state.x, 0, WORLD_WIDTH);
      state.vx *= -0.24;
    }

    if (state.y >= WORLD_HEIGHT) {
      state.y = WORLD_HEIGHT;

      const floorRetentionPerSecond =
        FLOOR_FRICTION_MAX_RETENTION -
        physics.sliding * (FLOOR_FRICTION_MAX_RETENTION - FLOOR_FRICTION_MIN_RETENTION);
      state.vx *= Math.pow(floorRetentionPerSecond, dt);

      if (physics.bounce > 0 && state.vy > BOUNCE_MIN_VELOCITY) {
        const impact = Math.min(state.vy, BOUNCE_IMPACT_CAP);
        state.vy = -impact * physics.bounce;
      } else {
        state.vy = 0;
        if (state.phase === PHASES.FALLING) {
          state.phase = PHASES.PLAY;
        }
      }
    }

    if (state.y <= 0) {
      state.y = 0;
      state.vy = Math.max(0, state.vy * -0.18);
    }

    if (Math.abs(state.vx) < 0.5 && state.y >= WORLD_HEIGHT - 0.01) {
      state.vx = 0;
    }

    return true;
  }

  function isMoving(state) {
    if (state.dragging || state.phase === PHASES.FALLING) {
      return true;
    }
    if (state.phase !== PHASES.PLAY) {
      return false;
    }
    return (
      state.y < WORLD_HEIGHT - 0.01 ||
      Math.abs(state.vx) >= 0.5 ||
      Math.abs(state.vy) >= 0.5
    );
  }

  return Object.freeze({
    PHASES,
    WORLD_WIDTH,
    WORLD_HEIGHT,
    IMPRINT_TOLERANCE_FRACTION,
    FIXED_STEP_SECONDS,
    FIRST_FALL_DELAY_MS,
    DEFAULT_PHYSICS,
    PHYSICS_LIMITS,
    clamp,
    sanitizePhysics,
    sanitizeState,
    maxHoldMs,
    sanitizeImprint,
    createImprintAtState,
    finishAtImprint,
    beginFirstFall,
    applyReleaseImpulse,
    stepState,
    isMoving,
  });
});
