import {
  cubicBezierYForX,
  parseCubicBezier,
} from "./rockScale.mjs";

const DIRECTION_EPSILON = 0.5;
const LINEAR_CURVE = Object.freeze([0, 0, 1, 1]);

export const PRECLICK_MOVEMENT_SPEED_THRESHOLD_PX_PER_SECOND = 12;
export const PRECLICK_MOVEMENT_MAX_SAMPLE_GAP_MS = 120;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function activePreclickMovementDeltaMs({
  previousX,
  previousY,
  previousAtMs,
  x,
  y,
  atMs,
  speedThresholdPxPerSecond =
    PRECLICK_MOVEMENT_SPEED_THRESHOLD_PX_PER_SECOND,
  maxSampleGapMs = PRECLICK_MOVEMENT_MAX_SAMPLE_GAP_MS,
}) {
  const elapsedMs = Number(atMs) - Number(previousAtMs);
  if (
    !Number.isFinite(elapsedMs) ||
    elapsedMs <= 0 ||
    elapsedMs > Math.max(0, finiteNumber(maxSampleGapMs, 0))
  ) {
    return 0;
  }

  const deltaX = Number(x) - Number(previousX);
  const deltaY = Number(y) - Number(previousY);
  const distance = Math.hypot(deltaX, deltaY);
  if (!Number.isFinite(distance)) {
    return 0;
  }

  const speedPxPerSecond = distance / (elapsedMs / 1000);
  return speedPxPerSecond >= Math.max(
    0,
    finiteNumber(speedThresholdPxPerSecond, 0),
  )
    ? elapsedMs
    : 0;
}

export function calculatePreclickParallaxTransition({
  activeMovementTimeMs,
  durationSeconds,
  startDelayMs,
  endDelayMs,
  delayEasing,
  startMaxOffset,
  endMaxOffset,
  maxOffsetEasing,
}) {
  const durationMs = Math.max(1, finiteNumber(durationSeconds, 1) * 1000);
  const progress = clamp(
    finiteNumber(activeMovementTimeMs, 0) / durationMs,
    0,
    1,
  );
  const delayCurve = parseCubicBezier(delayEasing) || LINEAR_CURVE;
  const maxOffsetCurve = parseCubicBezier(maxOffsetEasing) || LINEAR_CURVE;
  const initialDelay = Math.max(0, finiteNumber(startDelayMs, 0));
  const finalDelay = Math.max(
    initialDelay,
    finiteNumber(endDelayMs, initialDelay),
  );
  const initialMaxOffset = Math.max(0, finiteNumber(startMaxOffset, 0));
  const finalMaxOffset = clamp(
    finiteNumber(endMaxOffset, initialMaxOffset),
    0,
    initialMaxOffset,
  );
  const delayProgress = cubicBezierYForX(progress, delayCurve);
  const maxOffsetProgress = cubicBezierYForX(progress, maxOffsetCurve);

  return {
    progress,
    delayMs:
      initialDelay + (finalDelay - initialDelay) * delayProgress,
    maxOffset:
      initialMaxOffset +
      (finalMaxOffset - initialMaxOffset) * maxOffsetProgress,
  };
}

function normalizedDirection(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  const length = Math.hypot(x, y);
  if (length <= DIRECTION_EPSILON) {
    return null;
  }
  return { x: x / length, y: y / length };
}

export function calculatePreclickParallaxOffset({
  deltaX,
  deltaY,
  activationRadius,
  maxOffset,
  inverted = false,
  lastDirectionX = null,
  lastDirectionY = null,
}) {
  const radius = Number(activationRadius);
  const maximum = Number(maxOffset);
  const x = Number(deltaX);
  const y = Number(deltaY);
  const distance = Math.hypot(x, y);
  const previousDirection = normalizedDirection(
    lastDirectionX,
    lastDirectionY,
  );

  if (
    !Number.isFinite(radius) ||
    radius <= 0 ||
    !Number.isFinite(maximum) ||
    maximum < 0 ||
    !Number.isFinite(distance) ||
    distance > radius
  ) {
    return {
      insideRadius: false,
      x: 0,
      y: 0,
      directionX: previousDirection?.x ?? null,
      directionY: previousDirection?.y ?? null,
    };
  }

  const direction = normalizedDirection(x, y) || previousDirection;
  if (!direction) {
    return {
      insideRadius: true,
      x: 0,
      y: 0,
      directionX: null,
      directionY: null,
    };
  }

  const proximity = Math.min(Math.max(1 - distance / radius, 0), 1);
  const signedMagnitude = maximum * proximity * (inverted ? -1 : 1);
  return {
    insideRadius: true,
    x: direction.x * signedMagnitude,
    y: direction.y * signedMagnitude,
    directionX: direction.x,
    directionY: direction.y,
  };
}
