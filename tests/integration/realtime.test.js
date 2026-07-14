"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
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
      payload: { x: 480, y: 4900, mode: "grab", visible: true },
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
        vx: 0,
        vy: 0,
        pointer: { x: 480, y: 4900, mode: "grab", visible: true },
      },
    })
  );
  await second.waitFor(
    "session.snapshot",
    (payload) => payload.dragging === false && payload.controllerId === null
  );

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
      payload: { gravity: 1.7 },
    })
  );
  const synced = await first.waitFor(
    "session.snapshot",
    (payload) => payload.physics && payload.physics.gravity === 1.7
  );
  assert.equal(synced.payload.controllerId, "integration-client-b");

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
  assert.equal(service.manager.sessions.has(sessionId), false);
});
