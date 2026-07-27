import { cubicBezierYForX, parseCubicBezier } from "./rockScale.mjs";

const DEFAULT_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function physicalHeightProgress(y, maxY) {
  const height = Math.max(0, finiteNumber(maxY, 0));
  if (height <= 0) {
    return 0;
  }
  return clamp(1 - finiteNumber(y, height) / height, 0, 1);
}

export function drizzleVolumeForY(y, maxY, settings = {}) {
  const progress = physicalHeightProgress(y, maxY);
  const startVolume = clamp(finiteNumber(settings.startVolume, 0.1), 0, 1);
  const endVolume = clamp(finiteNumber(settings.endVolume, 1), 0, 1);
  const curve =
    parseCubicBezier(settings.easing) ||
    parseCubicBezier(DEFAULT_EASING);
  const easedProgress =
    progress <= 0
      ? 0
      : progress >= 1
        ? 1
        : cubicBezierYForX(progress, curve);
  return clamp(
    startVolume + (endVolume - startVolume) * easedProgress,
    0,
    1,
  );
}
