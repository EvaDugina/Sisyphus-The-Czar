import {
  cubicBezierYForX,
  parseCubicBezier,
} from "./rockScale.mjs";

const DIRECTION_EPSILON = 0.5;
const LINEAR_CURVE = Object.freeze([0, 0, 1, 1]);

export const PRECLICK_MOVEMENT_SPEED_THRESHOLD_PX_PER_SECOND = 12;
export const PRECLICK_MOVEMENT_MAX_SAMPLE_GAP_MS = 120;
export const PRECLICK_HOP_MAX_SPEED_PX_PER_SECOND = 2000;
export const PRECLICK_HOP_MIN_DISTANCE_FACTOR = 0.28;
export const PRECLICK_HOP_MAX_DISTANCE_FACTOR = 1;

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

export function preclickPointerSpeed({
  previousX,
  previousY,
  previousAtMs,
  x,
  y,
  atMs,
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
  const distance = Math.hypot(
    Number(x) - Number(previousX),
    Number(y) - Number(previousY),
  );
  return Number.isFinite(distance) ? distance / (elapsedMs / 1000) : 0;
}

export function preclickHopDistance({
  speedPxPerSecond,
  maxDistance,
  maxSpeedPxPerSecond = PRECLICK_HOP_MAX_SPEED_PX_PER_SECOND,
  minDistanceFactor = PRECLICK_HOP_MIN_DISTANCE_FACTOR,
  maxDistanceFactor = PRECLICK_HOP_MAX_DISTANCE_FACTOR,
}) {
  const maximumDistance = Math.max(0, finiteNumber(maxDistance, 0));
  const maximumSpeed = Math.max(1, finiteNumber(maxSpeedPxPerSecond, 1));
  const speedProgress = clamp(
    Math.max(0, finiteNumber(speedPxPerSecond, 0)) / maximumSpeed,
    0,
    1,
  );
  const minimumFactor = Math.max(0, finiteNumber(minDistanceFactor, 0));
  const maximumFactor = Math.max(
    minimumFactor,
    finiteNumber(maxDistanceFactor, minimumFactor),
  );
  return maximumDistance * (
    minimumFactor + (maximumFactor - minimumFactor) * speedProgress
  );
}

export function wrapPreclickHopCoordinate(value, span) {
  const normalizedSpan = Math.max(0, finiteNumber(span, 0));
  if (normalizedSpan <= 0) {
    return 0;
  }
  const normalizedValue = finiteNumber(value, 0);
  return ((normalizedValue % normalizedSpan) + normalizedSpan) % normalizedSpan;
}

export function wrapPreclickHopCenter({
  x,
  y,
  viewportWidth,
  viewportHeight,
}) {
  return {
    x: wrapPreclickHopCoordinate(x, viewportWidth),
    y: wrapPreclickHopCoordinate(y, viewportHeight),
  };
}

export function calculatePreclickHopTarget({
  pointerX,
  pointerY,
  centerX,
  centerY,
  speedPxPerSecond,
  maxDistance,
  currentOffsetX = 0,
  currentOffsetY = 0,
  lastDirectionX = null,
  lastDirectionY = null,
}) {
  const fallbackDirection = normalizedDirection(
    lastDirectionX,
    lastDirectionY,
  );
  const direction = normalizedDirection(
    Number(centerX) - Number(pointerX),
    Number(centerY) - Number(pointerY),
  ) || fallbackDirection || { x: 1, y: 0 };
  const distance = preclickHopDistance({
    speedPxPerSecond,
    maxDistance,
  });
  const deltaX = direction.x * distance;
  const deltaY = direction.y * distance;

  return {
    x: finiteNumber(currentOffsetX, 0) + deltaX,
    y: finiteNumber(currentOffsetY, 0) + deltaY,
    deltaX,
    deltaY,
    directionX: direction.x,
    directionY: direction.y,
    requestedDistance: distance,
    actualDistance: distance,
  };
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
