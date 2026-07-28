import {
  cubicBezierYForX,
  parseCubicBezier,
} from "./rockScale.mjs";

export const POSITION_SCROLL_REFERENCE_FPS = 60;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function positionScrollState(
  rockCenterViewportY,
  viewportHeight,
  settings = {},
) {
  const height = finiteNumber(viewportHeight, 0);
  const centerY = finiteNumber(rockCenterViewportY, height / 2);
  const zonePercent = clamp(
    finiteNumber(settings.zonePercent, 20),
    0,
    20,
  );
  const zoneHeight = (height * zonePercent) / 100;
  if (
    settings.enabled === false ||
    height <= 0 ||
    zoneHeight <= 0
  ) {
    return {
      active: false,
      direction: 0,
      progress: 0,
      speedVh: 0,
      zoneHeight,
    };
  }

  let edgeState;
  if (centerY <= zoneHeight) {
    edgeState = {
      direction: -1,
      progress: 1 - clamp(centerY / zoneHeight, 0, 1),
    };
  } else if (centerY >= height - zoneHeight) {
    edgeState = {
      direction: 1,
      progress: clamp(
        (centerY - (height - zoneHeight)) / zoneHeight,
        0,
        1,
      ),
    };
  } else {
    return {
      active: false,
      direction: 0,
      progress: 0,
      speedVh: 0,
      zoneHeight,
    };
  }
  const { direction, progress } = edgeState;

  const curve = parseCubicBezier(settings.easing);
  const easedProgress = clamp(
    cubicBezierYForX(progress, curve || undefined),
    0,
    1,
  );
  const startSpeed = clamp(
    finiteNumber(settings.startSpeedVh, 0.2),
    0,
    2,
  );
  const endSpeed = clamp(
    finiteNumber(settings.endSpeedVh, 1),
    0,
    2,
  );

  return {
    active: true,
    direction,
    progress,
    speedVh: startSpeed + (endSpeed - startSpeed) * easedProgress,
    zoneHeight,
  };
}

export function positionScrollDistancePx(
  speedVh,
  viewportHeight,
  deltaSeconds,
) {
  const speed = clamp(finiteNumber(speedVh, 0), 0, 2);
  const height = Math.max(0, finiteNumber(viewportHeight, 0));
  const elapsed = Math.max(0, finiteNumber(deltaSeconds, 0));
  return (
    speed *
    (height / 100) *
    elapsed *
    POSITION_SCROLL_REFERENCE_FPS
  );
}
