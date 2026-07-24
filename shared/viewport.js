(function attachViewport(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SisyphusViewport = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createViewport() {
  "use strict";

  const MIN_VIEWPORT_SIZE = 1;
  const MAX_VIEWPORT_SIZE = 32768;

  function sanitizeDimension(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return null;
    }
    return Math.round(
      Math.min(Math.max(number, MIN_VIEWPORT_SIZE), MAX_VIEWPORT_SIZE),
    );
  }

  function sanitizeViewport(input, fallback = null) {
    const width = sanitizeDimension(input?.width);
    const height = sanitizeDimension(input?.height);
    if (width !== null && height !== null) {
      return { width, height };
    }
    if (fallback && fallback !== input) {
      return sanitizeViewport(fallback);
    }
    return null;
  }

  function viewportScale(masterViewport, localViewport) {
    const master = sanitizeViewport(masterViewport);
    const local = sanitizeViewport(localViewport);
    if (!master || !local) {
      return { x: 1, y: 1 };
    }
    return {
      x: local.width / master.width,
      y: local.height / master.height,
    };
  }

  return Object.freeze({
    MAX_VIEWPORT_SIZE,
    MIN_VIEWPORT_SIZE,
    sanitizeViewport,
    viewportScale,
  });
});
