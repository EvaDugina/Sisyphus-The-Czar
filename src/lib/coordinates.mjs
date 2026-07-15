export function clampCoordinate(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function localToCanonicalPosition(
  x,
  y,
  bounds,
  worldWidth,
  worldHeight,
) {
  return {
    x:
      bounds.maxX > 0
        ? clampCoordinate((x / bounds.maxX) * worldWidth, 0, worldWidth)
        : worldWidth / 2,
    y:
      bounds.maxY > 0
        ? clampCoordinate((y / bounds.maxY) * worldHeight, 0, worldHeight)
        : 0,
  };
}

export function canonicalToLocalPosition(
  x,
  y,
  bounds,
  worldWidth,
  worldHeight,
) {
  return {
    x: (clampCoordinate(x, 0, worldWidth) / worldWidth) * bounds.maxX,
    y: (clampCoordinate(y, 0, worldHeight) / worldHeight) * bounds.maxY,
  };
}
