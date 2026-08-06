const DIRECTION_EPSILON = 0.5;

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
    maximum <= 0 ||
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
