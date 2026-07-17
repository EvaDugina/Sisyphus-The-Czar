"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");
const { createService } = require("../../server");
const Physics = require("../../shared/physics");

function connect(url) {
  const socket = new WebSocket(url);
  const messages = [];
  const waiters = [];

  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString("utf8"));
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (waiter.type === message.type && waiter.predicate(message.payload || {})) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    }
  });

  const opened = new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  function waitFor(type, predicate = () => true, timeoutMs = 3000) {
    const existing = messages.find(
      (message) => message.type === type && predicate(message.payload || {})
    );
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const waiter = { type, predicate, resolve };
      waiters.push(waiter);
      setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) {
          waiters.splice(index, 1);
          reject(new Error(`Timeout waiting for ${type}`));
        }
      }, timeoutMs).unref();
    });
  }

  return { socket, opened, waitFor };
}

test("два WebSocket-клиента делят состояние и передают управление", async (context) => {
  const service = createService({
    port: 0,
    host: "127.0.0.1",
    debug: true,
    emptyGraceMs: 50,
    logger: () => {},
  });
  const address = await service.start();
  context.after(async () => service.close());
  const base = `http://127.0.0.1:${address.port}`;

  const created = await fetch(`${base}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      state: { phase: Physics.PHASES.PLAY, x: 500, y: Physics.WORLD_HEIGHT },
      physics: { gravity: 1, bounce: 0 },
    }),
  });
  assert.equal(created.status, 201);
  const { sessionId } = await created.json();

  const wsBase = `ws://127.0.0.1:${address.port}/realtime?session=${sessionId}`;
  const first = connect(`${wsBase}&client=integration-client-a`);
  const second = connect(`${wsBase}&client=integration-client-b`);
  await Promise.all([first.opened, second.opened]);
  const [firstSnapshot, secondSnapshot] = await Promise.all([
    first.waitFor("session.snapshot"),
    second.waitFor("session.snapshot"),
  ]);

  first.socket.send(
    JSON.stringify({
      v: 1,
      type: "pointer.update",
      seq: 1,
      payload: {
        x: 480,
        y: Physics.WORLD_HEIGHT - 100,
        mode: "grab",
        visible: true,
      },
    })
  );
  const sharedPointer = await second.waitFor(
    "pointer.update",
    (payload) => payload.clientId === "integration-client-a" && payload.mode === "grab"
  );
  assert.equal(sharedPointer.payload.x, 480);

  first.socket.send(
    JSON.stringify({
      v: 1,
      type: "control.acquire",
      seq: 2,
      payload: {
        x: 500,
        y: Physics.WORLD_HEIGHT,
        pointer: {
          x: 480,
          y: Physics.WORLD_HEIGHT - 100,
          mode: "grabbing",
          visible: true,
        },
      },
    })
  );
  await first.waitFor("control.granted");
  await second.waitFor(
    "pointer.update",
    (payload) => payload.clientId === "integration-client-a" && payload.mode === "grabbing"
  );

  second.socket.send(
    JSON.stringify({
      v: 1,
      type: "control.acquire",
      seq: 1,
      payload: { x: 500, y: Physics.WORLD_HEIGHT },
    })
  );
  await second.waitFor("control.denied", (payload) => payload.reason === "busy");

  first.socket.send(
    JSON.stringify({
      v: 1,
      type: "control.release",
      seq: 3,
      payload: {
        x: 505,
        y: Physics.WORLD_HEIGHT,
        vx: 0,
        vy: 0,
        pointer: {
          x: 480,
          y: Physics.WORLD_HEIGHT - 100,
          mode: "grab",
          visible: true,
        },
      },
    })
  );
  const released = await second.waitFor(
    "session.snapshot",
    (payload) =>
      payload.dragging === false &&
      payload.controllerId === null &&
      payload.x === 505
  );
  assert.equal(released.payload.x, 505);

  second.socket.send(
    JSON.stringify({
      v: 1,
      type: "control.acquire",
      seq: 2,
      payload: { x: 500, y: Physics.WORLD_HEIGHT },
    })
  );
  await second.waitFor("control.granted");

  second.socket.send(
    JSON.stringify({
      v: 1,
      type: "physics.update",
      seq: 3,
      payload: { gravity: 10 },
    })
  );
  const synced = await first.waitFor(
    "session.snapshot",
    (payload) => payload.physics && payload.physics.gravity === 10
  );
  assert.equal(synced.payload.controllerId, "integration-client-b");

  first.socket.send(
    JSON.stringify({
      v: 1,
      type: "session.restart",
      seq: 4,
      payload: { x: 321, y: 654 },
    })
  );
  const restarted = await second.waitFor(
    "session.snapshot",
    (payload) =>
      payload.revision > synced.payload.revision &&
      payload.phase === Physics.PHASES.INTRO
  );
  assert.equal(restarted.payload.x, 321);
  assert.equal(restarted.payload.y, 654);
  assert.equal(restarted.payload.dragging, false);
  assert.equal(restarted.payload.controllerId, null);
  assert.equal(restarted.payload.physics.gravity, 10);
  assert.deepEqual(restarted.payload.trail, []);
  assert.equal(restarted.payload.imprint, null);

  second.socket.send(
    JSON.stringify({
      v: 1,
      type: "control.acquire",
      seq: 4,
      payload: { x: 321, y: 654 },
    })
  );
  await second.waitFor(
    "control.denied",
    (payload) => payload.reason === "phase_locked"
  );

  first.socket.send(
    JSON.stringify({
      v: 1,
      type: "session.start",
      seq: 5,
      payload: { imprint: { toleranceX: 45, toleranceY: 35 } },
    })
  );
  const startedByScroll = await second.waitFor(
    "session.snapshot",
    (payload) =>
      payload.revision > restarted.payload.revision &&
      payload.phase === Physics.PHASES.FALLING
  );
  assert.equal(startedByScroll.payload.dragging, false);
  assert.equal(startedByScroll.payload.controllerId, null);
  assert.deepEqual(startedByScroll.payload.imprint, {
    x: 321,
    y: 654,
    toleranceX: 45,
    toleranceY: 35,
  });

  const invalidLeave = await fetch(`${base}/api/sessions/${sessionId}/leave`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: "integration-client-a",
      leaveToken: "AAAAAAAAAAAAAAAAAAAAAA",
    }),
  });
  assert.equal(invalidLeave.status, 403);
  assert.equal(service.manager.sessions.has(sessionId), true);

  const firstLeave = await fetch(`${base}/api/sessions/${sessionId}/leave`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: "integration-client-a",
      leaveToken: firstSnapshot.payload.leaveToken,
    }),
  });
  assert.equal(firstLeave.status, 204);
  assert.equal(service.manager.sessions.has(sessionId), true);
  await second.waitFor(
    "presence.update",
    (payload) => payload.participants === 1
  );

  const secondLeave = await fetch(`${base}/api/sessions/${sessionId}/leave`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: "integration-client-b",
      leaveToken: secondSnapshot.payload.leaveToken,
    }),
  });
  assert.equal(secondLeave.status, 204);
  assert.equal(service.manager.sessions.has(sessionId), true);

  await new Promise((resolve) => setTimeout(resolve, 60));
  service.manager.tick();
  assert.equal(service.manager.sessions.has(sessionId), false);
});

test("сессия переживает restart сервиса с тем же хранилищем", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sisyphus-restart-"));
  const storePath = path.join(directory, "sessions.json");
  const activeServices = new Set();
  context.after(async () => {
    for (const service of activeServices) {
      await service.close();
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const firstService = createService({
    port: 0,
    host: "127.0.0.1",
    debug: true,
    sessionStorePath: storePath,
    persistIntervalMs: 10,
    logger: () => {},
  });
  activeServices.add(firstService);
  const firstAddress = await firstService.start();
  const created = await fetch(
    `http://127.0.0.1:${firstAddress.port}/api/sessions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: {
          phase: Physics.PHASES.PLAY,
          x: 321,
          y: Physics.WORLD_HEIGHT,
          vx: 0,
          vy: 0,
        },
        physics: { mass: 77, gravity: 8, turbulence: 0 },
        imprint: { x: 300, y: 700, toleranceX: 40, toleranceY: 30 },
        trail: [[10, 20], [30, 40]],
      }),
    }
  );
  const { sessionId } = await created.json();
  assert.equal(created.status, 201);

  await firstService.close();
  activeServices.delete(firstService);

  const secondService = createService({
    port: 0,
    host: "127.0.0.1",
    debug: true,
    sessionStorePath: storePath,
    logger: () => {},
  });
  activeServices.add(secondService);
  const secondAddress = await secondService.start();
  assert.equal(secondService.manager.sessions.has(sessionId), true);

  const restored = connect(
    `ws://127.0.0.1:${secondAddress.port}/realtime?session=${sessionId}&client=restart-client-001`
  );
  await restored.opened;
  const snapshot = await restored.waitFor("session.snapshot");

  assert.equal(snapshot.payload.phase, Physics.PHASES.PLAY);
  assert.equal(snapshot.payload.x, 321);
  assert.equal(snapshot.payload.y, Physics.WORLD_HEIGHT);
  assert.equal(snapshot.payload.physics.mass, 77);
  assert.equal(snapshot.payload.physics.gravity, 8);
  assert.equal(snapshot.payload.imprint.x, 300);
  assert.deepEqual(snapshot.payload.trail, [[10, 20], [30, 40]]);
  restored.socket.close();
});
