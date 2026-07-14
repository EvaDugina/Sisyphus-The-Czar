"use strict";

const crypto = require("node:crypto");
const Physics = require("../shared/physics");

const SNAPSHOT_INTERVAL_MS = 1000 / 20;
const DISCONNECT_GRACE_MS = 500;
const DISCONNECTED_CLIENT_TTL_MS = 60_000;
const MAX_TRAIL_POINTS = 1000;
const POINTER_MODES = new Set(["grab", "grabbing"]);

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
      clients: new Map(),
      revision: 1,
      createdAt: now,
      lastActivityAt: now,
      expiresAt: now + this.ttlMs,
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

  getSession(id) {
    const session = this.sessions.get(id);
    if (!session) {
      return null;
    }

    if (this.now() >= session.expiresAt) {
      this.destroySession(session, 4004, "session_expired");
      return null;
    }

    return session;
  }

  touch(session) {
    const now = this.now();
    session.lastActivityAt = now;
    session.expiresAt = now + this.ttlMs;
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
        null,
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
      this.destroySession(session, 1000, "session_empty");
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
    session.lastPointer = { vx: 0, vy: 0 };
    session.firstFallAt =
      state.phase === Physics.PHASES.INTRO
        ? this.now() + Physics.FIRST_FALL_DELAY_MS
        : null;
    session.holdReleaseAt =
      state.phase === Physics.PHASES.PLAY
        ? this.now() + Physics.maxHoldMs(session.physics)
        : null;
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
    if (payload.pointer) {
      this.updatePointer(session, client, payload.pointer);
    }
    return this.finishRelease(session, payload.target, vx, vy);
  }

  finishRelease(session, target, pointerVx, pointerVy) {
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
      this.isInsideTarget(state, target)
    ) {
      state.phase = Physics.PHASES.WON;
      state.vx = 0;
      state.vy = 0;
      state.x = Physics.clamp((finite(target.minX) + finite(target.maxX)) / 2, 0, Physics.WORLD_WIDTH);
      state.y = Physics.clamp((finite(target.minY) + finite(target.maxY)) / 2, 0, Physics.WORLD_HEIGHT);
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

  isInsideTarget(state, target) {
    if (!target || typeof target !== "object") {
      return false;
    }

    if (
      ![target.minX, target.maxX, target.minY, target.maxY].every((value) =>
        Number.isFinite(Number(value))
      )
    ) {
      return false;
    }

    const minX = Physics.clamp(finite(target.minX), 0, Physics.WORLD_WIDTH);
    const maxX = Physics.clamp(finite(target.maxX), 0, Physics.WORLD_WIDTH);
    const minY = Physics.clamp(finite(target.minY), 0, Physics.WORLD_HEIGHT);
    const maxY = Physics.clamp(finite(target.maxY), 0, Physics.WORLD_HEIGHT);
    if (maxX < minX || maxY < minY) {
      return false;
    }
    return state.x >= minX && state.x <= maxX && state.y >= minY && state.y <= maxY;
  }

  updatePhysics(session, payload) {
    session.physics = Physics.sanitizePhysics(
      { ...session.physics, ...payload },
      session.physics
    );
    if (session.state.dragging && session.state.phase === Physics.PHASES.PLAY) {
      session.holdReleaseAt = this.now() + Physics.maxHoldMs(session.physics);
    }
    this.markChanged(session);
    this.broadcastSnapshot(session);
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
        this.destroySession(session, 4004, "session_expired");
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
          null,
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
          null,
          session.lastPointer.vx,
          session.lastPointer.vy
        );
      } else if (
        session.state.dragging &&
        session.holdReleaseAt !== null &&
        now >= session.holdReleaseAt
      ) {
        this.finishRelease(
          session,
          null,
          session.lastPointer.vx,
          session.lastPointer.vy
        );
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
      revision: session.revision,
      serverTime: this.now(),
      expiresAt: session.expiresAt,
    };
    if (includeTrail) {
      payload.trail = session.trail.map((point) => [...point]);
    }
    return payload;
  }

  broadcastSnapshot(session) {
    const payload = this.snapshot(session, false);
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
};
