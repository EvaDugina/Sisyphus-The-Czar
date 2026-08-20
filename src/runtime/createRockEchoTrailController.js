const MOVEMENT_EPSILON_PX = 0.5;

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function sanitizeRockEchoTrailSettings(settings = {}) {
  return {
    enabled: Boolean(settings.rockEchoTrailEnabled),
    copies: Math.round(clamp(finite(settings.rockEchoTrailCopies, 16), 1, 40)),
    intervalMs: Math.round(
      clamp(finite(settings.rockEchoTrailIntervalMs, 50), 16, 500),
    ),
    opacity: clamp(finite(settings.rockEchoTrailOpacity, 0.55), 0.05, 1),
    lifetimeMs: Math.round(
      clamp(finite(settings.rockEchoTrailLifetimeMs, 900), 100, 5000),
    ),
  };
}

export function createRockEchoTrailController(options = {}) {
  const container = options.container;
  const source = options.source;
  const getSettings = options.getSettings || (() => ({}));
  const isActive = options.isActive || (() => true);
  const now = options.now || (() => performance.now());
  const setTimeoutFn = options.setTimeoutFn || window.setTimeout.bind(window);
  const clearTimeoutFn = options.clearTimeoutFn || window.clearTimeout.bind(window);
  const entries = [];

  let disposed = false;
  let lastObservedSample = null;
  let lastEchoSample = null;
  let lastCreatedAt = null;

  function currentSettings() {
    return sanitizeRockEchoTrailSettings(getSettings());
  }

  function sampleSource() {
    if (!container || !source) {
      return null;
    }
    const containerRect = container.getBoundingClientRect();
    const sourceRect = source.getBoundingClientRect();
    if (!(sourceRect.width > 0) || !(sourceRect.height > 0)) {
      return null;
    }
    return {
      centerX: sourceRect.left + sourceRect.width / 2,
      centerY: sourceRect.top + sourceRect.height / 2,
      height: sourceRect.height,
      left: sourceRect.left - containerRect.left,
      top: sourceRect.top - containerRect.top,
      width: sourceRect.width,
    };
  }

  function removeEntry(entry) {
    const index = entries.indexOf(entry);
    if (index >= 0) {
      entries.splice(index, 1);
    }
    if (entry.timerId !== null) {
      clearTimeoutFn(entry.timerId);
      entry.timerId = null;
    }
    entry.node.remove();
  }

  function scheduleRemoval(entry, settings, timestamp = now()) {
    if (entry.timerId !== null) {
      clearTimeoutFn(entry.timerId);
    }
    const remainingMs = Math.max(
      0,
      entry.createdAt + settings.lifetimeMs - timestamp,
    );
    entry.node.style.setProperty(
      "--rock-echo-lifetime",
      `${settings.lifetimeMs}ms`,
    );
    entry.timerId = setTimeoutFn(() => removeEntry(entry), remainingMs);
  }

  function trimToLimit(limit) {
    while (entries.length > limit) {
      removeEntry(entries[0]);
    }
  }

  function appendEcho(sample, settings, timestamp) {
    const echo = source.cloneNode(false);
    echo.removeAttribute("id");
    echo.className = "rock-echo";
    echo.alt = "";
    echo.draggable = false;
    echo.setAttribute("aria-hidden", "true");
    echo.style.left = `${sample.left}px`;
    echo.style.top = `${sample.top}px`;
    echo.style.width = `${sample.width}px`;
    echo.style.height = `${sample.height}px`;
    echo.style.setProperty("--rock-echo-opacity", String(settings.opacity));
    const entry = {
      createdAt: timestamp,
      node: echo,
      timerId: null,
    };
    container.append(echo);
    entries.push(entry);
    scheduleRemoval(entry, settings, timestamp);
    trimToLimit(settings.copies);
    return entry;
  }

  function resetSampling() {
    lastObservedSample = null;
    lastEchoSample = null;
    lastCreatedAt = null;
  }

  function clear() {
    [...entries].forEach(removeEntry);
    resetSampling();
  }

  function record() {
    if (disposed) {
      return false;
    }
    const settings = currentSettings();
    if (!isActive() || !settings.enabled) {
      if (entries.length > 0 || lastObservedSample) {
        clear();
      }
      return false;
    }
    const sample = sampleSource();
    if (!sample) {
      return false;
    }
    if (!lastObservedSample) {
      lastObservedSample = sample;
      lastEchoSample = sample;
      return false;
    }
    const moved =
      Math.hypot(
        sample.centerX - lastObservedSample.centerX,
        sample.centerY - lastObservedSample.centerY,
      ) > MOVEMENT_EPSILON_PX;
    lastObservedSample = sample;
    if (!moved) {
      return false;
    }
    const timestamp = now();
    if (
      lastCreatedAt !== null &&
      timestamp - lastCreatedAt < settings.intervalMs
    ) {
      return false;
    }
    appendEcho(lastEchoSample, settings, timestamp);
    lastEchoSample = sample;
    lastCreatedAt = timestamp;
    return true;
  }

  function sync() {
    if (disposed) {
      return;
    }
    const settings = currentSettings();
    if (!isActive() || !settings.enabled) {
      clear();
      return;
    }
    trimToLimit(settings.copies);
    const timestamp = now();
    [...entries].forEach((entry) => {
      entry.node.style.setProperty(
        "--rock-echo-opacity",
        String(settings.opacity),
      );
      if (entry.createdAt + settings.lifetimeMs <= timestamp) {
        removeEntry(entry);
      } else {
        scheduleRemoval(entry, settings, timestamp);
      }
    });
  }

  function dispose() {
    if (disposed) {
      return;
    }
    clear();
    disposed = true;
  }

  return Object.freeze({
    clear,
    dispose,
    getState: () => ({
      echoCount: entries.length,
      enabled: isActive() && currentSettings().enabled,
      lastCreatedAt,
    }),
    record,
    sync,
  });
}
