export const GLOW_OPTIMIZATION_MODES = Object.freeze([
  "auto",
  "performance",
  "balanced",
  "quality",
  "manual",
]);

export const GLOW_TARGET_FPS_VALUES = Object.freeze([30, 45, 60]);

export const GLOW_OPTIMIZATION_LIMITS = Object.freeze({
  glowBufferScalePercent: Object.freeze([25, 100]),
  glowUpdateFps: Object.freeze([15, 60]),
  glowMaxPoints: Object.freeze([100, 2000]),
  glowDecimation: Object.freeze([1, 10]),
});

export const DEFAULT_GLOW_OPTIMIZATION_SETTINGS = Object.freeze({
  glowOptimizationMode: "balanced",
  glowBufferScalePercent: 50,
  glowUpdateFps: 30,
  glowMaxPoints: 700,
  glowDecimation: 3,
  glowTargetFps: 60,
});

export const GLOW_LOCAL_SETTING_NAMES = Object.freeze(
  Object.keys(DEFAULT_GLOW_OPTIMIZATION_SETTINGS),
);

const GLOW_PRESETS = Object.freeze({
  performance: Object.freeze({
    bufferScalePercent: 25,
    updateFps: 24,
    maxPoints: 350,
    decimation: 6,
  }),
  balanced: Object.freeze({
    bufferScalePercent: 50,
    updateFps: 30,
    maxPoints: 700,
    decimation: 3,
  }),
  quality: Object.freeze({
    bufferScalePercent: 100,
    updateFps: 60,
    maxPoints: 2000,
    decimation: 1,
  }),
});

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function finiteInteger(value, fallback, [min, max]) {
  const number = Number(value);
  return clamp(Number.isFinite(number) ? Math.round(number) : fallback, min, max);
}

function normalizeTargetFps(value, fallback) {
  const number = Number(value);
  return GLOW_TARGET_FPS_VALUES.includes(number) ? number : fallback;
}

export function sanitizeGlowOptimizationSettings(
  input,
  fallback = DEFAULT_GLOW_OPTIMIZATION_SETTINGS,
) {
  const source = input && typeof input === "object" ? input : {};
  const fallbackSource =
    fallback && typeof fallback === "object"
      ? fallback
      : DEFAULT_GLOW_OPTIMIZATION_SETTINGS;
  const fallbackMode = GLOW_OPTIMIZATION_MODES.includes(
    fallbackSource.glowOptimizationMode,
  )
    ? fallbackSource.glowOptimizationMode
    : DEFAULT_GLOW_OPTIMIZATION_SETTINGS.glowOptimizationMode;
  const mode = String(source.glowOptimizationMode || "");

  return {
    glowOptimizationMode: GLOW_OPTIMIZATION_MODES.includes(mode)
      ? mode
      : fallbackMode,
    glowBufferScalePercent: finiteInteger(
      source.glowBufferScalePercent,
      fallbackSource.glowBufferScalePercent,
      GLOW_OPTIMIZATION_LIMITS.glowBufferScalePercent,
    ),
    glowUpdateFps: finiteInteger(
      source.glowUpdateFps,
      fallbackSource.glowUpdateFps,
      GLOW_OPTIMIZATION_LIMITS.glowUpdateFps,
    ),
    glowMaxPoints: finiteInteger(
      source.glowMaxPoints,
      fallbackSource.glowMaxPoints,
      GLOW_OPTIMIZATION_LIMITS.glowMaxPoints,
    ),
    glowDecimation: finiteInteger(
      source.glowDecimation,
      fallbackSource.glowDecimation,
      GLOW_OPTIMIZATION_LIMITS.glowDecimation,
    ),
    glowTargetFps: normalizeTargetFps(
      source.glowTargetFps,
      normalizeTargetFps(
        fallbackSource.glowTargetFps,
        DEFAULT_GLOW_OPTIMIZATION_SETTINGS.glowTargetFps,
      ),
    ),
  };
}

export function resolveGlowOptimizationProfile(input, adaptiveQuality = 1) {
  const clean = sanitizeGlowOptimizationSettings(input);
  if (clean.glowOptimizationMode === "manual") {
    return {
      mode: clean.glowOptimizationMode,
      bufferScale: clean.glowBufferScalePercent / 100,
      updateFps: clean.glowUpdateFps,
      maxPoints: clean.glowMaxPoints,
      decimation: clean.glowDecimation,
      targetFps: clean.glowTargetFps,
    };
  }

  if (clean.glowOptimizationMode === "auto") {
    const quality = clamp(Number(adaptiveQuality) || 1, 0.5, 1.5);
    const base = GLOW_PRESETS.balanced;
    return {
      mode: clean.glowOptimizationMode,
      bufferScale:
        finiteInteger(
          base.bufferScalePercent * quality,
          base.bufferScalePercent,
          GLOW_OPTIMIZATION_LIMITS.glowBufferScalePercent,
        ) / 100,
      updateFps: clamp(
        Math.round(clean.glowTargetFps * quality),
        GLOW_OPTIMIZATION_LIMITS.glowUpdateFps[0],
        clean.glowTargetFps,
      ),
      maxPoints: finiteInteger(
        base.maxPoints * quality,
        base.maxPoints,
        GLOW_OPTIMIZATION_LIMITS.glowMaxPoints,
      ),
      decimation: finiteInteger(
        base.decimation / quality,
        base.decimation,
        GLOW_OPTIMIZATION_LIMITS.glowDecimation,
      ),
      targetFps: clean.glowTargetFps,
    };
  }

  const preset =
    GLOW_PRESETS[clean.glowOptimizationMode] || GLOW_PRESETS.balanced;
  return {
    mode: clean.glowOptimizationMode,
    bufferScale: preset.bufferScalePercent / 100,
    updateFps: preset.updateFps,
    maxPoints: preset.maxPoints,
    decimation: preset.decimation,
    targetFps: clean.glowTargetFps,
  };
}

export function sampleGlowPoints(points, maxPoints, decimation = 1) {
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }
  if (points.length === 1) {
    return [points[0]];
  }

  const budget = finiteInteger(
    maxPoints,
    DEFAULT_GLOW_OPTIMIZATION_SETTINGS.glowMaxPoints,
    GLOW_OPTIMIZATION_LIMITS.glowMaxPoints,
  );
  const minimumStride = finiteInteger(
    decimation,
    DEFAULT_GLOW_OPTIMIZATION_SETTINGS.glowDecimation,
    GLOW_OPTIMIZATION_LIMITS.glowDecimation,
  );
  const budgetStride = Math.max(1, Math.ceil((points.length - 1) / (budget - 1)));
  const stride = Math.max(minimumStride, budgetStride);
  const sampled = [];

  for (let index = 0; index < points.length - 1; index += stride) {
    sampled.push(points[index]);
  }
  const last = points.at(-1);
  if (sampled.at(-1) !== last) {
    sampled.push(last);
  }
  return sampled.slice(-budget);
}
