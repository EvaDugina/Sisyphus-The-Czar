function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export const MIX_BLEND_MODES = Object.freeze([
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
]);

const MIX_BLEND_MODE_SET = new Set(MIX_BLEND_MODES);

function mixBlendMode(value, fallback) {
  const normalized = String(value || "").trim();
  if (MIX_BLEND_MODE_SET.has(normalized)) {
    return normalized;
  }
  return MIX_BLEND_MODE_SET.has(fallback) ? fallback : "normal";
}

function timingFunction(value, fallback, isSupported) {
  const trimmed = String(value || "").trim();
  return trimmed && isSupported(trimmed) ? trimmed : fallback;
}

export function normalizeRainSettings(raw, options) {
  const { defaults, isTimingFunctionSupported = () => true } = options;

  return {
    rainStrength: clamp(finiteNumber(raw.rainStrength, 1), 0.25, 1.5),
    rainBlendMode: mixBlendMode(
      raw.rainBlendMode,
      defaults.rainBlendMode || "multiply",
    ),
    rainBlurBlendMode: mixBlendMode(
      raw.rainBlurBlendMode,
      defaults.rainBlurBlendMode || "normal",
    ),
    rainBackgroundBlurSteps: Math.round(
      clamp(
        finiteNumber(
          raw.rainBackgroundBlurSteps,
          finiteNumber(defaults.rainBackgroundBlurSteps, 3),
        ),
        0,
        8,
      ),
    ),
    rainBlurPx: clamp(
      finiteNumber(raw.rainBlurPx, finiteNumber(defaults.rainBlurPx, 14)),
      0,
      40,
    ),
    rainBlurOpacity: clamp(
      finiteNumber(
        raw.rainBlurOpacity,
        finiteNumber(defaults.rainBlurOpacity, 0.2),
      ),
      0,
      1,
    ),
    rainBlurSaturation: clamp(
      finiteNumber(
        raw.rainBlurSaturation,
        finiteNumber(defaults.rainBlurSaturation, 1.1),
      ),
      0,
      2,
    ),
    rainZIndex: Math.round(
      clamp(finiteNumber(raw.rainZIndex, defaults.rainZIndex), 0, 30),
    ),
    rainEnterEasing: timingFunction(
      raw.rainEnterEasing,
      defaults.rainEnterEasing,
      isTimingFunctionSupported,
    ),
    rainExitEasing: timingFunction(
      raw.rainExitEasing,
      defaults.rainExitEasing,
      isTimingFunctionSupported,
    ),
    rainEnterMs: Math.round(
      clamp(finiteNumber(raw.rainEnterMs, defaults.rainEnterMs), 0, 10000),
    ),
    rainExitMs: Math.round(
      clamp(finiteNumber(raw.rainExitMs, defaults.rainExitMs), 0, 10000),
    ),
  };
}
