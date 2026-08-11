import test from "node:test";
import assert from "node:assert/strict";

import {
  WINDOW_OBSTACLE_LIFETIME_MS,
  WINDOW_OBSTACLE_PERMISSION,
  createWindowObstacleController,
  preclickPopupGeometry,
  randomStepBetween,
  windowObstacleHeightFromStartVh,
} from "../../src/runtime/createWindowObstacleController.js";

function createClock() {
  let now = 0;
  let nextId = 1;
  const timeouts = new Map();
  const intervals = new Map();

  function nextTaskBefore(target) {
    let candidate = null;
    timeouts.forEach((task, id) => {
      if (task.at <= target && (!candidate || task.at < candidate.at)) {
        candidate = { ...task, id, kind: "timeout" };
      }
    });
    intervals.forEach((task, id) => {
      if (task.at <= target && (!candidate || task.at < candidate.at)) {
        candidate = { ...task, id, kind: "interval" };
      }
    });
    return candidate;
  }

  return {
    clearInterval(id) {
      intervals.delete(id);
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
    intervalCount() {
      return intervals.size;
    },
    setInterval(callback, delay) {
      const id = nextId++;
      intervals.set(id, {
        at: now + delay,
        callback,
        delay,
      });
      return id;
    },
    setTimeout(callback, delay) {
      const id = nextId++;
      timeouts.set(id, { at: now + delay, callback });
      return id;
    },
    tick(duration) {
      const target = now + duration;
      let task = nextTaskBefore(target);
      while (task) {
        now = task.at;
        if (task.kind === "timeout") {
          timeouts.delete(task.id);
        } else if (intervals.has(task.id)) {
          intervals.get(task.id).at += task.delay;
        }
        task.callback();
        task = nextTaskBefore(target);
      }
      now = target;
    },
    timeoutCount() {
      return timeouts.size;
    },
  };
}

function createPopup() {
  const listeners = new Map();
  const body = {
    children: [],
    replaceChildren(...children) {
      this.children = children;
    },
    style: {},
  };
  return {
    closed: false,
    close() {
      this.closed = true;
    },
    click() {
      listeners.get("click")?.();
    },
    document: {
      addEventListener(type, callback) {
        listeners.set(type, callback);
      },
      body,
      createElement(tagName) {
        return {
          alt: null,
          src: "",
          style: {},
          tagName: String(tagName).toUpperCase(),
        };
      },
      title: "not-empty",
    },
  };
}

function defaultSettings() {
  return {
    windowObstacleEnabled: true,
    windowObstacleMaxHeightPx: 480,
    windowObstacleMaxHeightVh: 1500,
    windowObstacleMaxIntervalSeconds: 0.5,
    windowObstacleMaxWidthPx: 640,
    windowObstacleMinHeightPx: 160,
    windowObstacleMinHeightVh: 1000,
    windowObstacleMinIntervalSeconds: 0.5,
    windowObstacleMinWidthPx: 240,
  };
}

function setup({ blocked = false } = {}) {
  const clock = createClock();
  const settings = defaultSettings();
  const height = { value: 1200 };
  const popups = [];
  const activeCounts = [];
  const permissions = [];
  const popupState = { blocked };
  const controller = createWindowObstacleController({
    clearIntervalFn: (id) => clock.clearInterval(id),
    clearTimeoutFn: (id) => clock.clearTimeout(id),
    getHeightVh: () => height.value,
    getScreen: () => ({
      availHeight: 900,
      availLeft: 10,
      availTop: 20,
      availWidth: 1200,
    }),
    getSettings: () => settings,
    getViewportScreenOrigin: () => ({ x: 100, y: 200 }),
    onActiveWindowsChange: (count) => activeCounts.push(count),
    onPermissionChange: (permission) => permissions.push(permission),
    openPopup: (_url, _target, features) => {
      if (popupState.blocked) {
        return null;
      }
      const popup = createPopup();
      popups.push({ features, popup });
      return popup;
    },
    random: () => 0,
    setIntervalFn: (callback, delay) => clock.setInterval(callback, delay),
    setTimeoutFn: (callback, delay) => clock.setTimeout(callback, delay),
  });
  return {
    activeCounts,
    clock,
    controller,
    height,
    permissions,
    popups,
    popupState,
    settings,
  };
}

test("высота препятствия отсчитывается от нижней точки подъёма", () => {
  assert.equal(windowObstacleHeightFromStartVh(760, 760, 800), 0);
  assert.equal(windowObstacleHeightFromStartVh(360, 760, 800), 50);
  assert.equal(windowObstacleHeightFromStartVh(800, 760, 800), 0);
  assert.equal(randomStepBetween(101, 139, 10, () => 0), 110);
  assert.equal(randomStepBetween(101, 139, 10, () => 1), 130);
});

test("фейковый клик с задержкой открывает незакрываемое окно с rock.webp", () => {
  const { clock, controller, popups } = setup();
  assert.deepEqual(
    preclickPopupGeometry({
      aspectRatio: 2048 / 1692,
      centerX: 700,
      centerY: 600,
      screen: {
        availHeight: 900,
        availLeft: 10,
        availTop: 20,
        availWidth: 1200,
      },
      width: 120,
    }),
    { height: 99, left: 640, top: 551, width: 120 },
  );

  assert.equal(
    controller.openPreclickWindow({
      aspectRatio: 2048 / 1692,
      clientX: 600,
      clientY: 400,
      delayMs: 200,
      imageUrl: "/assets/rock/rock.webp",
      width: 120,
    }),
    true,
  );
  assert.equal(popups.length, 0);
  assert.equal(controller.getState().pendingPreclickWindowCount, 1);
  clock.tick(199);
  assert.equal(popups.length, 0);
  clock.tick(1);
  assert.equal(controller.getState().pendingPreclickWindowCount, 0);
  assert.match(popups[0].features, /width=120/);
  assert.match(popups[0].features, /height=99/);
  assert.match(popups[0].features, /left=640/);
  assert.match(popups[0].features, /top=551/);
  assert.equal(popups[0].popup.document.body.children.length, 1);
  assert.deepEqual(popups[0].popup.document.body.children[0], {
    alt: "Камень",
    src: "/assets/rock/rock.webp",
    style: {
      display: "block",
      height: "100vh",
      objectFit: "contain",
      width: "100vw",
    },
    tagName: "IMG",
  });
  assert.equal(controller.isControlBlocked(), false);
  assert.equal(controller.getState().trackedWindowCount, 1);

  clock.tick(WINDOW_OBSTACLE_LIFETIME_MS);
  assert.equal(popups[0].popup.closed, false);
  popups[0].popup.click();
  assert.equal(popups[0].popup.closed, false);
  controller.dispose();
  assert.equal(popups[0].popup.closed, false);
});

test("dispose отменяет только ещё не открытый preclick-popup", () => {
  const { clock, controller, popups } = setup();
  assert.equal(controller.openPreclickWindow({ delayMs: 1000 }), true);
  assert.equal(controller.getState().pendingPreclickWindowCount, 1);
  controller.dispose();
  clock.tick(1000);
  assert.equal(popups.length, 0);
});

test("окна перекрываются, закрываются независимо и не создают дублирующий таймер", () => {
  const { activeCounts, clock, controller, height, popups } = setup();

  controller.refresh();
  controller.refresh();
  assert.equal(controller.getState().schedulePending, true);
  assert.equal(clock.timeoutCount(), 1);

  clock.tick(500);
  assert.equal(popups.length, 1);
  assert.match(popups[0].features, /width=240/);
  assert.match(popups[0].features, /height=160/);
  assert.equal(controller.isControlBlocked(), true);

  clock.tick(500);
  assert.equal(popups.length, 2);
  assert.equal(controller.getState().activeWindowCount, 2);

  height.value = 1600;
  controller.refresh();
  assert.equal(controller.getState().schedulePending, false);
  assert.equal(controller.getState().activeWindowCount, 2);

  popups[0].popup.click();
  assert.equal(popups[0].popup.closed, true);
  assert.equal(popups[1].popup.closed, false);
  assert.equal(controller.getState().activeWindowCount, 1);

  clock.tick(WINDOW_OBSTACLE_LIFETIME_MS - 1);
  assert.equal(controller.getState().activeWindowCount, 1);
  clock.tick(1);
  assert.equal(popups[1].popup.closed, true);
  assert.equal(controller.isControlBlocked(), false);
  assert.deepEqual(activeCounts, [1, 2, 1, 0]);

  height.value = 1200;
  controller.refresh();
  assert.equal(controller.getState().schedulePending, true);
  controller.dispose();
  assert.equal(clock.timeoutCount(), 0);
  assert.equal(clock.intervalCount(), 0);
});

test("popup-блокировка приостанавливает генерацию до успешной проверки", () => {
  const { clock, controller, permissions, popups, popupState } = setup({
    blocked: true,
  });

  controller.refresh();
  clock.tick(500);
  assert.equal(controller.getState().permission, WINDOW_OBSTACLE_PERMISSION.BLOCKED);
  assert.equal(controller.getState().schedulePending, false);
  assert.equal(controller.getState().activeWindowCount, 0);
  controller.refresh();
  assert.equal(controller.getState().schedulePending, false);

  popupState.blocked = false;
  assert.equal(controller.testPopupPermission(), true);
  assert.equal(controller.getState().permission, WINDOW_OBSTACLE_PERMISSION.TEST_OPENED);
  assert.equal(controller.getState().activeWindowCount, 0);
  popups[0].popup.click();
  assert.equal(controller.getState().permission, WINDOW_OBSTACLE_PERMISSION.ALLOWED);
  assert.equal(controller.getState().schedulePending, true);
  assert.deepEqual(permissions, [
    WINDOW_OBSTACLE_PERMISSION.UNCHECKED,
    WINDOW_OBSTACLE_PERMISSION.BLOCKED,
    WINDOW_OBSTACLE_PERMISSION.TEST_OPENED,
    WINDOW_OBSTACLE_PERMISSION.ALLOWED,
  ]);
});
