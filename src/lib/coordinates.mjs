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

export function viewportToRockRelativePosition(
  clientX,
  clientY,
  rockRect,
  referenceWidth,
  referenceHeight = referenceWidth,
) {
  const width = Number(referenceWidth);
  const height = Number(referenceHeight);
  const centerX = Number(rockRect?.left) + Number(rockRect?.width) / 2;
  const centerY = Number(rockRect?.top) + Number(rockRect?.height) / 2;
  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY) ||
    !Number.isFinite(centerX) ||
    !Number.isFinite(centerY) ||
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    return { x: 0, y: 0 };
  }
  return {
    x: (clientX - centerX) / width,
    y: (clientY - centerY) / height,
  };
}

export function rockRelativeToViewportPosition(
  relativeX,
  relativeY,
  rockRect,
  referenceWidth,
  referenceHeight = referenceWidth,
) {
  const width = Number(referenceWidth);
  const height = Number(referenceHeight);
  const centerX = Number(rockRect?.left) + Number(rockRect?.width) / 2;
  const centerY = Number(rockRect?.top) + Number(rockRect?.height) / 2;
  if (
    !Number.isFinite(relativeX) ||
    !Number.isFinite(relativeY) ||
    !Number.isFinite(centerX) ||
    !Number.isFinite(centerY) ||
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    return { x: centerX || 0, y: centerY || 0 };
  }
  return {
    x: centerX + relativeX * width,
    y: centerY + relativeY * height,
  };
}
