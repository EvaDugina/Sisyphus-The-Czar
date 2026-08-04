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
  const DEFAULT_SCENE_HEIGHT_SCREENS = 10;
  const SUMMIT_IMPRINT_TOP_VIEWPORT_FRACTION = 0.5;
  const SUMMIT_IMPRINT_Y =
    WORLD_HEIGHT *
    (SUMMIT_IMPRINT_TOP_VIEWPORT_FRACTION / DEFAULT_SCENE_HEIGHT_SCREENS);
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
  const DEFAULT_FORCE_DEFICIT_CURVE = Object.freeze([0.42, 0, 1, 1]);
  const CUBIC_BEZIER_SOLVE_ITERATIONS = 24;
  const PHYSICS_VERSION = 11;
  const RELEASE_TRANSFER_SCALE = 0.42;
  const HORIZONTAL_INERTIA_EFFECT_SCALE = 0.001;
  const VERTICAL_INERTIA_EFFECT_SCALE = 0.1;
  const RELEASE_UPWARD_INERTIA_EXPONENT = 2;
  const AIR_RETENTION_PER_SECOND = 0.9305;
  const MAX_RELEASE_HORIZONTAL_SPEED = 900;
  const MAX_RELEASE_UPWARD_SPEED = 1800;
  const MAX_RELEASE_DOWNWARD_SPEED = 900;
  const ROCK_JUMP_IMPULSE_DURATION_SECONDS = 4;
  const ROCK_JUMP_MIN_SPEED = 120;
  const BOUNCE_MIN_VELOCITY = 120;
  const BOUNCE_IMPACT_CAP = 900;
  const TURB_ACCEL = 1600;

  const PHYSICS_LIMITS = Object.freeze({
    mass: [0.1, 100],
    gravity: [0.1, 100],
    firstFallVelocity: [-10, 10],
    handForce: [1, 1000],
    pointerInfluence: [0, 10],
    bounce: [0, 1],
    inertia: [0, 1],
    horizontalInertia: [0, 1],
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
    inertia: 0.9,
    horizontalInertia: 0.02,
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

  function motionScale(options) {
    if (!options || typeof options !== "object") {
      return 1;
    }
    return Math.max(0, finiteNumber(options.motionScale, 1));
  }

  function cubicCoordinate(t, point1, point2) {
    const inverse = 1 - t;
    return (
      3 * inverse * inverse * t * point1 +
      3 * inverse * t * t * point2 +
      t * t * t
    );
  }

  function normalizeCubicBezierPoints(points) {
    if (!Array.isArray(points) || points.length !== 4) {
      return DEFAULT_FORCE_DEFICIT_CURVE;
    }
    const clean = points.map(Number);
    if (
      !clean.every(Number.isFinite) ||
      clean[0] < 0 ||
      clean[0] > 1 ||
      clean[2] < 0 ||
      clean[2] > 1
    ) {
      return DEFAULT_FORCE_DEFICIT_CURVE;
    }
    return clean;
  }

  function cubicBezierProgress(progress, points = DEFAULT_FORCE_DEFICIT_CURVE) {
    const targetX = clamp(finiteNumber(progress, 0), 0, 1);
    if (targetX === 0 || targetX === 1) {
      return targetX;
    }
    const [x1, y1, x2, y2] = normalizeCubicBezierPoints(points);
    let lower = 0;
    let upper = 1;
    for (let index = 0; index < CUBIC_BEZIER_SOLVE_ITERATIONS; index += 1) {
      const midpoint = (lower + upper) / 2;
      if (cubicCoordinate(midpoint, x1, x2) < targetX) {
        lower = midpoint;
      } else {
        upper = midpoint;
      }
    }
    return clamp(cubicCoordinate((lower + upper) / 2, y1, y2), 0, 1);
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
      source.inertia = inertia * 10;
    } else if (
      sourceVersion < 7 &&
      Number.isFinite(inertia) &&
      inertia > 10 &&
      inertia <= 100
    ) {
      source.inertia = inertia / 10;
    }
    const migratedInertia = Number(source.inertia);
    if (sourceVersion < 8 && Number.isFinite(migratedInertia)) {
      source.inertia = migratedInertia / 10;
    }
    const currentScaleInertia = Number(source.inertia);
    if (sourceVersion < 9 && Number.isFinite(currentScaleInertia)) {
      source.inertia = currentScaleInertia / 10;
    }
    const displayScaleInertia = Number(source.inertia);
    if (sourceVersion < 10 && Number.isFinite(displayScaleInertia)) {
      source.inertia = displayScaleInertia * 10;
    }
    if (!hasOwn(source, "horizontalInertia")) {
      source.horizontalInertia = DEFAULT_PHYSICS.horizontalInertia;
    } else if (sourceVersion < 9) {
      const horizontalInertia = Number(source.horizontalInertia);
      if (Number.isFinite(horizontalInertia) && horizontalInertia > 0.1) {
        source.horizontalInertia = horizontalInertia / 10;
      }
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
      suspended: phase === PHASES.PLAY && Boolean(source.suspended),
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

  function liftForceSurplus(physics) {
    return effectiveHandForce(physics) - gravityForce(physics);
  }

  function handForceRatio(physics) {
    const params = sanitizePhysics(physics);
    return clamp(
      effectiveHandForce(params) / gravityForce(params),
      0,
      1
    );
  }

  function canLift(physics) {
    return liftForceSurplus(physics) >= 0;
  }

  function handAcceleration(physics) {
    const params = sanitizePhysics(physics);
    return effectiveHandForce(params) / params.mass;
  }

  function groundFrictionAcceleration(physics, options) {
    const params = sanitizePhysics(physics);
    return (
      ((params.groundFriction * gravityForce(params)) / params.mass) *
      motionScale(options)
    );
  }

  function maxHoldMs(physics) {
    const params = sanitizePhysics(physics);
    const load = Math.max(gravityForce(params), DRAG_LIFT.loadFloor);
    return clamp(
      (3000 * effectiveHandForce(params)) / (load * 5),
      500,
      3000
    );
  }

  function dragLiftSpeed(physics, options) {
    const params = sanitizePhysics(physics);
    const load = Math.max(gravityForce(params), DRAG_LIFT.loadFloor);
    const surplus = liftForceSurplus(params);
    if (surplus <= 0) {
      return 0;
    }
    const speed = clamp(
      DRAG_LIFT.minSpeed + (DRAG_LIFT.forceSpeed * surplus) / (load * 5),
      DRAG_LIFT.minSpeed,
      DRAG_LIFT.maxSpeed
    );
    return speed * motionScale(options);
  }

  function dragDropSpeed(physics, options) {
    const params = sanitizePhysics(physics);
    const load = Math.max(gravityForce(params), DRAG_LIFT.loadFloor);
    const deficit = Math.max(0, -liftForceSurplus(params));
    const speed = clamp(
      DRAG_LIFT.minSpeed + (DRAG_LIFT.forceSpeed * deficit) / (load * 5),
      DRAG_LIFT.minSpeed,
      DRAG_LIFT.maxSpeed
    );
    return speed * motionScale(options);
  }

  function dragDeficitLiftSpeed(physics, options) {
    const params = sanitizePhysics(physics);
    if (liftForceSurplus(params) >= 0) {
      return 0;
    }
    const multiplier = cubicBezierProgress(
      handForceRatio(params),
      options?.forceDeficitCurve
    );
    return DRAG_LIFT.minSpeed * multiplier * motionScale(options);
  }

  function dragVerticalSpeed(physics, options) {
    return canLift(physics)
      ? -dragLiftSpeed(physics, options)
      : -dragDeficitLiftSpeed(physics, options);
  }

  function dragFollowProgress(physics, deltaSeconds, options) {
    const params = sanitizePhysics(physics);
    const dt = clamp(finiteNumber(deltaSeconds, 0), 0, 0.25);
    if (dt === 0) {
      return 0;
    }
    const response = cubicBezierProgress(
      handForceRatio(params),
      options?.forceDeficitCurve
    );
    if (response <= 0) {
      return 0;
    }
    if (response >= 1) {
      return 1;
    }
    return clamp(
      1 - Math.pow(1 - response, dt / FIXED_STEP_SECONDS),
      0,
      1
    );
  }

  function stepDragState(state, physics, targetX, targetY, deltaSeconds, options) {
    if (!state || state.phase !== PHASES.PLAY) {
      return false;
    }
    const dt = clamp(finiteNumber(deltaSeconds, 0), 0, 0.05);
    if (dt === 0) {
      return false;
    }
    const progress = dragFollowProgress(physics, dt, options);
    const previousX = finiteNumber(state.x, WORLD_WIDTH / 2);
    const previousY = finiteNumber(state.y, WORLD_HEIGHT);
    const cleanTargetX = clamp(
      finiteNumber(targetX, previousX),
      0,
      WORLD_WIDTH
    );
    const cleanTargetY = clamp(
      finiteNumber(targetY, previousY),
      0,
      WORLD_HEIGHT
    );
    state.x = clamp(
      previousX + (cleanTargetX - previousX) * progress,
      0,
      WORLD_WIDTH
    );
    state.y = clamp(
      previousY + (cleanTargetY - previousY) * progress,
      0,
      WORLD_HEIGHT
    );
    state.vx = (state.x - previousX) / dt;
    state.vy = (state.y - previousY) / dt;
    state.dragging = true;
    state.suspended = false;
    return state.x !== previousX || state.y !== previousY;
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

  function createSummitImprint(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    return sanitizeImprint({
      x: WORLD_WIDTH / 2,
      y: hasOwn(source, "y")
        ? finiteNumber(source.y, SUMMIT_IMPRINT_Y)
        : SUMMIT_IMPRINT_Y,
      toleranceX: source.toleranceX,
      toleranceY: source.toleranceY,
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

  function beginFirstFall(state, physics = DEFAULT_PHYSICS, options) {
    if (state.phase !== PHASES.INTRO) {
      return false;
    }

    const params = sanitizePhysics(physics);
    state.phase = PHASES.FALLING;
    state.vx = 0;
    state.vy = params.firstFallVelocity * motionScale(options);
    state.dragging = false;
    state.controllerId = null;
    state.suspended = false;
    return true;
  }

  function beginFinalFall(state) {
    if (state.phase !== PHASES.PLAY) {
      return false;
    }

    state.phase = PHASES.FALLING;
    state.vx = 0;
    state.vy = Math.max(0, finiteNumber(state.vy, 0));
    state.dragging = false;
    state.controllerId = null;
    state.suspended = false;
    return true;
  }

  function applyReleaseImpulse(state, physics, pointerVx, pointerVy) {
    const safeVx = clamp(finiteNumber(pointerVx, 0), -4000, 4000);
    const safeVy = clamp(finiteNumber(pointerVy, 0), -9000, 9000);
    const strength = handAcceleration(physics);
    const influence = physics.pointerInfluence;
    const horizontalInertia =
      physics.horizontalInertia * HORIZONTAL_INERTIA_EFFECT_SCALE;
    const verticalInertia = physics.inertia * VERTICAL_INERTIA_EFFECT_SCALE;
    const horizontalTransfer =
      strength * influence * horizontalInertia * RELEASE_TRANSFER_SCALE;
    const verticalInertiaMultiplier =
      safeVy < 0
        ? Math.pow(verticalInertia, RELEASE_UPWARD_INERTIA_EXPONENT)
        : verticalInertia;
    const verticalTransfer =
      strength * influence * verticalInertiaMultiplier * RELEASE_TRANSFER_SCALE;
    const releaseVx = safeVx * horizontalTransfer;
    const releaseVy = safeVy * verticalTransfer;
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
    state.suspended = false;
  }

  function applyRockJumpImpulse(
    state,
    physics,
    angleDegrees = 0,
    inertiaFactor = 1
  ) {
    const params = sanitizePhysics(physics);
    const angle = clamp(finiteNumber(angleDegrees, 0), -45, 45);
    const factor = clamp(finiteNumber(inertiaFactor, 1), 0, 2);
    const baseImpulse =
      effectiveHandForce(params) *
      ROCK_JUMP_IMPULSE_DURATION_SECONDS *
      params.inertia;
    const speed = clamp(
      (baseImpulse / params.mass) * factor,
      ROCK_JUMP_MIN_SPEED,
      MAX_RELEASE_UPWARD_SPEED
    );
    const radians = (angle * Math.PI) / 180;

    state.vx = speed * Math.sin(radians);
    state.vy = -speed * Math.cos(radians);
    state.dragging = false;
    state.controllerId = null;
    state.suspended = false;

    return {
      angleDegrees: angle,
      inertiaFactor: factor,
      speed,
    };
  }

  function applyGroundFriction(state, physics, dt, options) {
    if (physics.groundFriction <= 0 || state.vx === 0) {
      return;
    }
    if (physics.groundFriction >= 1) {
      state.vx = 0;
      return;
    }

    const slowdown = groundFrictionAcceleration(physics, options) * dt;
    if (Math.abs(state.vx) <= slowdown) {
      state.vx = 0;
      return;
    }

    state.vx -= Math.sign(state.vx) * slowdown;
  }

  function stepState(state, physics, deltaSeconds, options) {
    if (
      state.dragging ||
      state.suspended ||
      state.phase === PHASES.INTRO ||
      state.phase === PHASES.WON
    ) {
      return false;
    }

    const dt = clamp(finiteNumber(deltaSeconds, 0), 0, 0.05);
    if (dt === 0) {
      return false;
    }

    state.vy += gravityAcceleration(physics) * motionScale(options) * dt;

    if (physics.turbulence > 0 && state.y < WORLD_HEIGHT - 1) {
      state.turbTime += dt;
      const t = state.turbTime;
      const strength = physics.turbulence * TURB_ACCEL;
      state.vx +=
        strength * (Math.sin(t * 5.3) + 0.6 * Math.sin(t * 11.7 + 1.3)) * dt;
    }

    if (physics.groundFriction >= 1 && state.y >= WORLD_HEIGHT - 0.01) {
      state.vx = 0;
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
      applyGroundFriction(state, physics, dt, options);

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
    if (state.suspended) {
      return false;
    }
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
    DEFAULT_FORCE_DEFICIT_CURVE,
    IMPRINT_TOLERANCE_FRACTION,
    FIXED_STEP_SECONDS,
    FIRST_FALL_DELAY_MS,
    DEFAULT_PHYSICS,
    PHYSICS_LIMITS,
    ROCK_JUMP_IMPULSE_DURATION_SECONDS,
    ROCK_JUMP_MIN_SPEED,
    clamp,
    sanitizePhysics,
    migratePhysics,
    sanitizeState,
    gravityForce,
    gravityAcceleration,
    effectiveHandForce,
    liftForceSurplus,
    handForceRatio,
    canLift,
    handAcceleration,
    groundFrictionAcceleration,
    maxHoldMs,
    dragLiftSpeed,
    dragDropSpeed,
    dragDeficitLiftSpeed,
    dragVerticalSpeed,
    dragFollowProgress,
    stepDragState,
    cubicBezierProgress,
    sanitizeImprint,
    createImprintAtState,
    createSummitImprint,
    stateInsideImprint,
    beginFirstFall,
    beginFinalFall,
    applyReleaseImpulse,
    applyRockJumpImpulse,
    stepState,
    isMoving,
  });
});
