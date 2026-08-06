export const WINDOW_OBSTACLE_LIFETIME_MS = 2000;
export const WINDOW_OBSTACLE_CLOSED_POLL_MS = 100;

export const WINDOW_OBSTACLE_PERMISSION = Object.freeze({
  UNCHECKED: "unchecked",
  TEST_OPENED: "test-opened",
  ALLOWED: "allowed",
  BLOCKED: "blocked",
});

const PERMISSION_LABELS = Object.freeze({
  [WINDOW_OBSTACLE_PERMISSION.UNCHECKED]: "Не проверено",
  [WINDOW_OBSTACLE_PERMISSION.TEST_OPENED]: "Тест открыт",
  [WINDOW_OBSTACLE_PERMISSION.ALLOWED]: "Разрешено",
  [WINDOW_OBSTACLE_PERMISSION.BLOCKED]:
    "Заблокировано — разрешите всплывающие окна для этого сайта",
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function randomBetween(min, max, random = Math.random) {
  const start = Math.min(finite(min), finite(max));
  const end = Math.max(finite(min), finite(max));
  return start + clamp(finite(random(), 0), 0, 1) * (end - start);
}

export function randomStepBetween(min, max, step = 1, random = Math.random) {
  const cleanStep = Math.max(1, Math.round(finite(step, 1)));
  const start = Math.ceil(Math.min(finite(min), finite(max)) / cleanStep);
  const end = Math.floor(Math.max(finite(min), finite(max)) / cleanStep);
  if (end <= start) {
    return Math.max(0, start * cleanStep);
  }
  const index = Math.min(
    end,
    start + Math.floor(clamp(finite(random(), 0), 0, 0.999999999) * (end - start + 1)),
  );
  return index * cleanStep;
}

export function windowObstacleHeightFromStartVh(
  currentCenterY,
  startCenterY,
  viewportHeight,
) {
  const cleanViewportHeight = Math.max(1, finite(viewportHeight, 1));
  const start = finite(startCenterY, 0);
  const current = finite(currentCenterY, start);
  return Math.max(0, ((start - current) / cleanViewportHeight) * 100);
}

function relevantSettingsSignature(settings) {
  return JSON.stringify([
    Boolean(settings.windowObstacleEnabled),
    finite(settings.windowObstacleMinHeightVh),
    finite(settings.windowObstacleMaxHeightVh),
    finite(settings.windowObstacleMinIntervalSeconds),
    finite(settings.windowObstacleMaxIntervalSeconds),
    finite(settings.windowObstacleMinWidthPx),
    finite(settings.windowObstacleMaxWidthPx),
    finite(settings.windowObstacleMinHeightPx),
    finite(settings.windowObstacleMaxHeightPx),
  ]);
}

export function createWindowObstacleController(options = {}) {
  const getSettings = options.getSettings || (() => ({}));
  const getHeightVh = options.getHeightVh || (() => 0);
  const random = options.random || Math.random;
  const openPopup =
    options.openPopup ||
    ((url, target, features) => window.open(url, target, features));
  const getScreen =
    options.getScreen ||
    (() => ({
      availHeight: window.screen?.availHeight || window.innerHeight,
      availLeft: window.screen?.availLeft || 0,
      availTop: window.screen?.availTop || 0,
      availWidth: window.screen?.availWidth || window.innerWidth,
    }));
  const setTimeoutFn = options.setTimeoutFn || window.setTimeout.bind(window);
  const clearTimeoutFn = options.clearTimeoutFn || window.clearTimeout.bind(window);
  const setIntervalFn = options.setIntervalFn || window.setInterval.bind(window);
  const clearIntervalFn = options.clearIntervalFn || window.clearInterval.bind(window);
  const onActiveWindowsChange = options.onActiveWindowsChange || (() => {});
  const onPermissionChange = options.onPermissionChange || (() => {});

  let disposed = false;
  let permission = WINDOW_OBSTACLE_PERMISSION.UNCHECKED;
  let scheduleTimerId = null;
  let closedPollTimerId = null;
  let nextWindowId = 1;
  let previousObstacleCount = 0;
  let previousSettingsSignature = "";
  let wasInsideRange = false;
  const trackedWindows = new Map();

  function settings() {
    const value = getSettings();
    return value && typeof value === "object" ? value : {};
  }

  function activeObstacleCount() {
    let count = 0;
    trackedWindows.forEach((entry) => {
      if (entry.kind === "obstacle") {
        count += 1;
      }
    });
    return count;
  }

  function notifyActiveObstacleCount() {
    const count = activeObstacleCount();
    if (count === previousObstacleCount) {
      return;
    }
    previousObstacleCount = count;
    onActiveWindowsChange(count);
  }

  function setPermission(nextPermission) {
    if (!Object.values(WINDOW_OBSTACLE_PERMISSION).includes(nextPermission)) {
      return;
    }
    permission = nextPermission;
    onPermissionChange(permission, PERMISSION_LABELS[permission]);
  }

  function clearSchedule() {
    if (scheduleTimerId !== null) {
      clearTimeoutFn(scheduleTimerId);
      scheduleTimerId = null;
    }
  }

  function stopClosedPollWhenIdle() {
    if (trackedWindows.size === 0 && closedPollTimerId !== null) {
      clearIntervalFn(closedPollTimerId);
      closedPollTimerId = null;
    }
  }

  function finalizeWindow(id, closePopup = false) {
    const entry = trackedWindows.get(id);
    if (!entry) {
      return false;
    }
    trackedWindows.delete(id);
    clearTimeoutFn(entry.closeTimerId);
    if (closePopup) {
      try {
        entry.popup.close();
      } catch {
        // The browser may deny access to a manually navigated popup.
      }
    }
    if (
      entry.kind === "test" &&
      !disposed &&
      permission === WINDOW_OBSTACLE_PERMISSION.TEST_OPENED
    ) {
      setPermission(WINDOW_OBSTACLE_PERMISSION.ALLOWED);
      refresh();
    }
    notifyActiveObstacleCount();
    stopClosedPollWhenIdle();
    return true;
  }

  function sweepClosedWindows() {
    [...trackedWindows.entries()].forEach(([id, entry]) => {
      try {
        if (entry.popup.closed) {
          finalizeWindow(id, false);
        }
      } catch {
        finalizeWindow(id, false);
      }
    });
  }

  function ensureClosedPoll() {
    if (closedPollTimerId === null && trackedWindows.size > 0) {
      closedPollTimerId = setIntervalFn(
        sweepClosedWindows,
        WINDOW_OBSTACLE_CLOSED_POLL_MS,
      );
    }
  }

  function bindBlankWindow(entry) {
    try {
      entry.popup.document.title = "";
      entry.popup.document.body.replaceChildren();
      entry.popup.document.body.style.margin = "0";
      entry.popup.document.body.style.minHeight = "100vh";
      entry.popup.document.addEventListener(
        "click",
        () => finalizeWindow(entry.id, true),
        { once: true },
      );
    } catch {
      // about:blank is normally same-origin; auto-close and closed polling remain fallbacks.
    }
  }

  function trackWindow(popup, kind) {
    const id = nextWindowId;
    nextWindowId += 1;
    const entry = {
      id,
      kind,
      popup,
      closeTimerId: null,
    };
    entry.closeTimerId = setTimeoutFn(
      () => finalizeWindow(id, true),
      WINDOW_OBSTACLE_LIFETIME_MS,
    );
    trackedWindows.set(id, entry);
    bindBlankWindow(entry);
    ensureClosedPoll();
    notifyActiveObstacleCount();
    return entry;
  }

  function screenGeometry(currentSettings, test = false) {
    const rawScreen = getScreen() || {};
    const availWidth = Math.max(1, Math.round(finite(rawScreen.availWidth, 1)));
    const availHeight = Math.max(1, Math.round(finite(rawScreen.availHeight, 1)));
    const availLeft = Math.round(finite(rawScreen.availLeft, 0));
    const availTop = Math.round(finite(rawScreen.availTop, 0));
    const width = test
      ? Math.min(320, availWidth)
      : Math.min(
          availWidth,
          randomStepBetween(
            Math.min(currentSettings.windowObstacleMinWidthPx, availWidth),
            Math.min(currentSettings.windowObstacleMaxWidthPx, availWidth),
            10,
            random,
          ),
        );
    const height = test
      ? Math.min(240, availHeight)
      : Math.min(
          availHeight,
          randomStepBetween(
            Math.min(currentSettings.windowObstacleMinHeightPx, availHeight),
            Math.min(currentSettings.windowObstacleMaxHeightPx, availHeight),
            10,
            random,
          ),
        );
    const left = availLeft + Math.round(randomBetween(0, availWidth - width, random));
    const top = availTop + Math.round(randomBetween(0, availHeight - height, random));
    return { height, left, top, width };
  }

  function openBlankWindow(kind, test = false) {
    const geometry = screenGeometry(settings(), test);
    const features = [
      "popup=yes",
      `width=${geometry.width}`,
      `height=${geometry.height}`,
      `left=${geometry.left}`,
      `top=${geometry.top}`,
    ].join(",");
    let popup;
    try {
      popup = openPopup("", "_blank", features);
    } catch {
      setPermission(WINDOW_OBSTACLE_PERMISSION.BLOCKED);
      clearSchedule();
      return null;
    }
    if (!popup) {
      setPermission(WINDOW_OBSTACLE_PERMISSION.BLOCKED);
      clearSchedule();
      return null;
    }
    return trackWindow(popup, kind);
  }

  function rangeState(currentSettings = settings()) {
    const start = Math.min(
      finite(currentSettings.windowObstacleMinHeightVh),
      finite(currentSettings.windowObstacleMaxHeightVh),
    );
    const end = Math.max(
      finite(currentSettings.windowObstacleMinHeightVh),
      finite(currentSettings.windowObstacleMaxHeightVh),
    );
    const heightVh = finite(getHeightVh(), 0);
    return {
      enabled: Boolean(currentSettings.windowObstacleEnabled),
      heightVh,
      inside: Boolean(currentSettings.windowObstacleEnabled) &&
        heightVh >= start &&
        heightVh <= end,
    };
  }

  function canSchedule(currentSettings = settings()) {
    return (
      !disposed &&
      rangeState(currentSettings).inside &&
      permission !== WINDOW_OBSTACLE_PERMISSION.BLOCKED &&
      permission !== WINDOW_OBSTACLE_PERMISSION.TEST_OPENED
    );
  }

  function scheduleNext(currentSettings = settings()) {
    clearSchedule();
    if (!canSchedule(currentSettings)) {
      return false;
    }
    const seconds = randomBetween(
      currentSettings.windowObstacleMinIntervalSeconds,
      currentSettings.windowObstacleMaxIntervalSeconds,
      random,
    );
    scheduleTimerId = setTimeoutFn(() => {
      scheduleTimerId = null;
      const freshSettings = settings();
      if (!canSchedule(freshSettings)) {
        refresh();
        return;
      }
      const entry = openBlankWindow("obstacle");
      if (entry) {
        setPermission(WINDOW_OBSTACLE_PERMISSION.ALLOWED);
        scheduleNext(settings());
      }
    }, Math.max(0, Math.round(seconds * 1000)));
    return true;
  }

  function refresh() {
    if (disposed) {
      return;
    }
    const currentSettings = settings();
    const signature = relevantSettingsSignature(currentSettings);
    const currentRange = rangeState(currentSettings);
    const settingsChanged = signature !== previousSettingsSignature;
    const enteredRange = currentRange.inside && !wasInsideRange;
    const exitedRange = !currentRange.inside && wasInsideRange;
    previousSettingsSignature = signature;
    wasInsideRange = currentRange.inside;

    if (settingsChanged || exitedRange) {
      clearSchedule();
    }
    if (!currentRange.inside) {
      return;
    }
    if ((settingsChanged || enteredRange || scheduleTimerId === null) && canSchedule(currentSettings)) {
      scheduleNext(currentSettings);
    }
  }

  function testPopupPermission() {
    if (disposed) {
      return false;
    }
    clearSchedule();
    setPermission(WINDOW_OBSTACLE_PERMISSION.TEST_OPENED);
    const entry = openBlankWindow("test", true);
    if (!entry) {
      return false;
    }
    return true;
  }

  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    clearSchedule();
    [...trackedWindows.keys()].forEach((id) => finalizeWindow(id, true));
    if (closedPollTimerId !== null) {
      clearIntervalFn(closedPollTimerId);
      closedPollTimerId = null;
    }
    previousObstacleCount = 0;
    onActiveWindowsChange(0);
  }

  setPermission(WINDOW_OBSTACLE_PERMISSION.UNCHECKED);

  return Object.freeze({
    dispose,
    getState: () => {
      const currentRange = rangeState();
      return {
        activeWindowCount: activeObstacleCount(),
        heightVh: currentRange.heightVh,
        permission,
        schedulePending: scheduleTimerId !== null,
        trackedWindowCount: trackedWindows.size,
        wasInsideRange,
      };
    },
    isControlBlocked: () => activeObstacleCount() > 0,
    refresh,
    testPopupPermission,
  });
}
