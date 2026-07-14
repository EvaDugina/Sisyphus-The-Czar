"use strict";

const crypto = require("node:crypto");
const Physics = require("../shared/physics");

const SNAPSHOT_INTERVAL_MS = 1000 / 20;
const DISCONNECT_GRACE_MS = 500;
const DISCONNECTED_CLIENT_TTL_MS = 60_000;
const DEFAULT_EMPTY_SESSION_GRACE_MS = 10_000;
const MAX_TRAIL_POINTS = 1000;
const POINTER_MODES = new Set(["grab", "grabbing"]);
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function socketIsOpen(socket) {
  return socket && socket.readyState === 1;
}

function tokensMatch(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string") {
    return false;
  }
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function sanitizeTrail(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.slice(-MAX_TRAIL_POINTS).flatMap((point) => {
    if (!Array.isArray(point) || point.length < 2) {
      return [];
    }
    const x = Number(point[0]);
    const y = Number(point[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return [];
    }
    return [
      [
        Math.round(Physics.clamp(x, 0, Physics.WORLD_WIDTH)),
        Math.round(Physics.clamp(y, 0, Physics.WORLD_HEIGHT)),
      ],
    ];
  });
}

class SessionManager {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs || 24 * 60 * 60 * 1000;
    this.emptyGraceMs =
      options.emptyGraceMs ?? DEFAULT_EMPTY_SESSION_GRACE_MS;
    this.now = options.now || Date.now;
    this.random = options.random || Math.random;
    this.logger = options.logger || (() => {});
    this.sessions = new Map();
  }

  createSession(payload = {}) {
    const now = this.now();
    const id = crypto.randomBytes(16).toString("base64url");
    const state = Physics.sanitizeState(payload.state);
    const physics = Physics.sanitizePhysics(payload.physics);

    if (state.phase === Physics.PHASES.WON) {
      state.vx = 0;
      state.vy = 0;
    }

    const session = {
      id,
      state,
      physics,
      trail: sanitizeTrail(payload.trail),
      imprint: Physics.sanitizeImprint(payload.imprint),
      clients: new Map(),
      revision: 1,
      createdAt: now,
      lastActivityAt: now,
      expiresAt: now + this.ttlMs,
      emptyDeleteAt: null,
      lastTickAt: now,
      accumulator: 0,
      nextSnapshotAt: now,
      lastTrailAt: now,
      firstFallAt: null,
      holdReleaseAt: null,
      lastPointer: { vx: 0, vy: 0 },
      dirty: true,
    };

    this.sessions.set(id, session);
    this.logger("session_created", { session: id.slice(0, 8) });
    return session;
  }

  serializeSessions() {
    return [...this.sessions.values()].map((session) => ({
      id: session.id,
      state: { ...session.state },
      physics: { ...session.physics },
      trail: session.trail.map((point) => [...point]),
      imprint: session.imprint ? { ...session.imprint } : null,
      revision: session.revision,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      expiresAt: session.expiresAt,
      emptyDeleteAt: session.emptyDeleteAt,
      lastPointer: { ...session.lastPointer },
    }));
  }

  restoreSessions(records) {
    if (!Array.isArray(records)) {
      return 0;
    }

    const now = this.now();
    let restored = 0;
    records.forEach((record) => {
      if (
        !record ||
        typeof record !== "object" ||
        !SESSION_ID_PATTERN.test(String(record.id || "")) ||
        this.sessions.has(record.id)
      ) {
        return;
      }

      const expiresAt = finite(record.expiresAt, now + this.ttlMs);
      const emptyDeleteAt = record.emptyDeleteAt === null
        ? null
        : finite(record.emptyDeleteAt, null);
      if (
        expiresAt <= now ||
        (emptyDeleteAt !== null && emptyDeleteAt <= now)
      ) {
        return;
      }

      const state = Physics.sanitizeState(record.state);
      const physics = Physics.sanitizePhysics(record.physics);
      const lastPointer = {
        vx: finite(record.lastPointer?.vx, 0),
        vy: finite(record.lastPointer?.vy, 0),
      };

      if (record.state?.dragging) {
        if (state.phase === Physics.PHASES.INTRO) {
          Physics.beginFirstFall(state, this.random);
        } else if (state.phase === Physics.PHASES.PLAY) {
          Physics.applyReleaseImpulse(
            state,
            physics,
            lastPointer.vx,
            lastPointer.vy
          );
        }
      }
      if (state.phase === Physics.PHASES.WON) {
        state.vx = 0;
        state.vy = 0;
      }

      const session = {
        id: record.id,
        state,
        physics,
        trail: sanitizeTrail(record.trail),
        imprint: Physics.sanitizeImprint(record.imprint),
        clients: new Map(),
        revision: Number.isSafeInteger(record.revision)
          ? Math.max(1, record.revision)
          : 1,
        createdAt: Math.min(finite(record.createdAt, now), now),
        lastActivityAt: Math.min(finite(record.lastActivityAt, now), now),
        expiresAt,
        emptyDeleteAt,
        lastTickAt: now,
        accumulator: 0,
        nextSnapshotAt: now,
        lastTrailAt: now,
        firstFallAt: null,
        holdReleaseAt: null,
        lastPointer,
        dirty: true,
      };

      this.sessions.set(session.id, session);
      restored += 1;
    });

    if (restored > 0) {
      this.logger("sessions_restored", { sessions: restored });
    }
    return restored;
  }

  getSession(id) {
    const session = this.sessions.get(id);
    if (!session) {
      return null;
    }

    if (
      session.emptyDeleteAt !== null &&
      this.now() >= session.emptyDeleteAt &&
      this.connectedCount(session) === 0
    ) {
      this.destroySession(session, 1000, "session_empty");
      return null;
    }

    if (
      this.now() >= session.expiresAt &&
      this.connectedCount(session) === 0
    ) {
      this.destroySession(session, 4004, "session_expired");
      return null;
    }

    if (this.now() >= session.expiresAt) {
      this.touch(session);
    }

    return session;
  }

  touch(session) {
    const now = this.now();
    session.lastActivityAt = now;
    session.expiresAt = now + this.ttlMs;
  }

  cancelEmptyCleanup(session) {
    session.emptyDeleteAt = null;
  }

  scheduleEmptyCleanup(session) {
    if (this.connectedCount(session) > 0) {
      this.cancelEmptyCleanup(session);
      return;
    }
    session.emptyDeleteAt = this.now() + this.emptyGraceMs;
    this.logger("session_empty_grace_started", {
      session: session.id.slice(0, 8),
      graceMs: this.emptyGraceMs,
    });
  }

  connectClient(session, clientId, socket) {
    const now = this.now();
    const previous = session.clients.get(clientId);

    if (previous && socketIsOpen(previous.socket) && previous.socket !== socket) {
      previous.socket.close(4001, "connection_replaced");
    }

    const client = previous || {
      id: clientId,
      lastSeq: -1,
      connectedAt: now,
      disconnectedAt: null,
    };

    client.socket = socket;
    client.lastSeq = -1;
    client.disconnectedAt = null;
    client.lastSeenAt = now;
    client.leaveToken = crypto.randomBytes(16).toString("base64url");
    client.pointer = {
      x: finite(client.pointer?.x, Physics.WORLD_WIDTH / 2),
      y: finite(client.pointer?.y, 0),
      mode: "grab",
      visible: false,
      updatedAt: now,
    };
    session.clients.set(clientId, client);
    this.cancelEmptyCleanup(session);
    this.touch(session);

    this.sendTo(client, "session.snapshot", {
      ...this.snapshot(session, true),
      leaveToken: client.leaveToken,
    });
    this.broadcastPresence(session);
    this.logger("client_connected", {
      session: session.id.slice(0, 8),
      participants: this.connectedCount(session),
    });
    return client;
  }

  disconnectClient(session, clientId, socket) {
    const client = session.clients.get(clientId);
    if (!client || client.socket !== socket) {
      return;
    }

    client.socket = null;
    client.disconnectedAt = this.now();
    client.pointer.visible = false;
    client.pointer.mode = "grab";
    client.pointer.updatedAt = this.now();
    this.touch(session);
    if (this.connectedCount(session) === 0) {
      this.scheduleEmptyCleanup(session);
    }
    this.broadcastPresence(session);
    this.logger("client_disconnected", {
      session: session.id.slice(0, 8),
      participants: this.connectedCount(session),
    });
  }

  leaveClient(session, clientId, leaveToken) {
    const client = session.clients.get(clientId);
    if (!client || !tokensMatch(leaveToken, client.leaveToken)) {
      return false;
    }

    const socket = client.socket;
    client.socket = null;
    client.disconnectedAt = this.now();
    client.pointer.visible = false;
    client.pointer.mode = "grab";
    client.pointer.updatedAt = this.now();

    if (session.state.controllerId === clientId) {
      this.finishRelease(
        session,
        session.lastPointer.vx,
        session.lastPointer.vy
      );
    }

    session.clients.delete(clientId);
    if (socketIsOpen(socket)) {
      socket.close(1000, "session_left");
    }

    this.logger("client_left", {
      session: session.id.slice(0, 8),
      participants: this.connectedCount(session),
    });

    if (this.connectedCount(session) === 0) {
      this.touch(session);
      this.scheduleEmptyCleanup(session);
      return true;
    }

    this.touch(session);
    this.broadcastPresence(session);
    return true;
  }

  connectedCount(session) {
    let count = 0;
    session.clients.forEach((client) => {
      if (socketIsOpen(client.socket)) {
        count += 1;
      }
    });
    return count;
  }

  handleMessage(session, client, message) {
    if (!message || message.v !== 1 || typeof message.type !== "string") {
      this.sendError(client, "invalid_envelope", "Некорректный формат сообщения");
      return;
    }

    if (!Number.isSafeInteger(message.seq) || message.seq <= client.lastSeq) {
      this.sendError(client, "stale_sequence", "Сообщение устарело");
      return;
    }

    client.lastSeq = message.seq;
    client.lastSeenAt = this.now();
    this.touch(session);
    const payload = message.payload && typeof message.payload === "object"
      ? message.payload
      : {};

    switch (message.type) {
      case "control.acquire":
        this.acquireControl(session, client, payload);
        break;
      case "control.move":
        this.moveControl(session, client, payload);
        break;
      case "control.release":
        this.releaseControl(session, client, payload);
        break;
      case "physics.update":
        this.updatePhysics(session, payload);
        break;
      case "session.restart":
        this.restartSession(session, payload);
        break;
      case "pointer.update":
        this.updatePointer(session, client, payload);
        break;
      case "ping":
        this.sendTo(client, "pong", {
          serverTime: this.now(),
          echo: payload.clientTime || null,
        });
        break;
      default:
        this.sendError(client, "unknown_type", "Неизвестный тип сообщения");
    }
  }

  acquireControl(session, client, payload = {}) {
    const state = session.state;
    if (![Physics.PHASES.INTRO, Physics.PHASES.PLAY].includes(state.phase)) {
      this.sendTo(client, "control.denied", { reason: "phase_locked" });
      return false;
    }

    if (state.controllerId && state.controllerId !== client.id) {
      this.sendTo(client, "control.denied", {
        reason: "busy",
        controllerId: state.controllerId,
      });
      return false;
    }

    state.controllerId = client.id;
    state.dragging = true;
    state.vx = 0;
    state.vy = 0;
    if (Number.isFinite(Number(payload.x))) {
      state.x = Physics.clamp(Number(payload.x), 0, Physics.WORLD_WIDTH);
    }
    if (Number.isFinite(Number(payload.y))) {
      state.y = Physics.clamp(Number(payload.y), 0, Physics.WORLD_HEIGHT);
    }
    if (state.phase === Physics.PHASES.INTRO && !session.imprint) {
      session.imprint = Physics.createImprintAtState(state, payload.imprint);
    }
    session.lastPointer = { vx: 0, vy: 0 };
    session.firstFallAt =
      state.phase === Physics.PHASES.INTRO
        ? this.now() + Physics.FIRST_FALL_DELAY_MS
        : null;
    session.holdReleaseAt = null;
    this.syncHoldRelease(session, this.now(), true);
    this.markChanged(session);

    this.sendTo(client, "control.granted", {
      controllerId: client.id,
      firstFallAt: session.firstFallAt,
      holdReleaseAt: session.holdReleaseAt,
    });
    if (payload.pointer) {
      this.updatePointer(session, client, payload.pointer);
    } else if (client.pointer.visible) {
      client.pointer.mode = "grabbing";
      client.pointer.updatedAt = this.now();
      this.broadcastPointer(session, client);
    }
    this.broadcastSnapshot(session);
    this.broadcastPresence(session);
    return true;
  }

  moveControl(session, client, payload = {}) {
    const state = session.state;
    if (!state.dragging || state.controllerId !== client.id) {
      return false;
    }

    state.x = Physics.clamp(finite(payload.x, state.x), 0, Physics.WORLD_WIDTH);
    state.y = Physics.clamp(finite(payload.y, state.y), 0, Physics.WORLD_HEIGHT);
    session.lastPointer = {
      vx: Physics.clamp(finite(payload.vx, session.lastPointer.vx), -4000, 4000),
      vy: Physics.clamp(finite(payload.vy, session.lastPointer.vy), -9000, 9000),
    };
    if (payload.pointer) {
      this.updatePointer(session, client, payload.pointer);
    }
    this.syncHoldRelease(session);
    this.markChanged(session);
    return true;
  }

  releaseControl(session, client, payload = {}) {
    if (
      !session.state.dragging ||
      session.state.controllerId !== client.id
    ) {
      return false;
    }

    const vx = finite(payload.vx, session.lastPointer.vx);
    const vy = finite(payload.vy, session.lastPointer.vy);
    session.state.x = Physics.clamp(
      finite(payload.x, session.state.x),
      0,
      Physics.WORLD_WIDTH
    );
    session.state.y = Physics.clamp(
      finite(payload.y, session.state.y),
      0,
      Physics.WORLD_HEIGHT
    );
    if (payload.pointer) {
      this.updatePointer(session, client, payload.pointer);
    }
    return this.finishRelease(session, vx, vy);
  }

  finishRelease(session, pointerVx, pointerVy) {
    const state = session.state;
    const phaseAtRelease = state.phase;
    const controller = state.controllerId
      ? session.clients.get(state.controllerId)
      : null;
    session.firstFallAt = null;
    session.holdReleaseAt = null;
    state.dragging = false;
    state.controllerId = null;
    if (controller?.pointer?.visible && controller.pointer.mode === "grabbing") {
      controller.pointer.mode = "grab";
      controller.pointer.updatedAt = this.now();
      this.broadcastPointer(session, controller);
    }

    if (phaseAtRelease === Physics.PHASES.INTRO) {
      Physics.beginFirstFall(state, this.random);
    } else if (
      phaseAtRelease === Physics.PHASES.PLAY &&
      Physics.stateInsideImprint(state, session.imprint)
    ) {
      state.vx = 0;
      state.vy = 0;
    } else {
      Physics.applyReleaseImpulse(
        state,
        session.physics,
        pointerVx,
        pointerVy
      );
    }

    this.markChanged(session);
    this.broadcastSnapshot(session);
    this.broadcastPresence(session);
    return true;
  }

  updatePhysics(session, payload) {
    session.physics = Physics.sanitizePhysics(
      { ...session.physics, ...payload },
      session.physics
    );
    this.syncHoldRelease(session, this.now(), true);
    this.markChanged(session);
    this.broadcastSnapshot(session);
  }

  holdReleasePaused(session) {
    return (
      session.state.dragging &&
      session.state.phase === Physics.PHASES.PLAY &&
      Physics.stateInsideImprint(session.state, session.imprint)
    );
  }

  syncHoldRelease(session, now = this.now(), reset = false) {
    if (
      !session.state.dragging ||
      session.state.phase !== Physics.PHASES.PLAY ||
      this.holdReleasePaused(session)
    ) {
      session.holdReleaseAt = null;
      return;
    }
    if (reset || session.holdReleaseAt === null) {
      session.holdReleaseAt = now + Physics.maxHoldMs(session.physics);
    }
  }

  restartSession(session, payload = {}) {
    const state = Physics.sanitizeState({
      phase: Physics.PHASES.INTRO,
      x: payload.x,
      y: payload.y,
      vx: 0,
      vy: 0,
      turbTime: 0,
    });
    state.phase = Physics.PHASES.INTRO;
    state.vx = 0;
    state.vy = 0;
    state.dragging = false;
    state.controllerId = null;
    state.turbTime = 0;

    session.state = state;
    session.trail = [];
    session.imprint = null;
    session.firstFallAt = null;
    session.holdReleaseAt = null;
    session.lastPointer = { vx: 0, vy: 0 };
    session.accumulator = 0;
    session.lastTickAt = this.now();
    session.nextSnapshotAt = this.now();
    session.lastTrailAt = this.now();
    session.clients.forEach((client) => {
      if (client.pointer?.mode === "grabbing") {
        client.pointer.mode = "grab";
        client.pointer.updatedAt = this.now();
      }
    });

    this.markChanged(session);
    this.broadcastSnapshot(session, true);
    this.broadcastPresence(session);
    return true;
  }

  updatePointer(session, client, payload = {}) {
    const x = Number(payload.x);
    const y = Number(payload.y);
    const visible = payload.visible;
    const mode = payload.mode;
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      x > Physics.WORLD_WIDTH ||
      y < 0 ||
      y > Physics.WORLD_HEIGHT ||
      typeof visible !== "boolean" ||
      !POINTER_MODES.has(mode)
    ) {
      this.sendError(client, "invalid_pointer", "Некорректное состояние указателя");
      return false;
    }
    if (mode === "grabbing" && session.state.controllerId !== client.id) {
      this.sendError(client, "pointer_not_controller", "Указатель не управляет камнем");
      return false;
    }

    client.pointer = {
      x,
      y,
      mode,
      visible,
      updatedAt: this.now(),
    };
    this.broadcastPointer(session, client);
    return true;
  }

  markChanged(session) {
    session.revision += 1;
    session.dirty = true;
  }

  recordTrailPoint(session, now) {
    if (now - session.lastTrailAt < SNAPSHOT_INTERVAL_MS) {
      return;
    }
    session.lastTrailAt = now;
    session.trail.push([
      Math.round(session.state.x),
      Math.round(session.state.y),
    ]);
    if (session.trail.length > MAX_TRAIL_POINTS) {
      session.trail.splice(0, session.trail.length - MAX_TRAIL_POINTS);
    }
  }

  tick(now = this.now()) {
    for (const session of [...this.sessions.values()]) {
      if (now >= session.expiresAt) {
        if (this.connectedCount(session) > 0) {
          this.touch(session);
        } else {
          this.destroySession(session, 4004, "session_expired");
          continue;
        }
      }

      if (
        session.emptyDeleteAt !== null &&
        now >= session.emptyDeleteAt &&
        this.connectedCount(session) === 0
      ) {
        this.destroySession(session, 1000, "session_empty");
        continue;
      }

      const controller = session.state.controllerId
        ? session.clients.get(session.state.controllerId)
        : null;
      if (
        session.state.dragging &&
        controller &&
        !socketIsOpen(controller.socket) &&
        controller.disconnectedAt !== null &&
        now - controller.disconnectedAt >= DISCONNECT_GRACE_MS
      ) {
        this.finishRelease(
          session,
          session.lastPointer.vx,
          session.lastPointer.vy
        );
      }

      session.clients.forEach((client, clientId) => {
        if (
          !socketIsOpen(client.socket) &&
          client.disconnectedAt !== null &&
          now - client.disconnectedAt >= DISCONNECTED_CLIENT_TTL_MS &&
          session.state.controllerId !== clientId
        ) {
          session.clients.delete(clientId);
        }
      });

      if (
        session.state.dragging &&
        session.firstFallAt !== null &&
        now >= session.firstFallAt
      ) {
        this.finishRelease(
          session,
          session.lastPointer.vx,
          session.lastPointer.vy
        );
      } else if (
        session.state.dragging &&
        session.holdReleaseAt !== null &&
        now >= session.holdReleaseAt
      ) {
        if (this.holdReleasePaused(session)) {
          session.holdReleaseAt = null;
          this.markChanged(session);
        } else {
          this.finishRelease(
            session,
            session.lastPointer.vx,
            session.lastPointer.vy
          );
        }
      }

      const elapsed = Math.min(Math.max((now - session.lastTickAt) / 1000, 0), 0.25);
      session.lastTickAt = now;
      session.accumulator = Math.min(
        session.accumulator + elapsed,
        Physics.FIXED_STEP_SECONDS * 5
      );

      let physicsChanged = false;
      while (
        session.accumulator >= Physics.FIXED_STEP_SECONDS &&
        Physics.isMoving(session.state)
      ) {
        Physics.stepState(
          session.state,
          session.physics,
          Physics.FIXED_STEP_SECONDS
        );
        session.accumulator -= Physics.FIXED_STEP_SECONDS;
        physicsChanged = true;
      }

      if (physicsChanged) {
        this.markChanged(session);
      } else if (!Physics.isMoving(session.state)) {
        session.accumulator = 0;
      }

      if (Physics.isMoving(session.state) || session.state.dragging) {
        this.recordTrailPoint(session, now);
      }

      if (session.dirty && now >= session.nextSnapshotAt) {
        this.broadcastSnapshot(session);
        session.nextSnapshotAt = now + SNAPSHOT_INTERVAL_MS;
      }
    }
  }

  snapshot(session, includeTrail = false) {
    const payload = {
      ...session.state,
      physics: { ...session.physics },
      imprint: session.imprint ? { ...session.imprint } : null,
      revision: session.revision,
      serverTime: this.now(),
      expiresAt: session.expiresAt,
    };
    if (includeTrail) {
      payload.trail = session.trail.map((point) => [...point]);
    }
    return payload;
  }

  broadcastSnapshot(session, includeTrail = false) {
    const payload = this.snapshot(session, includeTrail);
    session.clients.forEach((client) => {
      this.sendTo(client, "session.snapshot", payload);
    });
    session.dirty = false;
  }

  broadcastPresence(session) {
    const payload = {
      participants: this.connectedCount(session),
      controllerId: session.state.controllerId,
      pointers: [...session.clients.values()]
        .filter((client) => socketIsOpen(client.socket) && client.pointer?.visible)
        .map((client) => this.pointerPayload(client)),
    };
    session.clients.forEach((client) => {
      this.sendTo(client, "presence.update", payload);
    });
  }

  pointerPayload(client) {
    return {
      clientId: client.id,
      x: client.pointer.x,
      y: client.pointer.y,
      mode: client.pointer.mode,
      visible: client.pointer.visible,
      serverTime: this.now(),
    };
  }

  broadcastPointer(session, client) {
    const payload = this.pointerPayload(client);
    session.clients.forEach((participant) => {
      this.sendTo(participant, "pointer.update", payload);
    });
  }

  sendError(client, code, message) {
    this.sendTo(client, "error", { code, message });
  }

  sendTo(client, type, payload) {
    if (!socketIsOpen(client.socket)) {
      return false;
    }
    client.socket.send(JSON.stringify({ v: 1, type, payload }));
    return true;
  }

  destroySession(session, closeCode = 1001, reason = "session_closed") {
    if (!this.sessions.has(session.id)) {
      return;
    }
    session.clients.forEach((client) => {
      if (socketIsOpen(client.socket)) {
        client.socket.close(closeCode, reason);
      }
    });
    this.sessions.delete(session.id);
    this.logger("session_removed", { session: session.id.slice(0, 8), reason });
  }

  close() {
    this.sessions.forEach((session) => {
      this.destroySession(session, 1001, "server_shutdown");
    });
  }
}

module.exports = {
  SessionManager,
  DISCONNECT_GRACE_MS,
  SNAPSHOT_INTERVAL_MS,
  MAX_TRAIL_POINTS,
  DISCONNECTED_CLIENT_TTL_MS,
  DEFAULT_EMPTY_SESSION_GRACE_MS,
};
