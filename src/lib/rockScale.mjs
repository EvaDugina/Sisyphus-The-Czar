export const DEFAULT_ROCK_MIN_WIDTH_VW = 8;
export const DEFAULT_ROCK_MAX_WIDTH_VW = 35;
export const DEFAULT_ROCK_SCALE_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
export const ROCK_WIDTH_VW_LIMITS = Object.freeze([1, 150]);

const CUBIC_BEZIER_RE =
  /^cubic-bezier\(\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*\)$/i;
const SOLVE_EPSILON = 1e-6;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeWidthVw(value, fallback) {
  return clamp(
    finiteNumber(value, fallback),
    ROCK_WIDTH_VW_LIMITS[0],
    ROCK_WIDTH_VW_LIMITS[1],
  );
}

function sampleCurve(t, point1, point2) {
  const a = 1 - 3 * point2 + 3 * point1;
  const b = 3 * point2 - 6 * point1;
  const c = 3 * point1;
  return ((a * t + b) * t + c) * t;
}

function sampleCurveDerivative(t, point1, point2) {
  const a = 1 - 3 * point2 + 3 * point1;
  const b = 3 * point2 - 6 * point1;
  const c = 3 * point1;
  return (3 * a * t + 2 * b) * t + c;
}

export function parseCubicBezier(value) {
  const match = String(value || "").trim().match(CUBIC_BEZIER_RE);
  if (!match) {
    return null;
  }

  const points = match.slice(1).map(Number);
  if (!points.every(Number.isFinite)) {
    return null;
  }

  const [x1, y1, x2, y2] = points;
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
    return null;
  }
  return [x1, y1, x2, y2];
}

export function normalizeRockScaleEasing(
  value,
  fallback = DEFAULT_ROCK_SCALE_EASING,
) {
  const trimmed = String(value || "").trim();
  return parseCubicBezier(trimmed) ? trimmed : fallback;
}

export function normalizeRockWidthVwRange(raw = {}, defaults = {}) {
  const fallbackStart = normalizeWidthVw(
    defaults.rockMinWidthVw,
    DEFAULT_ROCK_MIN_WIDTH_VW,
  );
  const fallbackEnd = normalizeWidthVw(
    defaults.rockMaxWidthVw,
    DEFAULT_ROCK_MAX_WIDTH_VW,
  );

  return {
    rockMinWidthVw: normalizeWidthVw(
      raw.rockMinWidthVw,
      fallbackStart,
    ),
    rockMaxWidthVw: normalizeWidthVw(
      raw.rockMaxWidthVw,
      fallbackEnd,
    ),
  };
}

export function cubicBezierYForX(progress, curve) {
  const [x1, y1, x2, y2] =
    Array.isArray(curve) && curve.length === 4
      ? curve
      : parseCubicBezier(curve) || parseCubicBezier(DEFAULT_ROCK_SCALE_EASING);
  const targetX = clamp(Number(progress) || 0, 0, 1);

  if (targetX === 0 || targetX === 1) {
    return targetX;
  }

  let t = targetX;
  for (let i = 0; i < 8; i += 1) {
    const x = sampleCurve(t, x1, x2) - targetX;
    const derivative = sampleCurveDerivative(t, x1, x2);
    if (Math.abs(x) < SOLVE_EPSILON) {
      return sampleCurve(t, y1, y2);
    }
    if (Math.abs(derivative) < SOLVE_EPSILON) {
      break;
    }
    t -= x / derivative;
  }

  let low = 0;
  let high = 1;
  t = targetX;
  for (let i = 0; i < 16; i += 1) {
    const x = sampleCurve(t, x1, x2);
    if (Math.abs(x - targetX) < SOLVE_EPSILON) {
      break;
    }
    if (x < targetX) {
      low = t;
    } else {
      high = t;
    }
    t = (low + high) / 2;
  }

  return sampleCurve(t, y1, y2);
}

export function rockScaleForHeightProgress(
  heightProgress,
  options = {},
) {
  const curve =
    parseCubicBezier(options.easing) ||
    parseCubicBezier(DEFAULT_ROCK_SCALE_EASING);
  const { rockMinWidthVw, rockMaxWidthVw } = normalizeRockWidthVwRange(
    {
      rockMinWidthVw: options.minWidthVw,
      rockMaxWidthVw: options.maxWidthVw,
    },
    {
      rockMinWidthVw: DEFAULT_ROCK_MIN_WIDTH_VW,
      rockMaxWidthVw: DEFAULT_ROCK_MAX_WIDTH_VW,
    },
  );
  const eased = clamp(cubicBezierYForX(heightProgress, curve), 0, 1);
  const widthVw =
    rockMinWidthVw + (rockMaxWidthVw - rockMinWidthVw) * eased;
  const viewportWidthPx = finiteNumber(options.viewportWidthPx, 0);
  const baseWidthPx = finiteNumber(options.baseWidthPx, 0);
  if (viewportWidthPx <= 0 || baseWidthPx <= 0) {
    return 1;
  }
  return ((viewportWidthPx * widthVw) / 100) / baseWidthPx;
}

export function rockScaleForY(y, maxY, options = {}) {
  const normalizedHeight =
    Number(maxY) > 0 ? 1 - clamp(Number(y) / maxY, 0, 1) : 1;
  return rockScaleForHeightProgress(normalizedHeight, options);
}

export function rockActivationScaleFactor(currentScale, options = {}) {
  const scale = Number(currentScale);
  const targetWidthVw = Number(options.targetWidthVw);
  const baseWidthPx = Number(options.baseWidthPx);
  const viewportWidthPx = Number(options.viewportWidthPx);
  if (
    !Number.isFinite(scale) ||
    scale <= 0 ||
    !Number.isFinite(targetWidthVw) ||
    targetWidthVw <= 0 ||
    !Number.isFinite(baseWidthPx) ||
    baseWidthPx <= 0 ||
    !Number.isFinite(viewportWidthPx) ||
    viewportWidthPx <= 0
  ) {
    return 1;
  }
  const currentWidthPx = baseWidthPx * scale;
  const targetWidthPx = (viewportWidthPx * targetWidthVw) / 100;
  return targetWidthPx / currentWidthPx;
}

export function rockPressScaleFactor(percent) {
  const value = Number(percent);
  const safePercent = Number.isFinite(value) ? clamp(value, 0, 100) : 0;
  return 1 - safePercent / 100;
}

export function rockWallPenetrationPixels(sizePx, percent) {
  const size = Math.max(0, finiteNumber(sizePx, 0));
  const safePercent = clamp(finiteNumber(percent, 0), 0, 100);
  return (size * safePercent) / 100;
}

export function rockHorizontalWallCompensation(
  localX,
  maxX,
  baseWidthPx,
  scale,
  wallPenetrationPercent = 0,
) {
  const travel = Math.max(0, finiteNumber(maxX, 0));
  const width = Math.max(0, finiteNumber(baseWidthPx, 0));
  const safeScale = Math.max(0, finiteNumber(scale, 1));
  const x = clamp(finiteNumber(localX, travel / 2), 0, travel);
  const visualWidth = width * safeScale;
  const worldWidth = travel + width;

  if (travel === 0 || width === 0) {
    return 0;
  }
  if (visualWidth > worldWidth) {
    return travel / 2 - x;
  }

  const compensation = (x / travel - 0.5) * (width - visualWidth);
  const penetration = rockWallPenetrationPixels(
    visualWidth,
    wallPenetrationPercent,
  );
  const penetrationOffset = (x / travel - 0.5) * penetration * 2;
  const result = compensation + penetrationOffset;
  return result === 0 ? 0 : result;
}

export function rockLocalXForVisualGrab(
  pointerX,
  grabX,
  maxX,
  baseWidthPx,
  scale,
) {
  const travel = Math.max(0, finiteNumber(maxX, 0));
  const width = Math.max(0, finiteNumber(baseWidthPx, 0));
  const safeScale = Math.max(0, finiteNumber(scale, 1));
  const visualTravel = travel + width - width * safeScale;

  if (travel === 0 || width === 0) {
    return 0;
  }
  if (visualTravel <= 0) {
    return travel / 2;
  }

  const visualGrabOffset = clamp(
    finiteNumber(grabX, width / 2),
    0,
    width,
  ) * safeScale;
  const progress = clamp(
    (finiteNumber(pointerX, visualGrabOffset) - visualGrabOffset) /
      visualTravel,
    0,
    1,
  );
  return progress * travel;
}
