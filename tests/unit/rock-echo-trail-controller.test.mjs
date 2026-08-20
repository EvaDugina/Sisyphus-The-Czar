import test from "node:test";
import assert from "node:assert/strict";

import {
  createRockEchoTrailController,
  sanitizeRockEchoTrailSettings,
} from "../../src/runtime/createRockEchoTrailController.js";

function styleDeclaration() {
  return {
    setProperty(name, value) {
      this[name] = value;
    },
  };
}

function setup() {
  let timestamp = 0;
  let nextTimerId = 1;
  const timers = new Map();
  const sourceRect = { left: 100, top: 200, width: 80, height: 60 };
  const container = {
    children: [],
    append(node) {
      node.parent = this;
      this.children.push(node);
    },
    getBoundingClientRect() {
      return { left: 10, top: 20 };
    },
  };
  const source = {
    cloneNode() {
      return {
        style: styleDeclaration(),
        removeAttribute() {},
        setAttribute(name, value) {
          this[name] = value;
        },
        remove() {
          if (this.parent) {
            this.parent.children = this.parent.children.filter(
              (candidate) => candidate !== this,
            );
          }
        },
      };
    },
    getBoundingClientRect() {
      return { ...sourceRect };
    },
  };
  const settings = {
    rockEchoTrailEnabled: true,
    rockEchoTrailCopies: 2,
    rockEchoTrailIntervalMs: 50,
    rockEchoTrailOpacity: 0.6,
    rockEchoTrailLifetimeMs: 500,
  };
  const controller = createRockEchoTrailController({
    container,
    source,
    getSettings: () => settings,
    now: () => timestamp,
    clearTimeoutFn: (id) => timers.delete(id),
    setTimeoutFn: (callback, delay) => {
      const id = nextTimerId++;
      timers.set(id, { at: timestamp + delay, callback });
      return id;
    },
  });
  return {
    container,
    controller,
    moveTo(left, top, at) {
      sourceRect.left = left;
      sourceRect.top = top;
      timestamp = at;
    },
    settings,
    tickTo(at) {
      timestamp = at;
      [...timers.entries()]
        .filter(([, timer]) => timer.at <= at)
        .sort((left, right) => left[1].at - right[1].at)
        .forEach(([id, timer]) => {
          timers.delete(id);
          timer.callback();
        });
    },
  };
}

test("настройки эхо-следа ограничиваются безопасными диапазонами", () => {
  assert.deepEqual(
    sanitizeRockEchoTrailSettings({
      rockEchoTrailEnabled: 1,
      rockEchoTrailCopies: 99,
      rockEchoTrailIntervalMs: 1,
      rockEchoTrailOpacity: 2,
      rockEchoTrailLifetimeMs: 99_999,
    }),
    {
      enabled: true,
      copies: 40,
      intervalMs: 16,
      opacity: 1,
      lifetimeMs: 5000,
    },
  );
});

test("движение создаёт дискретные копии, соблюдает интервал и лимит", () => {
  const { container, controller, moveTo } = setup();
  assert.equal(controller.record(), false);

  moveTo(110, 200, 0);
  assert.equal(controller.record(), true);
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].style.left, "90px");
  assert.equal(container.children[0].style["--rock-echo-opacity"], "0.6");

  moveTo(120, 200, 20);
  assert.equal(controller.record(), false);
  moveTo(130, 200, 50);
  assert.equal(controller.record(), true);
  moveTo(140, 200, 100);
  assert.equal(controller.record(), true);

  assert.equal(container.children.length, 2);
  assert.deepEqual(
    container.children.map((node) => node.style.left),
    ["100px", "120px"],
  );
  assert.equal(controller.getState().echoCount, 2);
});

test("выключение и истечение lifetime очищают эхо-копии", () => {
  const { container, controller, moveTo, settings, tickTo } = setup();
  controller.record();
  moveTo(110, 200, 0);
  controller.record();
  assert.equal(container.children.length, 1);

  tickTo(500);
  assert.equal(container.children.length, 0);

  controller.record();
  moveTo(120, 200, 550);
  controller.record();
  settings.rockEchoTrailEnabled = false;
  controller.sync();
  assert.equal(container.children.length, 0);
  assert.equal(controller.getState().enabled, false);
});
