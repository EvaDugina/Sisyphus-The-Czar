const DIRECTION_EPSILON = 0.5;

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
