"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SessionStore } = require("../../server/session-store");

test("session store атомарно сохраняет и загружает комнаты", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sisyphus-store-"));
  const filePath = path.join(directory, "sessions.json");
  try {
    const store = new SessionStore(filePath);
    const sessions = [{ id: "AAAAAAAAAAAAAAAAAAAAAA", revision: 7 }];

    assert.equal(store.save(sessions), true);
    assert.equal(store.save(sessions), false);
    assert.deepEqual(new SessionStore(filePath).load(), sessions);
    assert.deepEqual(
      fs.readdirSync(directory).filter((name) => name.endsWith(".tmp")),
      []
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("повреждённый session store не останавливает сервер", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sisyphus-store-"));
  const filePath = path.join(directory, "sessions.json");
  const events = [];
  try {
    fs.writeFileSync(filePath, "{broken", "utf8");
    const store = new SessionStore(filePath, {
      logger: (event) => events.push(event),
    });

    assert.deepEqual(store.load(), []);
    assert.deepEqual(events, ["session_store_load_error"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
