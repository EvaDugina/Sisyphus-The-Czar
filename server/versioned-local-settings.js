"use strict";

const TRAIL_RENDER_PROFILES = Object.freeze([
  "auto",
  "low",
  "mobile",
  "desktop",
  "high",
]);
const GLOW_OPTIMIZATION_MODES = Object.freeze([
  "auto",
  "performance",
  "balanced",
  "quality",
  "manual",
]);
const GLOW_TARGET_FPS_VALUES = Object.freeze([30, 45, 60]);
const DEFAULT_VERSIONED_LOCAL_SETTINGS = Object.freeze({
  trailRenderProfile: "auto",
  glowOptimizationMode: "balanced",
  glowTargetFps: 60,
  glowBufferScalePercent: 50,
  glowUpdateFps: 30,
  glowMaxPoints: 700,
  glowDecimation: 3,
});

function enumValue(value, values, fallback) {
  return values.includes(value) ? value : fallback;
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  return Math.min(
    Math.max(Number.isFinite(number) ? Math.round(number) : fallback, min),
    max,
  );
}

function sanitizeVersionedLocalSettings(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    trailRenderProfile: enumValue(
      source.trailRenderProfile,
      TRAIL_RENDER_PROFILES,
      DEFAULT_VERSIONED_LOCAL_SETTINGS.trailRenderProfile,
    ),
    glowOptimizationMode: enumValue(
      source.glowOptimizationMode,
      GLOW_OPTIMIZATION_MODES,
      DEFAULT_VERSIONED_LOCAL_SETTINGS.glowOptimizationMode,
    ),
    glowTargetFps: enumValue(
      Number(source.glowTargetFps),
      GLOW_TARGET_FPS_VALUES,
      DEFAULT_VERSIONED_LOCAL_SETTINGS.glowTargetFps,
    ),
    glowBufferScalePercent: boundedInteger(
      source.glowBufferScalePercent,
      DEFAULT_VERSIONED_LOCAL_SETTINGS.glowBufferScalePercent,
      25,
      100,
    ),
    glowUpdateFps: boundedInteger(
      source.glowUpdateFps,
      DEFAULT_VERSIONED_LOCAL_SETTINGS.glowUpdateFps,
      15,
      60,
    ),
    glowMaxPoints: boundedInteger(
      source.glowMaxPoints,
      DEFAULT_VERSIONED_LOCAL_SETTINGS.glowMaxPoints,
      100,
      2000,
    ),
    glowDecimation: boundedInteger(
      source.glowDecimation,
      DEFAULT_VERSIONED_LOCAL_SETTINGS.glowDecimation,
      1,
      10,
    ),
  };
}

module.exports = {
  DEFAULT_VERSIONED_LOCAL_SETTINGS,
  sanitizeVersionedLocalSettings,
};
