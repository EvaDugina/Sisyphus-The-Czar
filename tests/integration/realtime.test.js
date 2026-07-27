"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");
const { createService } = require("../../server");
const {
  DEFAULT_SESSION_ID,
  TRAIL_SYNC_INTERVAL_MS,
} = require("../../server/session-manager");

function connect(url) {
  const socket = new WebSocket(url);
  const messages = [];
  const waiters = [];
  let sequence = 0;

  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString("utf8"));
    messages.push(message);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (
        waiter.type === message.type &&
        (!waiter.predicate || waiter.predicate(message.payload))
      ) {
        waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    }
  });

  const opened = new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const closed = new Promise((resolve) => {
    socket.once("close", (code, reason) => {
      resolve({ code, reason: reason.toString("utf8") });
    });
  });

  return {
    socket,
    messages,
    opened,
    closed,
    send(type, payload = {}) {
      sequence += 1;
      socket.send(JSON.stringify({ v: 1, type, seq: sequence, payload }));
    },
    waitFor(type, predicate, timeoutMs = 1500) {
      const existing = messages.find(
        (message) =>
          message.type === type &&
          (!predicate || predicate(message.payload))
      );
      if (existing) {
        return Promise.resolve(existing);
      }
      return new Promise((resolve, reject) => {
        const waiter = { type, predicate, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) {
            waiters.splice(index, 1);
          }
          reject(new Error(`timeout waiting for ${type}`));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
  };
}

async function createSession(base, clientId) {
  const response = await fetch(`${base}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      creatorClientId: clientId,
      state: {
        phase: "play",
        x: 500,
        y: 1000,
        vx: 0,
        vy: 0,
        suspended: true,
      },
    }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function waitUntil(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("timeout waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function startService(context, options = {}) {
  const service = createService({
    port: 0,
    host: "127.0.0.1",
    debug: options.debug ?? false,
    sessionStorePath: "",
    settingsTemplateStorePath: options.settingsTemplateStorePath || "",
    logger: () => {},
  });
  const address = await service.start();
  context.after(async () => service.close());
  return {
    service,
    base: `http://127.0.0.1:${address.port}`,
    wsBase: `ws://127.0.0.1:${address.port}/realtime`,
  };
}

test("API создаёт уникальные single-client комнаты, root-hub недоступен", async (context) => {
  const { service, base, wsBase } = await startService(context);
  const firstCreated = await createSession(base, "integration-client-a001");
  const secondCreated = await createSession(base, "integration-client-b001");

  assert.match(firstCreated.sessionId, /^[A-Za-z0-9_-]{22}$/);
  assert.match(secondCreated.sessionId, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(firstCreated.sessionId, secondCreated.sessionId);
  assert.notEqual(firstCreated.sessionId, DEFAULT_SESSION_ID);
  assert.equal(
    service.manager.getSession(firstCreated.sessionId).singleClient,
    true
  );

  const first = connect(
    `${wsBase}?session=${firstCreated.sessionId}&client=integration-client-a001`
  );
  await first.opened;
  await first.waitFor("session.snapshot");
  await first.waitFor("trail.history");

  const rejected = connect(
    `${wsBase}?session=${firstCreated.sessionId}&client=integration-client-x001`
  );
  await rejected.opened;
  const occupied = await rejected.waitFor("error");
  assert.equal(occupied.payload.code, "session_occupied");
  assert.deepEqual(await rejected.closed, {
    code: 4009,
    reason: "session_occupied",
  });
  assert.equal(
    service.manager.connectedCount(
      service.manager.getSession(firstCreated.sessionId)
    ),
    1
  );

  first.socket.close();
  await first.closed;
  assert.equal(service.manager.sessions.has(firstCreated.sessionId), false);
});

test("debug-каталог шаблонов общий для разных личных сессий", async (context) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "sisyphus-shared-templates-")
  );
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { service, base, wsBase } = await startService(context, {
    debug: true,
    settingsTemplateStorePath: path.join(directory, "settings.json"),
  });
  const firstCreated = await createSession(base, "catalog-browser-a001");
  const secondCreated = await createSession(base, "catalog-browser-b001");
  const first = connect(
    `${wsBase}?session=${firstCreated.sessionId}&client=catalog-browser-a001`
  );
  const second = connect(
    `${wsBase}?session=${secondCreated.sessionId}&client=catalog-browser-b001`
  );
  await Promise.all([first.opened, second.opened]);
  const [firstPage, secondPage] = await Promise.all([
    first.waitFor("settingsTemplates.page"),
    second.waitFor("settingsTemplates.page"),
  ]);
  assert.deepEqual(firstPage.payload.entries, []);
  assert.deepEqual(secondPage.payload.entries, []);

  const entry = {
    id: "shared-browser-template",
    name: "Межбраузерный шаблон",
    settingsSchemaVersion: 18,
    createdAt: "2026-07-27T19:00:00.000Z",
    updatedAt: "2026-07-27T19:00:00.000Z",
    settings: { gravity: 8.25, sceneHeightScreens: 7 },
  };
  first.send("settingsTemplates.save", { entry });
  const [saved, changed] = await Promise.all([
    first.waitFor("settingsTemplates.saved"),
    second.waitFor(
      "settingsTemplates.changed",
      (payload) =>
        payload.action === "upsert" &&
        payload.entries?.some((item) => item.id === entry.id),
    ),
  ]);
  assert.equal(saved.payload.entry.id, entry.id);
  assert.equal(changed.payload.entries[0].settings.gravity, 8.25);
  assert.equal(
    service.manager.getSession(secondCreated.sessionId).physics.gravity,
    9.8,
  );

  const thirdCreated = await createSession(base, "catalog-browser-c001");
  const third = connect(
    `${wsBase}?session=${thirdCreated.sessionId}&client=catalog-browser-c001`
  );
  await third.opened;
  const thirdPage = await third.waitFor("settingsTemplates.page");
  assert.equal(thirdPage.payload.entries[0].id, entry.id);
  assert.equal(
    third.messages.find(
      (message) => message.type === "productionPreset.current",
    ).payload.canSelect,
    false,
  );

  second.send("settingsTemplates.delete", { id: entry.id });
  await Promise.all([
    first.waitFor(
      "settingsTemplates.changed",
      (payload) => payload.action === "delete" && payload.id === entry.id,
    ),
    third.waitFor(
      "settingsTemplates.changed",
      (payload) => payload.action === "delete" && payload.id === entry.id,
    ),
  ]);

  first.socket.close();
  second.socket.close();
  third.socket.close();
  await Promise.all([first.closed, second.closed, third.closed]);
});

test("между комнатами передаются только подтверждаемые trail-дельты раз в 30 секунд", async (context) => {
  const { service, base, wsBase } = await startService(context);
  assert.equal(service.manager.trailSyncIntervalMs, TRAIL_SYNC_INTERVAL_MS);

  const firstCreated = await createSession(base, "integration-trail-a001");
  const secondCreated = await createSession(base, "integration-trail-b001");
  const first = connect(
    `${wsBase}?session=${firstCreated.sessionId}&client=integration-trail-a001`
  );
  const second = connect(
    `${wsBase}?session=${secondCreated.sessionId}&client=integration-trail-b001`
  );
  await Promise.all([first.opened, second.opened]);
  await Promise.all([
    first.waitFor("session.snapshot"),
    second.waitFor("session.snapshot"),
  ]);
  const [firstHistory, secondHistory] = await Promise.all([
    first.waitFor("trail.history"),
    second.waitFor("trail.history"),
  ]);
  first.send("trail.ack", { cursor: firstHistory.payload.cursor });
  second.send("trail.ack", { cursor: secondHistory.payload.cursor });
  const secondSnapshotCountBeforeForeignBroadcast = second.messages.filter(
    (message) => message.type === "session.snapshot"
  ).length;
  assert.ok(secondSnapshotCountBeforeForeignBroadcast >= 1);

  const firstSession = service.manager.getSession(firstCreated.sessionId);
  const secondSession = service.manager.getSession(secondCreated.sessionId);
  firstSession.state.x = 111;
  firstSession.state.y = 222;
  service.manager.recordTrailPoint(firstSession, Date.now() + 1000);
  service.manager.markChanged(firstSession);
  service.manager.broadcastSnapshot(firstSession);

  assert.equal(secondSession.state.x, 500);
  assert.equal(secondSession.state.y, 1000);
  assert.equal(
    second.messages.filter((message) => message.type === "session.snapshot")
      .length,
    secondSnapshotCountBeforeForeignBroadcast
  );
  assert.equal(
    service.manager.broadcastSharedTrailBatches(
      service.manager.nextTrailSyncAt - 1
    ),
    false
  );
  assert.equal(
    second.messages.some((message) => message.type === "trail.batch"),
    false
  );

  const firstSyncAt = service.manager.nextTrailSyncAt;
  assert.equal(
    service.manager.broadcastSharedTrailBatches(firstSyncAt),
    true
  );
  const firstBatch = await second.waitFor(
    "trail.batch",
    (payload) => payload.points.length === 1
  );
  assert.deepEqual(firstBatch.payload.points, [[111, 222]]);
  second.send("trail.ack", { cursor: firstBatch.payload.cursor });
  await waitUntil(
    () =>
      secondSession.clients.get("integration-trail-b001")?.trailCursor ===
      firstBatch.payload.cursor
  );

  firstSession.state.x = 333;
  firstSession.state.y = 444;
  service.manager.recordTrailPoint(firstSession, Date.now() + 2000);
  const secondSyncAt = service.manager.nextTrailSyncAt;
  service.manager.broadcastSharedTrailBatches(secondSyncAt);
  const secondBatch = await second.waitFor(
    "trail.batch",
    (payload) =>
      payload.cursor > firstBatch.payload.cursor &&
      payload.points.some((point) => point[0] === 333)
  );
  assert.equal(secondBatch.payload.baseCursor, firstBatch.payload.cursor);
  assert.deepEqual(secondBatch.payload.points, [[333, 444]]);

  const newcomerCreated = await createSession(
    base,
    "integration-trail-new01"
  );
  const newcomer = connect(
    `${wsBase}?session=${newcomerCreated.sessionId}&client=integration-trail-new01`
  );
  await newcomer.opened;
  const newcomerHistory = await newcomer.waitFor("trail.history");
  assert.deepEqual(newcomerHistory.payload.points.slice(-2), [
    [111, 222],
    [333, 444],
  ]);

  first.socket.close();
  second.socket.close();
  newcomer.socket.close();
});

test("leave-token немедленно закрывает личную сессию", async (context) => {
  const { service, base, wsBase } = await startService(context);
  const created = await createSession(base, "integration-leave-a001");
  const client = connect(
    `${wsBase}?session=${created.sessionId}&client=integration-leave-a001`
  );
  await client.opened;
  const snapshot = await client.waitFor("session.snapshot");

  const invalid = await fetch(
    `${base}/api/sessions/${created.sessionId}/leave`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "integration-leave-a001",
        leaveToken: "AAAAAAAAAAAAAAAAAAAAAA",
      }),
    }
  );
  assert.equal(invalid.status, 403);
  assert.equal(service.manager.sessions.has(created.sessionId), true);

  const left = await fetch(`${base}/api/sessions/${created.sessionId}/leave`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: "integration-leave-a001",
      leaveToken: snapshot.payload.leaveToken,
    }),
  });
  assert.equal(left.status, 204);
  assert.equal(service.manager.sessions.has(created.sessionId), false);
  assert.equal((await client.closed).reason, "session_left");
});

test("общая история следов переживает штатный restart сервиса", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sisyphus-trail-"));
  const sessionStorePath = path.join(directory, "sessions.json");
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const firstService = createService({
    port: 0,
    host: "127.0.0.1",
    debug: false,
    sessionStorePath,
    logger: () => {},
  });
  const firstAddress = await firstService.start();
  const firstBase = `http://127.0.0.1:${firstAddress.port}`;
  const firstCreated = await createSession(
    firstBase,
    "integration-persist-a01"
  );
  const firstSession = firstService.manager.getSession(firstCreated.sessionId);
  firstSession.state.x = 321;
  firstSession.state.y = 654;
  firstService.manager.recordTrailPoint(firstSession, Date.now() + 1000);
  await firstService.close();

  const secondService = createService({
    port: 0,
    host: "127.0.0.1",
    debug: false,
    sessionStorePath,
    logger: () => {},
  });
  const secondAddress = await secondService.start();
  context.after(async () => secondService.close());
  const secondBase = `http://127.0.0.1:${secondAddress.port}`;
  const secondCreated = await createSession(
    secondBase,
    "integration-persist-b01"
  );
  const restored = connect(
    `ws://127.0.0.1:${secondAddress.port}/realtime?session=${secondCreated.sessionId}&client=integration-persist-b01`
  );
  await restored.opened;
  const history = await restored.waitFor("trail.history");
  assert.deepEqual(history.payload.points.at(-1), [321, 654]);
  restored.socket.close();
});
