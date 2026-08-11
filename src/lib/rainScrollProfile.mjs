import { cubicBezierYForX } from "./rockScale.mjs";

export const RAIN_SCROLL_PEAK = 0.5;
export const RAIN_SCROLL_PLATEAU_SCREENS = 5;
export const RAIN_SCROLL_OPACITY_BEZIER = Object.freeze([0, 0.25, 0.97, 0.41]);
export const RAIN_SCROLL_AUDIO_BEZIER = Object.freeze([0.32, 0.05, 0.97, 0.41]);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function rainScrollProfile({
  scrollY = 0,
  scrollHeight = 1,
  viewportHeight = 1,
  peak = RAIN_SCROLL_PEAK,
  plateauScreens = RAIN_SCROLL_PLATEAU_SCREENS,
} = {}) {
  const cleanViewportHeight = Math.max(1, Number(viewportHeight) || 1);
  const scrollable = Math.max(
    1,
    (Number(scrollHeight) || cleanViewportHeight) - cleanViewportHeight,
  );
  const progress = clamp((Number(scrollY) || 0) / scrollable, 0, 1);
  const halfPlateau = Math.min(
    0.49,
    (Math.max(0, Number(plateauScreens) || 0) * cleanViewportHeight) /
      2 /
      scrollable,
  );
  const cleanPeak = clamp(Number(peak) || 0, 0, 1);
  const risingEnd = clamp(cleanPeak - halfPlateau, 0, 1);
  const fallingStart = clamp(cleanPeak + halfPlateau, 0, 1);
  let hill = 1;
  if (progress <= risingEnd) {
    hill = risingEnd > 0 ? progress / risingEnd : 1;
  } else if (progress >= fallingStart) {
    hill = fallingStart < 1
      ? (1 - progress) / (1 - fallingStart)
      : 1;
  }
  hill = clamp(hill, 0, 1);

  return Object.freeze({
    atBottom: progress >= 1,
    audio: cubicBezierYForX(hill, RAIN_SCROLL_AUDIO_BEZIER),
    fallingStart,
    hill,
    opacity: cubicBezierYForX(hill, RAIN_SCROLL_OPACITY_BEZIER),
    progress,
    risingEnd,
  });
}
