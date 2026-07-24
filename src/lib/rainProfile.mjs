const MIN_RAIN_STRENGTH = 0.25;
const MAX_RAIN_STRENGTH = 1.5;

const BASE_RAIN_FX_OPACITY_LIMIT = 0.5;

export const MAX_RAIN_FX_OPACITY = 0.62;

const LIGHT_RAIN_PROFILE = {
  dropletsPerSecond: 1300,
  fallbackDropCount: 130,
  fallbackOpacity: 0.36,
  fallbackAlpha: [0.18, 0.46],
  fallbackColor: [82, 113, 143],
  fallbackLength: [16, 50],
  fallbackSpeed: [9, 21],
  fallbackWidth: [0.8, 2],
  fxOpacity: 0.42,
  mistColor: [0.04, 0.04, 0.05, 0.48],
  spawnInterval: [0.018, 0.05],
  spawnLimit: 1300,
  spawnSize: [38, 104],
  backgroundBlurSteps: 3,
  raindropCompose: "harder",
  raindropDiffuseLight: [0.42, 0.42, 0.44],
  raindropSpecularLight: [0.78, 0.78, 0.8],
};

const DARK_RAIN_PROFILE = {
  ...LIGHT_RAIN_PROFILE,
  dropletsPerSecond: 1800,
  fxOpacity: 0.5,
  fallbackColor: [82, 82, 82],
  mistColor: [0.04, 0.04, 0.04, 0.8],
  spawnInterval: [0.01, 0.04],
  spawnLimit: 1800,
  spawnSize: [45, 120],
  raindropDiffuseLight: [0.55, 0.55, 0.55],
  raindropSpecularLight: [1, 1, 1],
};

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isHexColor(value) {
  const raw = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(raw);
}

function hexToRgb255(value) {
  const normalized = String(value || "").trim();
  return [1, 3, 5].map((index) =>
    Number.parseInt(normalized.slice(index, index + 2), 16)
  );
}

function rgb255ToUnit(rgb) {
  return rgb.map((channel) => Number((channel / 255).toFixed(4)));
}

function boostDarkRainLight(rgb) {
  return rgb255ToUnit(rgb).map((channel) =>
    Number(clamp(channel * 1.35, 0, 1).toFixed(4))
  );
}

function tintDarkMistColor(baseMistColor, tintRgb) {
  const tint = rgb255ToUnit(tintRgb);
  return [
    Number(clamp(tint[0] * 0.16, 0.02, 0.2).toFixed(4)),
    Number(clamp(tint[1] * 0.16, 0.02, 0.2).toFixed(4)),
    Number(clamp(tint[2] * 0.16, 0.02, 0.2).toFixed(4)),
    baseMistColor[3],
  ];
}

function scaleRainRange(range, scale) {
  return range.map((value) => Number((value * scale).toFixed(3)));
}

function rainProfileForTheme(theme) {
  return theme === "dark" ? DARK_RAIN_PROFILE : LIGHT_RAIN_PROFILE;
}

export function getRainVisualProfile({
  rainStrength = 1,
  theme = "light",
  backgroundBlurSteps,
  rainDropColor,
  rainHighlightColor,
} = {}) {
  const baseProfile = rainProfileForTheme(theme);
  const isDarkTheme = theme === "dark";
  const hasDropColor = isHexColor(rainDropColor);
  const hasHighlightColor = isHexColor(rainHighlightColor);
  const dropRgb = hasDropColor
    ? hexToRgb255(rainDropColor)
    : [...baseProfile.fallbackColor];
  const highlightRgb = hasHighlightColor
    ? hexToRgb255(rainHighlightColor)
    : null;
  const hasCustomDarkColor = isDarkTheme && (hasDropColor || hasHighlightColor);
  const diffuseLight = hasDropColor
    ? hasCustomDarkColor
      ? boostDarkRainLight(dropRgb)
      : rgb255ToUnit(dropRgb)
    : baseProfile.raindropDiffuseLight;
  const specularLight = hasHighlightColor
    ? hasCustomDarkColor
      ? boostDarkRainLight(highlightRgb)
      : rgb255ToUnit(highlightRgb)
    : baseProfile.raindropSpecularLight;
  const mistColor = hasCustomDarkColor
    ? tintDarkMistColor(baseProfile.mistColor, highlightRgb || dropRgb)
    : baseProfile.mistColor;
  const strength = clamp(
    finiteNumber(rainStrength, 1),
    MIN_RAIN_STRENGTH,
    MAX_RAIN_STRENGTH
  );
  const opacityScale = Math.sqrt(strength);
  const sizeScale = 0.9 + strength * 0.1;
  const speedScale = 0.9 + strength * 0.12;
  const widthScale = Math.min(1.18, 0.86 + strength * 0.14);
  const visibilityScale = hasCustomDarkColor ? 1.18 : 1;
  const fallbackVisibilityScale = hasCustomDarkColor ? 1.25 : 1;
  const mistAlpha = clamp(mistColor[3] * opacityScale, 0.12, 0.82);
  const opacityLimit = hasCustomDarkColor
    ? MAX_RAIN_FX_OPACITY
    : BASE_RAIN_FX_OPACITY_LIMIT;

  return {
    theme: isDarkTheme ? "dark" : "light",
    dropletsPerSecond: Math.round(baseProfile.dropletsPerSecond * strength),
    fallbackDropCount: Math.round(baseProfile.fallbackDropCount * strength),
    fallbackOpacity: clamp(
      baseProfile.fallbackOpacity * opacityScale * fallbackVisibilityScale,
      0.06,
      MAX_RAIN_FX_OPACITY
    ),
    fallbackAlpha: baseProfile.fallbackAlpha.map((alpha) =>
      clamp(alpha * opacityScale * fallbackVisibilityScale, 0.04, 0.82)
    ),
    fallbackColor: dropRgb,
    fallbackLength: scaleRainRange(baseProfile.fallbackLength, sizeScale),
    fallbackSpeed: scaleRainRange(baseProfile.fallbackSpeed, speedScale),
    fallbackWidth: scaleRainRange(baseProfile.fallbackWidth, widthScale),
    fxOpacity: clamp(
      baseProfile.fxOpacity * opacityScale * visibilityScale,
      0.08,
      opacityLimit
    ),
    mistColor: [
      mistColor[0],
      mistColor[1],
      mistColor[2],
      mistAlpha,
    ],
    spawnInterval: [
      Math.max(0.01, baseProfile.spawnInterval[0] / strength),
      Math.max(0.025, baseProfile.spawnInterval[1] / strength),
    ],
    spawnLimit: Math.round(baseProfile.spawnLimit * strength),
    spawnSize: scaleRainRange(baseProfile.spawnSize, sizeScale),
    backgroundBlurSteps: Math.round(
      clamp(
        finiteNumber(backgroundBlurSteps, baseProfile.backgroundBlurSteps),
        0,
        8,
      ),
    ),
    raindropCompose: baseProfile.raindropCompose,
    raindropDiffuseLight: diffuseLight,
    raindropSpecularLight: specularLight,
  };
}
