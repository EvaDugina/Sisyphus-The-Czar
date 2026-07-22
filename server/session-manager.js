"use strict";

const crypto = require("node:crypto");
const Physics = require("../shared/physics");
const RoomSettings = require("../shared/room-settings");
const GachiSounds = require("../shared/gachi-sounds");

const SNAPSHOT_INTERVAL_MS = 1000 / 20;
const DISCONNECT_GRACE_MS = 500;
const DISCONNECTED_CLIENT_TTL_MS = 60_000;
const DEFAULT_EMPTY_SESSION_GRACE_MS = 10_000;
const POINTER_VELOCITY_MAX_AGE_MS = 150;
const MAX_TRAIL_POINTS = 1000;
const POINTER_MODES = new Set(["grab", "grabbing"]);
const CLIENT_ROLES = new Set(["master", "slave"]);
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const REQUIRED_HOLDERS = 1;
const SLIP_DELAY_MIN_MS = 500;
const SLIP_DELAY_MAX_MS = 2000;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function socketIsOpen(socket) {
  return socket && socket.readyState === 1;
}

function pointerVelocityAt(pointer, updatedAt, now) {
  const age = now - finite(updatedAt, 0);
  if (age < 0 || age > POINTER_VELOCITY_MAX_AGE_MS) {
    return { vx: 0, vy: 0 };
  }
  return {
    vx: Physics.clamp(finite(pointer?.vx, 0), -4000, 4000),
    vy: Physics.clamp(finite(pointer?.vy, 0), -9000, 9000),
  };
}

function sceneMotionOptions(session) {
  return {
    motionScale: RoomSettings.sceneMotionMultiplier(session.roomSettings),
  };
}

function rescaleSceneVerticalMotion(
  session,
  previousRoomSettings,
  nextRoomSettings
) {
  const previousScale = RoomSettings.sceneMotionMultiplier(previousRoomSettings);
  const nextScale = RoomSettings.sceneMotionMultiplier(nextRoomSettings);
  if (previousScale <= 0 || Math.abs(previousScale - nextScale) < 1e-9) {
    return;
  }
  const ratio = nextScale / previousScale;
  session.state.vy *= ratio;
  session.lastPointer.vy *= ratio;
  session.holders.forEach((holder) => {
    holder.vy *= ratio;
  });
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

function normalizeClientId(value) {
  const clientId = String(value || "");
  return CLIENT_ID_PATTERN.test(clientId) ? clientId : null;
}

function clientRole(value) {
  if (value === "primary") {
    return "master";
  }
  if (value === "partner") {
    return "slave";
  }
  return CLIENT_ROLES.has(value) ? value : "slave";
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
    this.soundRandom = options.soundRandom || Math.random;
    this.logger = options.logger || (() => {});
    this.sessions = new Map();
    this.slaveSoundAssignments = new Map();
  }

  createSession(payload = {}) {
    const now = this.now();
    const id = crypto.randomBytes(16).toString("base64url");
    const state = Physics.sanitizeState(
      payload.state ?? {
        phase: Physics.PHASES.PLAY,
        x: Physics.WORLD_WIDTH / 2,
        y: Physics.WORLD_HEIGHT,
      }
    );
    const physics = Physics.sanitizePhysics(payload.physics);
    const roomSettings = RoomSettings.sanitizeRoomSettings(payload.roomSettings);

    if (state.phase === Physics.PHASES.WON) {
      state.vx = 0;
      state.vy = 0;
    }

    const session = {
      id,
      state,
      physics,
      roomSettings,
      trail: sanitizeTrail(payload.trail),
      imprint:
        Physics.createSummitImprint(payload.imprint),
      masterClientId: normalizeClientId(
        payload.creatorClientId || payload.masterClientId
      ),
      clients: new Map(),
      holders: new Map(),
      revision: 1,
      createdAt: now,
      lastActivityAt: now,
      expiresAt: now + this.ttlMs,
      emptyDeleteAt: null,
      lastTickAt: now,
      accumulator: 0,
      nextSnapshotAt: now,
      lastTrailAt: now,
      groundTouchSeq: Math.max(0, Number(payload.groundTouchSeq) || 0),
      firstFallAt: null,
      holdReleaseAt: null,
      lastPointer: { vx: 0, vy: 0 },
      lastPointerAt: now,
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
      physicsVersion: Physics.PHYSICS_VERSION,
      roomSettings: { ...session.roomSettings },
      roomSettingsVersion: RoomSettings.ROOM_SETTINGS_VERSION,
      trail: session.trail.map((point) => [...point]),
      imprint: session.imprint ? { ...session.imprint } : null,
      masterClientId: session.masterClientId,
      revision: session.revision,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      expiresAt: session.expiresAt,
      emptyDeleteAt: session.emptyDeleteAt,
      lastPointer: { ...session.lastPointer },
      lastPointerAt: session.lastPointerAt,
      groundTouchSeq: session.groundTouchSeq,
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
      const physics = Physics.sanitizePhysics(
        Physics.migratePhysics(record.physics, record.physicsVersion)
      );
      const roomSettings = RoomSettings.sanitizeRoomSettings(
        RoomSettings.migrateRoomSettings(
          record.roomSettings,
          record.roomSettingsVersion
        )
      );
      const lastPointer = {
        vx: finite(record.lastPointer?.vx, 0),
        vy: finite(record.lastPointer?.vy, 0),
      };
      const lastPointerAt = finite(record.lastPointerAt, 0);
      const releasePointer = pointerVelocityAt(lastPointer, lastPointerAt, now);

      if (record.state?.dragging) {
        if (state.phase === Physics.PHASES.INTRO) {
          Physics.beginFirstFall(state, physics, {
            motionScale: RoomSettings.sceneMotionMultiplier(roomSettings),
          });
        } else if (state.phase === Physics.PHASES.PLAY) {
          Physics.applyReleaseImpulse(
            state,
            physics,
            releasePointer.vx,
            releasePointer.vy
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
        roomSettings,
        trail: sanitizeTrail(record.trail),
        imprint:
          Physics.createSummitImprint(record.imprint),
        masterClientId: normalizeClientId(record.masterClientId),
        clients: new Map(),
        holders: new Map(),
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
        groundTouchSeq: Math.max(0, Number(record.groundTouchSeq) || 0),
        firstFallAt: null,
        holdReleaseAt: null,
        lastPointer,
        lastPointerAt,
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

  ensureMasterClientId(session, clientId) {
    const normalizedClientId = normalizeClientId(clientId);
    if (!session.masterClientId && normalizedClientId) {
      session.masterClientId = normalizedClientId;
      this.markChanged(session);
    }
    return session.masterClientId;
  }

  assignClientRole(session, clientId) {
    this.ensureMasterClientId(session, clientId);
    return session.masterClientId === clientId ? "master" : "slave";
  }

  assignSlaveSound(clientId) {
    const existing = this.slaveSoundAssignments.get(clientId);
    if (existing) {
      return existing;
    }
    const filenames = GachiSounds.GACHI_SOUND_FILENAMES;
    if (filenames.length === 0) {
      return null;
    }
    const index = Math.min(
      filenames.length - 1,
      Math.floor(Math.max(0, this.soundRandom()) * filenames.length)
    );
    const filename = filenames[index];
    this.slaveSoundAssignments.set(clientId, filename);
    return filename;
  }

  slipDelayMs() {
    return Math.round(
      SLIP_DELAY_MIN_MS +
        this.random() * (SLIP_DELAY_MAX_MS - SLIP_DELAY_MIN_MS)
    );
  }

  holderIds(session) {
    return [...session.holders.keys()].filter((clientId) =>
      session.clients.has(clientId)
    );
  }

  holderCount(session) {
    return this.holderIds(session).length;
  }

  holderVelocity(session, holder, now = this.now()) {
    return pointerVelocityAt(
      { vx: holder.vx, vy: holder.vy },
      holder.lastMoveAt,
      now
    );
  }

  syncCooperativeDrag(session, now = this.now()) {
    const holderIds = this.holderIds(session);
    const state = session.state;
    const wasDragging = state.dragging;

    session.holdReleaseAt = holderIds.reduce((earliest, clientId) => {
      const holder = session.holders.get(clientId);
      if (!holder || holder.slipAt === null) {
        return earliest;
      }
      return earliest === null ? holder.slipAt : Math.min(earliest, holder.slipAt);
    }, null);

    if (!Physics.canLift(session.physics, holderIds.length)) {
      state.dragging = false;
      state.controllerId = null;
      if (holderIds.length > 0 && state.phase === Physics.PHASES.PLAY) {
        state.vx = 0;
          state.vy = Math.max(
            state.vy,
            Physics.dragDropSpeed(
              session.physics,
              holderIds.length,
              sceneMotionOptions(session)
            )
          );
      } else if (wasDragging && state.phase === Physics.PHASES.PLAY) {
        state.vy = Math.max(0, state.vy);
      }
      return;
    }

    let x = 0;
    let y = 0;
    let vx = 0;
    let vy = 0;
    holderIds.forEach((clientId) => {
      const holder = session.holders.get(clientId);
      const velocity = this.holderVelocity(session, holder, now);
      x += holder.x;
      y += holder.y;
      vx += velocity.vx;
      vy += velocity.vy;
    });

    const count = holderIds.length;
    state.dragging = true;
    state.controllerId = holderIds[0] || null;
    state.vx = 0;
    state.vy = 0;
    state.x = Physics.clamp(x / count, 0, Physics.WORLD_WIDTH);
    state.y = Physics.clamp(y / count, 0, Physics.WORLD_HEIGHT);
    session.lastPointer = {
      vx: Physics.clamp(vx / count, -4000, 4000),
      vy: Physics.clamp(vy / count, -9000, 9000),
    };
    session.lastPointerAt = now;
    session.firstFallAt = null;
  }

  removeHolder(session, clientId, options = {}) {
    const holder = session.holders.get(clientId);
    if (!holder) {
      return false;
    }

    const now = this.now();
    const wasDragging = session.state.dragging;
    const releaseVelocity = options.applyReleaseImpulse
      ? this.holderVelocity(session, holder, now)
      : { vx: 0, vy: 0 };
    const notify = options.notify !== false;
    const reason = options.reason || "released";
    const client = session.clients.get(clientId);
    session.holders.delete(clientId);
    if (client?.pointer) {
      client.pointer.mode = "grab";
      client.pointer.updatedAt = now;
      this.broadcastPointer(session, client);
    }
    this.syncCooperativeDrag(session, now);
    if (
      options.applyReleaseImpulse &&
      wasDragging &&
      !session.state.dragging &&
      session.state.phase === Physics.PHASES.PLAY
    ) {
      Physics.applyReleaseImpulse(
        session.state,
        session.physics,
        releaseVelocity.vx,
        releaseVelocity.vy
      );
    }
    this.markChanged(session);
    this.broadcastSnapshot(session);
    this.broadcastPresence(session);
    if (notify && client) {
      this.sendTo(client, "control.slipped", {
        reason,
        holderIds: this.holderIds(session),
        requiredHolders: REQUIRED_HOLDERS,
      });
    }
    return true;
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
      role: null,
    };

    client.role = this.assignClientRole(session, clientId);
    client.gachiSoundFilename =
      client.role === "slave" ? this.assignSlaveSound(clientId) : null;
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
      clientRole: client.role,
      gachiSoundFilename: client.gachiSoundFilename,
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
    this.removeHolder(session, clientId, { notify: false, reason: "disconnect" });
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

    this.removeHolder(session, clientId, { notify: false, reason: "leave" });

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
      case "session.start":
        this.startSession(session, payload);
        break;
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
      case "roomSettings.update":
        this.updateRoomSettings(session, payload);
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

  startSession(session, payload = {}) {
    const state = session.state;
    if (
      state.phase !== Physics.PHASES.INTRO ||
      state.dragging ||
      this.holderCount(session) > 0
    ) {
      return false;
    }

    session.imprint = Physics.createSummitImprint(payload.imprint);
    if (payload.physics && typeof payload.physics === "object") {
      session.physics = Physics.sanitizePhysics(
        { ...session.physics, ...payload.physics },
        session.physics
      );
    }
    if (payload.roomSettings && typeof payload.roomSettings === "object") {
      session.roomSettings = RoomSettings.sanitizeRoomSettings(
        { ...session.roomSettings, ...payload.roomSettings },
        session.roomSettings
      );
    }
    session.firstFallAt = null;
    session.holdReleaseAt = null;
    session.lastPointer = { vx: 0, vy: 0 };
    session.lastPointerAt = this.now();
    Physics.beginFirstFall(state, session.physics, sceneMotionOptions(session));
    this.markChanged(session);
    this.broadcastSnapshot(session);
    return true;
  }

  acquireControl(session, client, payload = {}) {
    const state = session.state;
    if (state.phase !== Physics.PHASES.PLAY) {
      this.sendTo(client, "control.denied", { reason: "phase_locked" });
      return false;
    }

    const now = this.now();
    state.suspended = false;
    session.holders.set(client.id, {
      x: Physics.clamp(finite(payload.x, state.x), 0, Physics.WORLD_WIDTH),
      y: Physics.clamp(finite(payload.y, state.y), 0, Physics.WORLD_HEIGHT),
      vx: 0,
      vy: 0,
      acquiredAt: now,
      lastMoveAt: now,
      slipAt: now + this.slipDelayMs(),
    });
    session.firstFallAt = null;
    this.syncCooperativeDrag(session, now);
    this.markChanged(session);

    this.sendTo(client, "control.granted", {
      holderId: client.id,
      holderIds: this.holderIds(session),
      requiredHolders: REQUIRED_HOLDERS,
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
    const holder = session.holders.get(client.id);
    if (!holder) {
      return false;
    }

    holder.x = Physics.clamp(finite(payload.x, state.x), 0, Physics.WORLD_WIDTH);
    holder.y = Physics.clamp(finite(payload.y, state.y), 0, Physics.WORLD_HEIGHT);
    holder.vx = Physics.clamp(finite(payload.vx, holder.vx), -4000, 4000);
    holder.vy = Physics.clamp(finite(payload.vy, holder.vy), -9000, 9000);
    holder.lastMoveAt = this.now();
    if (payload.pointer) {
      this.updatePointer(session, client, payload.pointer);
    }
    this.syncCooperativeDrag(session);
    this.markChanged(session);
    return true;
  }

  releaseControl(session, client, payload = {}) {
    const holder = session.holders.get(client.id);
    if (!holder) {
      return false;
    }

    holder.x = Physics.clamp(finite(payload.x, holder.x), 0, Physics.WORLD_WIDTH);
    holder.y = Physics.clamp(finite(payload.y, holder.y), 0, Physics.WORLD_HEIGHT);
    holder.vx = Physics.clamp(finite(payload.vx, holder.vx), -4000, 4000);
    holder.vy = Physics.clamp(finite(payload.vy, holder.vy), -9000, 9000);
    holder.lastMoveAt = this.now();
    if (payload.pointer) {
      this.updatePointer(session, client, payload.pointer);
    }
    this.syncCooperativeDrag(session);
    return this.removeHolder(session, client.id, {
      applyReleaseImpulse: true,
      notify: false,
      reason: "released",
    });
  }

  updatePhysics(session, payload) {
    const sourcePayload =
      payload && typeof payload === "object" ? payload : {};
    const nextPayload =
      !Object.hasOwn(sourcePayload, "groundFriction") &&
      Object.hasOwn(sourcePayload, "sliding")
        ? { ...sourcePayload, groundFriction: sourcePayload.sliding }
        : sourcePayload;
    session.physics = Physics.sanitizePhysics(
      { ...session.physics, ...nextPayload },
      session.physics
    );
    this.syncCooperativeDrag(session);
    this.markChanged(session);
    this.broadcastSnapshot(session);
  }

  updateRoomSettings(session, payload) {
    const sourcePayload =
      payload && typeof payload === "object" ? payload : {};
    const previousRoomSettings = session.roomSettings;
    const nextRoomSettings = RoomSettings.sanitizeRoomSettings(
      { ...session.roomSettings, ...sourcePayload },
      session.roomSettings
    );
    rescaleSceneVerticalMotion(session, previousRoomSettings, nextRoomSettings);
    session.roomSettings = nextRoomSettings;
    this.markChanged(session);
    this.broadcastSnapshot(session);
  }

  restartSession(session, payload = {}) {
    const state = Physics.sanitizeState({
      phase: payload.phase || Physics.PHASES.PLAY,
      x: payload.x ?? Physics.WORLD_WIDTH / 2,
      y: payload.y ?? Physics.WORLD_HEIGHT,
      vx: 0,
      vy: 0,
      suspended: Boolean(payload.suspended),
      turbTime: 0,
    });
    if (state.phase === Physics.PHASES.INTRO || state.phase === Physics.PHASES.WON) {
      state.phase = Physics.PHASES.PLAY;
    }
    state.vx = 0;
    state.vy = 0;
    state.dragging = false;
    state.controllerId = null;
    state.suspended = state.phase === Physics.PHASES.PLAY && state.suspended;
    state.turbTime = 0;

    session.state = state;
    session.trail = [];
    session.imprint = Physics.createSummitImprint(payload.imprint);
    session.holders.clear();
    session.firstFallAt = null;
    session.holdReleaseAt = null;
    session.lastPointer = { vx: 0, vy: 0 };
    session.lastPointerAt = this.now();
    session.accumulator = 0;
    session.lastTickAt = this.now();
    session.nextSnapshotAt = this.now();
    session.lastTrailAt = this.now();
    session.clients.forEach((client) => {
      client.pointer.mode = "grab";
      client.pointer.visible = false;
      client.pointer.updatedAt = this.now();
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
    if (mode === "grabbing" && !session.holders.has(client.id)) {
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

      this.holderIds(session).forEach((clientId) => {
        const client = session.clients.get(clientId);
        if (
          client &&
          !socketIsOpen(client.socket) &&
          client.disconnectedAt !== null &&
          now - client.disconnectedAt >= DISCONNECT_GRACE_MS
        ) {
          this.removeHolder(session, clientId, {
            notify: false,
            reason: "disconnect",
          });
        }
      });

      session.clients.forEach((client, clientId) => {
        if (
          !socketIsOpen(client.socket) &&
          client.disconnectedAt !== null &&
          now - client.disconnectedAt >= DISCONNECTED_CLIENT_TTL_MS &&
          !session.holders.has(clientId)
        ) {
          session.clients.delete(clientId);
        }
      });

      this.holderIds(session).forEach((clientId) => {
        const holder = session.holders.get(clientId);
        if (
          holder &&
          holder.slipAt !== null &&
          now >= holder.slipAt &&
          !Physics.stateInsideImprint(session.state, session.imprint)
        ) {
          this.removeHolder(session, clientId, {
            notify: true,
            reason: "slipped",
          });
        }
      });

      const elapsed = Math.min(Math.max((now - session.lastTickAt) / 1000, 0), 0.25);
      session.lastTickAt = now;
      session.accumulator = Math.min(
        session.accumulator + elapsed,
        Physics.FIXED_STEP_SECONDS * 5
      );

      let physicsChanged = false;
      let groundTouched = false;
      while (
        session.accumulator >= Physics.FIXED_STEP_SECONDS &&
        Physics.isMoving(session.state)
      ) {
        const wasAboveGround = session.state.y < Physics.WORLD_HEIGHT - 0.01;
        Physics.stepState(
          session.state,
          session.physics,
          Physics.FIXED_STEP_SECONDS,
          sceneMotionOptions(session)
        );
        if (wasAboveGround && session.state.y >= Physics.WORLD_HEIGHT - 0.01) {
          groundTouched = true;
        }
        session.accumulator -= Physics.FIXED_STEP_SECONDS;
        physicsChanged = true;
      }

      if (groundTouched) {
        session.groundTouchSeq += 1;
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
      roomSettings: { ...session.roomSettings },
      imprint: session.imprint ? { ...session.imprint } : null,
      holderIds: this.holderIds(session),
      requiredHolders: REQUIRED_HOLDERS,
      masterClientId: session.masterClientId,
      groundTouchSeq: session.groundTouchSeq,
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
      holderIds: this.holderIds(session),
      requiredHolders: REQUIRED_HOLDERS,
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
      role: clientRole(client.role),
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
  REQUIRED_HOLDERS,
  SLIP_DELAY_MIN_MS,
  SLIP_DELAY_MAX_MS,
};
