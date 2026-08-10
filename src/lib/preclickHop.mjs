const DIRECTION_EPSILON = 0.5;
const PATH_EPSILON = 1e-6;
const SAFE_DIRECTION_ANGLE_OFFSETS_DEGREES = Object.freeze([
  0,
  -15,
  15,
  -30,
  30,
  -45,
  45,
  -60,
  60,
  -75,
  75,
]);

export const PRECLICK_MOVEMENT_MAX_SAMPLE_GAP_MS = 120;
export const PRECLICK_HOP_MAX_SPEED_PX_PER_SECOND = 2000;
export const PRECLICK_HOP_MIN_DISTANCE_FACTOR = 0.28;
export const PRECLICK_HOP_MAX_DISTANCE_FACTOR = 1;
export const PRECLICK_FORCED_MISS_AFTER_SUCCESSFUL_HOPS = 2;

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

function rotateDirection(direction, degrees) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: direction.x * cosine - direction.y * sine,
    y: direction.x * sine + direction.y * cosine,
  };
}

function movementCircleIntervals({
  startX,
  startY,
  deltaX,
  deltaY,
  circleX,
  circleY,
  radius,
}) {
  const a = deltaX * deltaX + deltaY * deltaY;
  if (a <= PATH_EPSILON) {
    return [];
  }
  const offsetX = startX - circleX;
  const offsetY = startY - circleY;
  const b = 2 * (offsetX * deltaX + offsetY * deltaY);
  const c = offsetX * offsetX + offsetY * offsetY - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return [];
  }
  const root = Math.sqrt(Math.max(0, discriminant));
  const intervalStart = Math.max(0, (-b - root) / (2 * a));
  const intervalEnd = Math.min(1, (-b + root) / (2 * a));
  return intervalStart <= intervalEnd
    ? [{ start: intervalStart, end: intervalEnd }]
    : [];
}

function wrappedMovementUnsafeIntervals({
  startX,
  startY,
  deltaX,
  deltaY,
  pointerX,
  pointerY,
  activationRadius,
  viewportWidth,
  viewportHeight,
}) {
  const radius = Math.max(0, finiteNumber(activationRadius, 0));
  const endX = startX + deltaX;
  const endY = startY + deltaY;
  const minImageX = Math.floor(
    (Math.min(startX, endX) - radius - pointerX) / viewportWidth,
  );
  const maxImageX = Math.ceil(
    (Math.max(startX, endX) + radius - pointerX) / viewportWidth,
  );
  const minImageY = Math.floor(
    (Math.min(startY, endY) - radius - pointerY) / viewportHeight,
  );
  const maxImageY = Math.ceil(
    (Math.max(startY, endY) + radius - pointerY) / viewportHeight,
  );
  const intervals = [];
  for (let imageX = minImageX; imageX <= maxImageX; imageX += 1) {
    for (let imageY = minImageY; imageY <= maxImageY; imageY += 1) {
      intervals.push(
        ...movementCircleIntervals({
          startX,
          startY,
          deltaX,
          deltaY,
          circleX: pointerX + imageX * viewportWidth,
          circleY: pointerY + imageY * viewportHeight,
          radius,
        }),
      );
    }
  }
  return intervals
    .sort((left, right) => left.start - right.start)
    .reduce((merged, interval) => {
      const previous = merged.at(-1);
      if (!previous || interval.start > previous.end + PATH_EPSILON) {
        merged.push({ ...interval });
      } else {
        previous.end = Math.max(previous.end, interval.end);
      }
      return merged;
    }, []);
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

export function preclickRadiusHopDecision({
  successfulHopCount,
  forcedMissConsumed,
  missProbabilityPercent,
  random = Math.random,
}) {
  const completedHops = Math.max(
    0,
    Math.floor(finiteNumber(successfulHopCount, 0)),
  );
  const forcedMissAlreadyConsumed = Boolean(forcedMissConsumed);
  if (completedHops < PRECLICK_FORCED_MISS_AFTER_SUCCESSFUL_HOPS) {
    return {
      forcedMissConsumed: forcedMissAlreadyConsumed,
      reason: "required-hop",
      shouldHop: true,
    };
  }
  if (!forcedMissAlreadyConsumed) {
    return {
      forcedMissConsumed: true,
      reason: "forced-miss",
      shouldHop: false,
    };
  }

  const missProbability =
    clamp(finiteNumber(missProbabilityPercent, 0), 0, 100) / 100;
  const sample = clamp(finiteNumber(random(), 1), 0, 1);
  return {
    forcedMissConsumed: true,
    reason: sample < missProbability ? "random-miss" : "random-hop",
    shouldHop: sample >= missProbability,
  };
}

export function preclickHopDurationMs({ distancePx, speedPxPerSecond }) {
  const distance = Math.max(0, finiteNumber(distancePx, 0));
  const speed = Math.max(0, finiteNumber(speedPxPerSecond, 0));
  if (distance <= 0 || speed <= 0) {
    return 0;
  }
  return (distance / speed) * 1000;
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

export function preclickDirectionalViewportSpan({
  directionX,
  directionY,
  viewportWidth,
  viewportHeight,
}) {
  const direction = normalizedDirection(directionX, directionY);
  const width = Math.max(0, finiteNumber(viewportWidth, 0));
  const height = Math.max(0, finiteNumber(viewportHeight, 0));
  if (!direction || width <= 0 || height <= 0) {
    return 0;
  }
  const horizontalSpan = Math.abs(direction.x) > PATH_EPSILON
    ? width / Math.abs(direction.x)
    : Number.POSITIVE_INFINITY;
  const verticalSpan = Math.abs(direction.y) > PATH_EPSILON
    ? height / Math.abs(direction.y)
    : Number.POSITIVE_INFINITY;
  const span = Math.min(horizontalSpan, verticalSpan);
  return Number.isFinite(span) ? span : 0;
}

export function preclickToroidalDistance({
  x1,
  y1,
  x2,
  y2,
  viewportWidth,
  viewportHeight,
}) {
  const width = Math.max(0, finiteNumber(viewportWidth, 0));
  const height = Math.max(0, finiteNumber(viewportHeight, 0));
  if (width <= 0 || height <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const horizontal = Math.abs(
    wrapPreclickHopCoordinate(x1, width) -
      wrapPreclickHopCoordinate(x2, width),
  );
  const vertical = Math.abs(
    wrapPreclickHopCoordinate(y1, height) -
      wrapPreclickHopCoordinate(y2, height),
  );
  return Math.hypot(
    Math.min(horizontal, width - horizontal),
    Math.min(vertical, height - vertical),
  );
}

export function preclickHopPathIsSafe({
  startX,
  startY,
  deltaX,
  deltaY,
  pointerX,
  pointerY,
  activationRadius = 0,
  minStartSeparation = 2,
  viewportWidth,
  viewportHeight,
}) {
  const width = Math.max(0, finiteNumber(viewportWidth, 0));
  const height = Math.max(0, finiteNumber(viewportHeight, 0));
  if (width <= 0 || height <= 0) {
    return false;
  }
  const start = wrapPreclickHopCenter({
    x: startX,
    y: startY,
    viewportWidth: width,
    viewportHeight: height,
  });
  const end = wrapPreclickHopCenter({
    x: finiteNumber(startX, 0) + finiteNumber(deltaX, 0),
    y: finiteNumber(startY, 0) + finiteNumber(deltaY, 0),
    viewportWidth: width,
    viewportHeight: height,
  });
  if (
    preclickToroidalDistance({
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      viewportWidth: width,
      viewportHeight: height,
    }) < Math.max(0, finiteNumber(minStartSeparation, 0))
  ) {
    return false;
  }

  const intervals = wrappedMovementUnsafeIntervals({
    startX: finiteNumber(startX, 0),
    startY: finiteNumber(startY, 0),
    deltaX: finiteNumber(deltaX, 0),
    deltaY: finiteNumber(deltaY, 0),
    pointerX: finiteNumber(pointerX, 0),
    pointerY: finiteNumber(pointerY, 0),
    activationRadius,
    viewportWidth: width,
    viewportHeight: height,
  });
  if (intervals.length === 0) {
    return true;
  }
  const startsInside = intervals[0].start <= PATH_EPSILON;
  if (!startsInside) {
    return false;
  }
  return intervals.length === 1 && intervals[0].end < 1 - PATH_EPSILON;
}

export function calculatePreclickHopTarget({
  pointerX,
  pointerY,
  centerX,
  centerY,
  speedPxPerSecond,
  maxDistance,
  maxDistancePercent = null,
  viewportWidth = null,
  viewportHeight = null,
  activationRadius = 0,
  minStartSeparation = 2,
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
  const width = Math.max(0, finiteNumber(viewportWidth, 0));
  const height = Math.max(0, finiteNumber(viewportHeight, 0));
  const useDirectionalPercent =
    Number.isFinite(Number(maxDistancePercent)) && width > 0 && height > 0;
  const distancePercent = clamp(
    finiteNumber(maxDistancePercent, 0),
    0,
    150,
  );
  const candidateDirections = SAFE_DIRECTION_ANGLE_OFFSETS_DEGREES.map(
    (angle) => ({ angle, direction: rotateDirection(direction, angle) }),
  );
  const candidates = [];
  for (let reductionPercent = 100; reductionPercent >= 10; reductionPercent -= 5) {
    const reductionFactor = reductionPercent / 100;
    candidateDirections.forEach(({ angle, direction: candidateDirection }) => {
      const candidateMaximum = useDirectionalPercent
        ? preclickDirectionalViewportSpan({
            directionX: candidateDirection.x,
            directionY: candidateDirection.y,
            viewportWidth: width,
            viewportHeight: height,
          }) * distancePercent / 100
        : Math.max(0, finiteNumber(maxDistance, 0));
      const requestedDistance = preclickHopDistance({
        speedPxPerSecond,
        maxDistance: candidateMaximum,
      });
      const actualDistance = requestedDistance * reductionFactor;
      const deltaX = candidateDirection.x * actualDistance;
      const deltaY = candidateDirection.y * actualDistance;
      const safe = actualDistance <= PATH_EPSILON
        ? distancePercent <= 0
        : !useDirectionalPercent || preclickHopPathIsSafe({
            startX: centerX,
            startY: centerY,
            deltaX,
            deltaY,
            pointerX,
            pointerY,
            activationRadius,
            minStartSeparation,
            viewportWidth: width,
            viewportHeight: height,
          });
      if (safe) {
        candidates.push({
          direction: candidateDirection,
          angle,
          deltaX,
          deltaY,
          requestedDistance,
          actualDistance,
          reductionFactor,
          safe,
        });
      }
    });
  }
  candidates.sort((left, right) => {
    const leftScore = 1 - left.reductionFactor + Math.abs(left.angle) / 180;
    const rightScore = 1 - right.reductionFactor + Math.abs(right.angle) / 180;
    return leftScore - rightScore || Math.abs(left.angle) - Math.abs(right.angle);
  });

  const fallbackMaximum = useDirectionalPercent
    ? preclickDirectionalViewportSpan({
        directionX: direction.x,
        directionY: direction.y,
        viewportWidth: width,
        viewportHeight: height,
      }) * distancePercent / 100
    : Math.max(0, finiteNumber(maxDistance, 0));
  const fallbackDistance = preclickHopDistance({
    speedPxPerSecond,
    maxDistance: fallbackMaximum,
  });
  const selected = candidates[0] || {
    direction,
    deltaX: direction.x * fallbackDistance,
    deltaY: direction.y * fallbackDistance,
    requestedDistance: fallbackDistance,
    actualDistance: fallbackDistance,
    safe: distancePercent <= 0,
  };
  const wrappedEnd = useDirectionalPercent
    ? wrapPreclickHopCenter({
        x: finiteNumber(centerX, 0) + selected.deltaX,
        y: finiteNumber(centerY, 0) + selected.deltaY,
        viewportWidth: width,
        viewportHeight: height,
      })
    : null;

  return {
    x: finiteNumber(currentOffsetX, 0) + selected.deltaX,
    y: finiteNumber(currentOffsetY, 0) + selected.deltaY,
    deltaX: selected.deltaX,
    deltaY: selected.deltaY,
    directionX: selected.direction.x,
    directionY: selected.direction.y,
    requestedDistance: selected.requestedDistance,
    actualDistance: selected.actualDistance,
    safe: selected.safe,
    wrappedEnd,
  };
}
