export const VISUAL_TRAIL_POINT_VERSION = 2;

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundCanonical(value) {
  return Math.round(value * 100) / 100;
}

export function normalizeStoredTrailPoint(
  point,
  { worldWidth, worldHeight } = {},
) {
  const width = finitePositive(worldWidth);
  const height = finitePositive(worldHeight);
  if (!Array.isArray(point) || point.length < 2 || !width || !height) {
    return null;
  }
  const x = Number(point[0]);
  const y = Number(point[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return [
    roundCanonical(clamp(x, 0, width)),
    roundCanonical(clamp(y, 0, height)),
    ...(Number(point[2]) === VISUAL_TRAIL_POINT_VERSION
      ? [VISUAL_TRAIL_POINT_VERSION]
      : []),
  ];
}

export function localVisualTrailPointToCanonical(
  point,
  { viewportWidth, sceneHeight, worldWidth, worldHeight } = {},
) {
  const localWidth = finitePositive(viewportWidth);
  const localHeight = finitePositive(sceneHeight);
  const canonicalWidth = finitePositive(worldWidth);
  const canonicalHeight = finitePositive(worldHeight);
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (
    !localWidth ||
    !localHeight ||
    !canonicalWidth ||
    !canonicalHeight ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return null;
  }
  return [
    roundCanonical(
      (clamp(x, 0, localWidth) / localWidth) * canonicalWidth,
    ),
    roundCanonical(
      (clamp(y, 0, localHeight) / localHeight) * canonicalHeight,
    ),
    VISUAL_TRAIL_POINT_VERSION,
  ];
}

export function canonicalVisualTrailPointToLocal(
  point,
  { viewportWidth, sceneHeight, worldWidth, worldHeight } = {},
) {
  const normalized = normalizeStoredTrailPoint(point, {
    worldWidth,
    worldHeight,
  });
  const localWidth = finitePositive(viewportWidth);
  const localHeight = finitePositive(sceneHeight);
  const canonicalWidth = finitePositive(worldWidth);
  const canonicalHeight = finitePositive(worldHeight);
  if (
    !normalized ||
    normalized[2] !== VISUAL_TRAIL_POINT_VERSION ||
    !localWidth ||
    !localHeight ||
    !canonicalWidth ||
    !canonicalHeight
  ) {
    return null;
  }
  return {
    x: (normalized[0] / canonicalWidth) * localWidth,
    y: (normalized[1] / canonicalHeight) * localHeight,
  };
}
