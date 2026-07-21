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
  const FIRST_FALL_DELAY_MS = 2000;
  const DRAG_LIFT = Object.freeze({
    baseSpeed: 420,
    forceSpeed: 880,
    minSpeed: 220,
    maxSpeed: 2800,
    loadFloor: 0.1,
  });
  const PHYSICS_VERSION = 6;
  const RELEASE_TRANSFER_SCALE = 0.42;
  const AIR_RETENTION_PER_SECOND = 0.9305;
  const MAX_RELEASE_HORIZONTAL_SPEED = 900;
  const MAX_RELEASE_UPWARD_SPEED = 1800;
  const MAX_RELEASE_DOWNWARD_SPEED = 900;
  const BOUNCE_MIN_VELOCITY = 120;
  const BOUNCE_IMPACT_CAP = 900;
  const TURB_ACCEL = 1600;

  const PHYSICS_LIMITS = Object.freeze({
    mass: [0.1, 100],
    gravity: [0.1, 100],
    firstFallVelocity: [-10, 10],
    handForce: [1, 100],
    pointerInfluence: [0, 2],
    bounce: [0, 1],
    inertia: [0, 100],
    groundFriction: [0, 1],
    turbulence: [0, 1],
  });

  const DEFAULT_PHYSICS = Object.freeze({
    mass: 1,
    gravity: 9.8,
    firstFallVelocity: 0,
    handForce: 50,
    pointerInfluence: 1,
    bounce: 0.35,
    inertia: 90,
    groundFriction: 0.35,
    turbulence: 0.4,
  });

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function hasOwn(source, key) {
    return Object.prototype.hasOwnProperty.call(source, key);
  }

  function normalizePhysicsInput(input) {
    const source = input && typeof input === "object" ? { ...input } : {};
    if (!hasOwn(source, "groundFriction") && hasOwn(source, "sliding")) {
      source.groundFriction = source.sliding;
    }
    return source;
  }

  function sanitizePhysics(input, fallback = DEFAULT_PHYSICS) {
    const source = normalizePhysicsInput(input);
    const clean = {};

    Object.entries(PHYSICS_LIMITS).forEach(([key, [min, max]]) => {
      const base = finiteNumber(fallback[key], DEFAULT_PHYSICS[key]);
      clean[key] = clamp(finiteNumber(source[key], base), min, max);
    });

    return clean;
  }

  function migratePhysics(input, version = 1) {
    const source = normalizePhysicsInput(input);
    const sourceVersion = finiteNumber(version, 1);
    const inertia = Number(source.inertia);
    if (
      sourceVersion < 2 &&
      Number.isFinite(inertia) &&
      inertia >= 0 &&
      inertia <= 1
    ) {
      source.inertia = inertia * 100;
    }
    const handForce = Number(source.handForce);
    if (
      sourceVersion < 6 &&
      Number.isFinite(handForce) &&
      handForce >= 0.1 &&
      handForce <= 10
    ) {
      source.handForce = handForce * 10;
    }
    return source;
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

  function gravityForce(physics) {
    const params = sanitizePhysics(physics);
    return params.mass * params.gravity;
  }

  function gravityAcceleration(physics) {
    const params = sanitizePhysics(physics);
    return gravityForce(params) / params.mass;
  }

  function effectiveHandForce(physics) {
    const params = sanitizePhysics(physics);
    return params.handForce;
  }

  function normalizeHandCount(handCount) {
    return Math.max(0, Math.floor(finiteNumber(handCount, 1)));
  }

  function totalHandForce(physics, handCount = 1) {
    return effectiveHandForce(physics) * normalizeHandCount(handCount);
  }

  function liftForceSurplus(physics, handCount = 1) {
    return totalHandForce(physics, handCount) - gravityForce(physics);
  }

  function canLift(physics, handCount = 1) {
    return liftForceSurplus(physics, handCount) > 0;
  }

  function handAcceleration(physics) {
    const params = sanitizePhysics(physics);
    return effectiveHandForce(params) / params.mass;
  }

  function groundFrictionAcceleration(physics) {
    const params = sanitizePhysics(physics);
    return (params.groundFriction * gravityForce(params)) / params.mass;
  }

  function maxHoldMs(physics, handCount = 1) {
    const params = sanitizePhysics(physics);
    const load = Math.max(gravityForce(params), DRAG_LIFT.loadFloor);
    return clamp(
      (3000 * totalHandForce(params, handCount)) / (load * 5),
      500,
      3000
    );
  }

  function dragLiftSpeed(physics, handCount = 1) {
    const params = sanitizePhysics(physics);
    const load = Math.max(gravityForce(params), DRAG_LIFT.loadFloor);
    const surplus = liftForceSurplus(params, handCount);
    if (surplus <= 0) {
      return 0;
    }
    return clamp(
      DRAG_LIFT.minSpeed + (DRAG_LIFT.forceSpeed * surplus) / (load * 5),
      DRAG_LIFT.minSpeed,
      DRAG_LIFT.maxSpeed
    );
  }

  function dragDropSpeed(physics, handCount = 1) {
    const params = sanitizePhysics(physics);
    const load = Math.max(gravityForce(params), DRAG_LIFT.loadFloor);
    const deficit = Math.max(0, -liftForceSurplus(params, handCount));
    return clamp(
      DRAG_LIFT.minSpeed + (DRAG_LIFT.forceSpeed * deficit) / (load * 5),
      DRAG_LIFT.minSpeed,
      DRAG_LIFT.maxSpeed
    );
  }

  function dragVerticalSpeed(physics, handCount = 1) {
    return canLift(physics, handCount)
      ? -dragLiftSpeed(physics, handCount)
      : dragDropSpeed(physics, handCount);
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

  function stateInsideImprint(state, imprint) {
    const target = sanitizeImprint(imprint);
    return Boolean(
      state.phase === PHASES.PLAY &&
        target !== null &&
        Math.abs(state.x - target.x) <= target.toleranceX &&
        Math.abs(state.y - target.y) <= target.toleranceY
    );
  }

  function beginFirstFall(state, physics = DEFAULT_PHYSICS) {
    if (state.phase !== PHASES.INTRO) {
      return false;
    }

    const params = sanitizePhysics(physics);
    state.phase = PHASES.FALLING;
    state.vx = 0;
    state.vy = params.firstFallVelocity;
    state.dragging = false;
    state.controllerId = null;
    return true;
  }

  function applyReleaseImpulse(state, physics, pointerVx, pointerVy) {
    const safeVx = clamp(finiteNumber(pointerVx, 0), -4000, 4000);
    const safeVy = clamp(finiteNumber(pointerVy, 0), -9000, 9000);
    const strength = handAcceleration(physics);
    const influence = physics.pointerInfluence;
    const inertiaFraction = physics.inertia / 100;
    const transfer =
      strength * influence * inertiaFraction * RELEASE_TRANSFER_SCALE;
    const releaseVx = safeVx * transfer;
    const releaseVy = safeVy * transfer;
    const verticalLimit =
      releaseVy < 0
        ? MAX_RELEASE_UPWARD_SPEED
        : MAX_RELEASE_DOWNWARD_SPEED;
    const limitScale = Math.min(
      1,
      Math.abs(releaseVx) > 0
        ? MAX_RELEASE_HORIZONTAL_SPEED / Math.abs(releaseVx)
        : 1,
      Math.abs(releaseVy) > 0 ? verticalLimit / Math.abs(releaseVy) : 1
    );

    state.vx = releaseVx === 0 ? 0 : releaseVx * limitScale;
    state.vy = releaseVy === 0 ? 0 : releaseVy * limitScale;
    state.dragging = false;
    state.controllerId = null;
  }

  function applyGroundFriction(state, physics, dt) {
    if (physics.groundFriction <= 0 || state.vx === 0) {
      return;
    }

    const slowdown = groundFrictionAcceleration(physics) * dt;
    if (Math.abs(state.vx) <= slowdown) {
      state.vx = 0;
      return;
    }

    state.vx -= Math.sign(state.vx) * slowdown;
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

    state.vy += gravityAcceleration(physics) * dt;

    if (physics.turbulence > 0 && state.y < WORLD_HEIGHT - 1) {
      state.turbTime += dt;
      const t = state.turbTime;
      const strength = physics.turbulence * TURB_ACCEL;
      state.vx +=
        strength * (Math.sin(t * 5.3) + 0.6 * Math.sin(t * 11.7 + 1.3)) * dt;
    }

    state.x += state.vx * dt;
    state.y += state.vy * dt;

    state.vx *= Math.pow(AIR_RETENTION_PER_SECOND, dt);

    if (state.x <= 0 || state.x >= WORLD_WIDTH) {
      state.x = clamp(state.x, 0, WORLD_WIDTH);
      state.vx *= -0.24;
    }

    if (state.y >= WORLD_HEIGHT) {
      state.y = WORLD_HEIGHT;
      applyGroundFriction(state, physics, dt);

      if (state.phase === PHASES.FALLING) {
        state.phase = PHASES.PLAY;
      }

      if (physics.bounce > 0 && state.vy > BOUNCE_MIN_VELOCITY) {
        const impact = Math.min(state.vy, BOUNCE_IMPACT_CAP);
        state.vy = -impact * physics.bounce;
      } else {
        state.vy = 0;
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
    PHYSICS_VERSION,
    DRAG_LIFT,
    IMPRINT_TOLERANCE_FRACTION,
    FIXED_STEP_SECONDS,
    FIRST_FALL_DELAY_MS,
    DEFAULT_PHYSICS,
    PHYSICS_LIMITS,
    clamp,
    sanitizePhysics,
    migratePhysics,
    sanitizeState,
    gravityForce,
    gravityAcceleration,
    effectiveHandForce,
    totalHandForce,
    liftForceSurplus,
    canLift,
    handAcceleration,
    groundFrictionAcceleration,
    maxHoldMs,
    dragLiftSpeed,
    dragDropSpeed,
    dragVerticalSpeed,
    sanitizeImprint,
    createImprintAtState,
    stateInsideImprint,
    beginFirstFall,
    applyReleaseImpulse,
    stepState,
    isMoving,
  });
});
