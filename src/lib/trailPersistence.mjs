export const LEGACY_VISUAL_TRAIL_POINT_VERSION = 2;
export const VISUAL_TRAIL_POINT_VERSION = 3;

const VIEWPORT_WIDTH_VW = 100;
const MAX_SCENE_HEIGHT_VH = 10_000;

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
  if (!Array.isArray(point) || point.length < 2) {
    return null;
  }
  const x = Number(point[0]);
  const y = Number(point[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  const version = Number(point[2]);
  if (version === VISUAL_TRAIL_POINT_VERSION) {
    return [
      roundCanonical(clamp(x, 0, VIEWPORT_WIDTH_VW)),
      roundCanonical(clamp(y, 0, MAX_SCENE_HEIGHT_VH)),
      VISUAL_TRAIL_POINT_VERSION,
    ];
  }

  const width = finitePositive(worldWidth);
  const height = finitePositive(worldHeight);
  if (!width || !height) {
    return null;
  }
  return [
    roundCanonical(clamp(x, 0, width)),
    roundCanonical(clamp(y, 0, height)),
    ...(version === LEGACY_VISUAL_TRAIL_POINT_VERSION
      ? [LEGACY_VISUAL_TRAIL_POINT_VERSION]
      : []),
  ];
}

export function localVisualTrailPointToCanonical(
  point,
  { viewportWidth, viewportHeight, sceneHeight } = {},
) {
  const localWidth = finitePositive(viewportWidth);
  const viewport = finitePositive(viewportHeight);
  const localHeight = finitePositive(sceneHeight);
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (
    !localWidth ||
    !viewport ||
    !localHeight ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return null;
  }
  return [
    roundCanonical(
      (clamp(x, 0, localWidth) / localWidth) * VIEWPORT_WIDTH_VW,
    ),
    roundCanonical(
      (clamp(y, 0, localHeight) / viewport) * VIEWPORT_WIDTH_VW,
    ),
    VISUAL_TRAIL_POINT_VERSION,
  ];
}

export function canonicalVisualTrailPointToLocal(
  point,
  {
    viewportWidth,
    viewportHeight,
    sceneHeight,
    worldWidth,
    worldHeight,
  } = {},
) {
  const version = Number(point?.[2]);
  const normalized = normalizeStoredTrailPoint(point, {
    worldWidth,
    worldHeight,
  });
  const localWidth = finitePositive(viewportWidth);
  const viewport = finitePositive(viewportHeight);
  const localHeight = finitePositive(sceneHeight);
  const canonicalWidth = finitePositive(worldWidth);
  const canonicalHeight = finitePositive(worldHeight);

  if (
    normalized?.[2] === VISUAL_TRAIL_POINT_VERSION &&
    localWidth &&
    viewport
  ) {
    return {
      x: (normalized[0] / VIEWPORT_WIDTH_VW) * localWidth,
      y: (normalized[1] / VIEWPORT_WIDTH_VW) * viewport,
    };
  }

  if (
    !normalized ||
    version !== LEGACY_VISUAL_TRAIL_POINT_VERSION ||
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
