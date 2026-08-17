export const WINDOW_OBSTACLE_LIFETIME_MS = 2000;
export const WINDOW_OBSTACLE_CLOSED_POLL_MS = 100;
export const PRECLICK_POPUP_WIDTH_PX = 640;
export const PRECLICK_POPUP_FALLBACK_ASPECT_RATIO = 1;

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

export function preclickPopupGeometry({
  aspectRatio = PRECLICK_POPUP_FALLBACK_ASPECT_RATIO,
  centerX,
  centerY,
  screen,
  width = PRECLICK_POPUP_WIDTH_PX,
}) {
  const rawScreen = screen && typeof screen === "object" ? screen : {};
  const availWidth = Math.max(1, Math.round(finite(rawScreen.availWidth, 1)));
  const availHeight = Math.max(1, Math.round(finite(rawScreen.availHeight, 1)));
  const availLeft = Math.round(finite(rawScreen.availLeft, 0));
  const availTop = Math.round(finite(rawScreen.availTop, 0));
  const ratio = Math.max(
    0.01,
    finite(aspectRatio, PRECLICK_POPUP_FALLBACK_ASPECT_RATIO),
  );
  let popupWidth = Math.min(availWidth, Math.max(1, Math.round(finite(width, 1))));
  let popupHeight = Math.max(1, Math.round(popupWidth / ratio));
  if (popupHeight > availHeight) {
    popupHeight = availHeight;
    popupWidth = Math.min(availWidth, Math.max(1, Math.round(popupHeight * ratio)));
  }
  const requestedLeft = Math.round(finite(centerX, availLeft) - popupWidth / 2);
  const requestedTop = Math.round(finite(centerY, availTop) - popupHeight / 2);
  return {
    height: popupHeight,
    left: clamp(requestedLeft, availLeft, availLeft + availWidth - popupWidth),
    top: clamp(requestedTop, availTop, availTop + availHeight - popupHeight),
    width: popupWidth,
  };
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
  const getViewportScreenOrigin =
    options.getViewportScreenOrigin ||
    (() => ({
      x:
        finite(window.screenX, 0) +
        Math.max(
          0,
          (finite(window.outerWidth, window.innerWidth) - window.innerWidth) / 2,
        ),
      y:
        finite(window.screenY, 0) +
        Math.max(
          0,
          finite(window.outerHeight, window.innerHeight) - window.innerHeight,
        ),
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
  const pendingPreclickTimerIds = new Set();

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
    if (entry.closeTimerId !== null) {
      clearTimeoutFn(entry.closeTimerId);
    }
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

  function bindWindow(entry) {
    try {
      entry.popup.document.title = "";
      const root = entry.popup.document.documentElement;
      const body = entry.popup.document.body;
      if (root) {
        root.style.height = "100%";
        root.style.margin = "0";
        root.style.overflow = "hidden";
        root.style.width = "100%";
      }
      body.style.height = "100%";
      body.style.margin = "0";
      body.style.minHeight = "0";
      body.style.overflow = "hidden";
      body.style.width = "100%";
      if (entry.kind === "preclick" && entry.imageUrl) {
        const image = entry.popup.document.createElement("img");
        image.alt = entry.imageAlt;
        image.src = entry.imageUrl;
        image.style.display = "block";
        image.style.height = "100%";
        image.style.objectFit = "fill";
        image.style.width = "100%";
        body.replaceChildren(image);
      } else {
        body.replaceChildren();
      }
      if (entry.kind !== "preclick") {
        entry.popup.document.addEventListener(
          "click",
          () => finalizeWindow(entry.id, true),
          { once: true },
        );
      }
    } catch {
      // about:blank is normally same-origin; closed polling remains the fallback.
    }
  }

  function fitPreclickWindow(entry) {
    if (entry.kind !== "preclick" || !entry.geometryInput) {
      return;
    }
    try {
      const popup = entry.popup;
      const chromeWidth = Math.max(
        0,
        Math.round(finite(popup.outerWidth, 0) - finite(popup.innerWidth, 0)),
      );
      const chromeHeight = Math.max(
        0,
        Math.round(finite(popup.outerHeight, 0) - finite(popup.innerHeight, 0)),
      );
      const rawScreen = entry.geometryInput.screen || {};
      const contentScreen = {
        availHeight: Math.max(
          1,
          Math.round(finite(rawScreen.availHeight, 1)) - chromeHeight,
        ),
        availLeft: finite(rawScreen.availLeft, 0),
        availTop: finite(rawScreen.availTop, 0),
        availWidth: Math.max(
          1,
          Math.round(finite(rawScreen.availWidth, 1)) - chromeWidth,
        ),
      };
      const geometry = preclickPopupGeometry({
        ...entry.geometryInput,
        screen: contentScreen,
      });
      if (typeof popup.resizeTo === "function") {
        popup.resizeTo(
          geometry.width + chromeWidth,
          geometry.height + chromeHeight,
        );
      }
      if (typeof popup.moveTo === "function") {
        popup.moveTo(geometry.left, geometry.top);
      }
    } catch {
      // Browser popup policies may reject resize/move; initial geometry remains usable.
    }
  }

  function trackWindow(
    popup,
    kind,
    { geometryInput = null, imageAlt = "", imageUrl = "" } = {},
  ) {
    const id = nextWindowId;
    nextWindowId += 1;
    const entry = {
      id,
      geometryInput,
      imageAlt,
      imageUrl,
      kind,
      popup,
      closeTimerId: null,
    };
    if (kind !== "preclick") {
      entry.closeTimerId = setTimeoutFn(
        () => finalizeWindow(id, true),
        WINDOW_OBSTACLE_LIFETIME_MS,
      );
    }
    trackedWindows.set(id, entry);
    bindWindow(entry);
    fitPreclickWindow(entry);
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

  function openPreclickWindow({
    aspectRatio,
    clientX,
    clientY,
    delayMs = 0,
    imageAlt = "",
    imageUrl = "",
    width = PRECLICK_POPUP_WIDTH_PX,
  } = {}) {
    if (disposed) {
      return false;
    }
    const open = () => {
      if (disposed) {
        return false;
      }
      const origin = getViewportScreenOrigin() || {};
      const geometryInput = {
        aspectRatio,
        centerX: finite(origin.x, 0) + finite(clientX, 0),
        centerY: finite(origin.y, 0) + finite(clientY, 0),
        screen: getScreen(),
        width,
      };
      const geometry = preclickPopupGeometry(geometryInput);
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
        popup = null;
      }
      if (!popup) {
        return false;
      }
      trackWindow(popup, "preclick", {
        geometryInput,
        imageAlt,
        imageUrl,
      });
      return true;
    };
    const cleanDelayMs = clamp(Math.round(finite(delayMs, 0)), 0, 1000);
    if (cleanDelayMs === 0) {
      return open();
    }
    let timerId = null;
    timerId = setTimeoutFn(() => {
      pendingPreclickTimerIds.delete(timerId);
      open();
    }, cleanDelayMs);
    pendingPreclickTimerIds.add(timerId);
    return true;
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
    pendingPreclickTimerIds.forEach((timerId) => clearTimeoutFn(timerId));
    pendingPreclickTimerIds.clear();
    [...trackedWindows.entries()].forEach(([id, entry]) =>
      finalizeWindow(id, entry.kind !== "preclick"),
    );
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
        pendingPreclickWindowCount: pendingPreclickTimerIds.size,
        permission,
        schedulePending: scheduleTimerId !== null,
        trackedWindowCount: trackedWindows.size,
        wasInsideRange,
      };
    },
    isControlBlocked: () => activeObstacleCount() > 0,
    openPreclickWindow,
    refresh,
    testPopupPermission,
  });
}
