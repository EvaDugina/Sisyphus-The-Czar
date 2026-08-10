export const CAMERA_VERTICAL_ANCHOR = 0.5;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function cameraTargetScrollY({
  rockCenterDocumentY,
  viewportHeight,
  documentHeight,
  anchor = CAMERA_VERTICAL_ANCHOR,
}) {
  const height = Math.max(0, finiteNumber(viewportHeight, 0));
  const pageHeight = Math.max(height, finiteNumber(documentHeight, height));
  const maxScrollY = Math.max(0, pageHeight - height);
  const anchorFraction = clamp(finiteNumber(anchor, CAMERA_VERTICAL_ANCHOR), 0, 1);
  const centerY = finiteNumber(rockCenterDocumentY, height * anchorFraction);
  return clamp(centerY - height * anchorFraction, 0, maxScrollY);
}

export function cameraFollowScrollY(currentScrollY, targetScrollY, lerp) {
  const current = Math.max(0, finiteNumber(currentScrollY, 0));
  const target = Math.max(0, finiteNumber(targetScrollY, current));
  const factor = clamp(finiteNumber(lerp, 0.1), 0.01, 1);
  if (Math.abs(target - current) < 0.1) {
    return target;
  }
  return current + (target - current) * factor;
}

export function cameraFollowScrollUpY(currentScrollY, targetScrollY, lerp) {
  const current = Math.max(0, finiteNumber(currentScrollY, 0));
  const target = Math.max(0, finiteNumber(targetScrollY, current));
  if (target >= current) {
    return current;
  }
  return cameraFollowScrollY(current, target, lerp);
}
