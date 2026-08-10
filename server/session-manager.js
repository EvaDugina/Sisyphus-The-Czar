"use strict";

const crypto = require("node:crypto");
const Physics = require("../shared/physics");
const RoomSettings = require("../shared/room-settings");
const ChainSounds = require("../shared/chain-sounds");

const SNAPSHOT_INTERVAL_MS = 1000 / 20;
const DISCONNECT_GRACE_MS = 500;
const DISCONNECTED_CLIENT_TTL_MS = 60_000;
const DEFAULT_EMPTY_SESSION_GRACE_MS = 10_000;
const POINTER_VELOCITY_MAX_AGE_MS = 150;
const HARD_TRAIL_LIMIT = 10_000;
const MAX_TRAIL_POINTS = HARD_TRAIL_LIMIT;
const MAX_TRAIL_EVENTS = 1000;
const MAX_TRAIL_BATCH_POINTS = 64;
const VISUAL_TRAIL_POINT_VERSION = 2;
const TRAIL_SYNC_INTERVAL_MS = 30_000;
const MAX_ROCK_POINTER_OFFSET = 4;
const POINTER_MODES = new Set(["grab", "grabbing"]);
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const DEFAULT_SESSION_ID = "SisyphusGlobalRoom0000";
const SLIP_DELAY_MIN_MS = 500;
const SLIP_DELAY_MAX_MS = 2000;
const STATIONARY_HOLD_RELEASE_MS = 200;
const STATIONARY_POSITION_EPSILON = 0.01;
const DEFAULT_AUDIO_LEAD_MS = 200;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundNetworkNumber(value, fallback = 0) {
  return Math.round(finite(value, fallback) * 100) / 100;
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
    forceDeficitCurve: RoomSettings.parseCubicBezier(
      session.roomSettings.handForceDeficitEasing
    ),
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
  if (session.holder) {
    const holder = session.holder;
    holder.vy *= ratio;
  }
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

function trailPointLimit(roomSettings) {
  const configured = Number(roomSettings?.trailMaxPoints);
  return Math.min(
    HARD_TRAIL_LIMIT,
    Number.isSafeInteger(configured) && configured > 0
      ? configured
      : HARD_TRAIL_LIMIT,
  );
}

function trimTrailToRoomSettings(trail, roomSettings) {
  const limit = trailPointLimit(roomSettings);
  const overflow = trail.length - limit;
  if (overflow > 0) {
    trail.splice(0, overflow);
  }
}

function sanitizeTrail(input, roomSettings) {
  if (!Array.isArray(input)) {
    return [];
  }

  const limit = trailPointLimit(roomSettings);
  const source = input.slice(-limit);
  return source.flatMap((point) => {
    if (!Array.isArray(point) || point.length < 2) {
      return [];
    }
    const x = Number(point[0]);
    const y = Number(point[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return [];
    }
    const visual = Number(point[2]) === VISUAL_TRAIL_POINT_VERSION;
    const cleanX = Physics.clamp(x, 0, Physics.WORLD_WIDTH);
    const cleanY = Physics.clamp(y, 0, Physics.WORLD_HEIGHT);
    return [[
      visual ? roundNetworkNumber(cleanX) : Math.round(cleanX),
      visual ? roundNetworkNumber(cleanY) : Math.round(cleanY),
      ...(visual ? [VISUAL_TRAIL_POINT_VERSION] : []),
    ]];
  });
}

function hasSessionBootstrapPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  return [
    "state",
    "physics",
    "roomSettings",
    "imprint",
    "trail",
  ].some((key) => Object.hasOwn(payload, key));
}

function settingsEqual(left, right, keys) {
  return keys.every((key) => {
    if (Array.isArray(left[key]) || Array.isArray(right[key])) {
      return JSON.stringify(left[key] || []) === JSON.stringify(right[key] || []);
    }
    return Object.is(left[key], right[key]);
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
    this.slipDelayMinMs = Math.max(
      0,
      finite(options.slipDelayMinMs, SLIP_DELAY_MIN_MS)
    );
    this.slipDelayMaxMs = Math.max(
      this.slipDelayMinMs,
      finite(options.slipDelayMaxMs, SLIP_DELAY_MAX_MS)
    );
    this.stationaryHoldReleaseMs = Math.max(
      0,
      finite(options.stationaryHoldReleaseMs, STATIONARY_HOLD_RELEASE_MS)
    );
    this.audioLeadMs = Math.max(
      0,
      finite(options.audioLeadMs, DEFAULT_AUDIO_LEAD_MS)
    );
    this.trailSyncIntervalMs = Math.max(
      1,
      finite(options.trailSyncIntervalMs, TRAIL_SYNC_INTERVAL_MS)
    );
    this.productionPresetSelectionEnabled =
      options.productionPresetSelectionEnabled === true;
    this.getProductionPresetSelection =
      options.getProductionPresetSelection || (() => null);
    this.saveProductionPresetSelection =
      options.saveProductionPresetSelection || (() => null);
    this.settingsTemplatesEnabled = options.settingsTemplatesEnabled === true;
    this.getSettingsTemplatesPage =
      options.getSettingsTemplatesPage ||
      (() => ({ revision: 0, offset: 0, nextOffset: null, entries: [] }));
    this.importSettingsTemplates =
      options.importSettingsTemplates || (() => ({ revision: 0, entries: [] }));
    this.saveSettingsTemplate =
      options.saveSettingsTemplate ||
      (() => ({ revision: 0, entry: null, branched: false }));
    this.deleteSettingsTemplate =
      options.deleteSettingsTemplate ||
      (() => ({ revision: 0, deletedId: null }));
    this.createSettingsConflict =
      options.createSettingsConflict ||
      (() => ({ revision: 0, entry: null }));
    this.logger = options.logger || (() => {});
    this.sessions = new Map();
    this.sharedTrailHub = null;
    this.sharedTrailRevision = 0;
    this.sharedTrailEvents = [];
    this.nextTrailSyncAt = this.now() + this.trailSyncIntervalMs;
  }

  createSession(payload = {}, options = {}) {
    const now = this.now();
    const id = options.id || crypto.randomBytes(16).toString("base64url");
    const persistent = Boolean(options.persistent || id === DEFAULT_SESSION_ID);
    const singleClient = options.singleClient === true;
    const state = Physics.sanitizeState(
      payload.state ?? {
        phase: Physics.PHASES.PLAY,
        x: Physics.WORLD_WIDTH / 2,
        y: Physics.WORLD_HEIGHT,
        suspended: true,
      }
    );
    const physics = Physics.sanitizePhysics(payload.physics);
    const roomSettings = RoomSettings.sanitizeRoomSettings(payload.roomSettings);
    const imprint = Physics.createSummitImprint(payload.imprint);
    const summitInside = Physics.stateInsideImprint(state, imprint);

    if (state.phase === Physics.PHASES.WON) {
      state.vx = 0;
      state.vy = 0;
    }

    const session = {
      id,
      state,
      physics,
      roomSettings,
      trail: sanitizeTrail(payload.trail, roomSettings),
      trailWriterId: null,
      imprint,
      persistent,
      singleClient,
      clients: new Map(),
      holder: null,
      revision: 1,
      settingsRevision: 1,
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
      stationaryHoldSince: null,
      stationaryHoldPosition: null,
      passedHeightGateIds: new Set(),
      activeHeightGate: null,
      summitElapsedMs: 0,
      summitRunningSince: summitInside ? now : null,
      summitWasInside: summitInside,
      finalFallEnteredAt: null,
      lastPointer: { vx: 0, vy: 0 },
      lastPointerAt: now,
      dirty: true,
    };

    this.sessions.set(id, session);
    this.logger("session_created", { session: id.slice(0, 8) });
    return session;
  }

  ensureDefaultSession(payload = {}) {
    const existing = this.sessions.get(DEFAULT_SESSION_ID);
    if (existing) {
      this.initializeSharedTrailHistory(existing);
      if (
        hasSessionBootstrapPayload(payload) &&
        existing.revision === 1 &&
        this.connectedCount(existing) === 0 &&
        existing.clients.size === 0
      ) {
        if (this.applySessionBootstrap(existing, payload)) {
          this.sharedTrailHub = null;
          this.initializeSharedTrailHistory(existing);
        }
      }
      return existing;
    }
    const created = this.createSession(payload, {
      id: DEFAULT_SESSION_ID,
      persistent: true,
    });
    this.initializeSharedTrailHistory(created);
    return created;
  }

  initializeSharedTrailHistory(session) {
    if (!session || session.id !== DEFAULT_SESSION_ID) {
      return;
    }
    if (this.sharedTrailHub === session) {
      return;
    }
    this.sharedTrailHub = session;
    const recentPoints = session.trail.slice(-MAX_TRAIL_EVENTS);
    this.sharedTrailRevision = session.trail.length - recentPoints.length;
    this.sharedTrailEvents = recentPoints.map((point) => ({
      id: ++this.sharedTrailRevision,
      sourceSessionId: null,
      point: [...point],
    }));
  }

  applySessionBootstrap(session, payload = {}) {
    if (!payload || typeof payload !== "object") {
      return false;
    }

    const state = Object.hasOwn(payload, "state")
      ? Physics.sanitizeState(payload.state)
      : null;
    const physics = Object.hasOwn(payload, "physics")
      ? Physics.sanitizePhysics(payload.physics)
      : null;
    const roomSettings = Object.hasOwn(payload, "roomSettings")
      ? RoomSettings.sanitizeRoomSettings(payload.roomSettings)
      : null;
    const imprint = Object.hasOwn(payload, "imprint")
      ? Physics.createSummitImprint(payload.imprint)
      : null;

    if (state) {
      session.state = state;
    }
    if (physics) {
      session.physics = physics;
    }
    if (roomSettings) {
      session.roomSettings = roomSettings;
      trimTrailToRoomSettings(session.trail, session.roomSettings);
    }
    if (imprint) {
      session.imprint = imprint;
    }
    if (Object.hasOwn(payload, "trail")) {
      session.trail = sanitizeTrail(payload.trail, session.roomSettings);
    }
    if (state || imprint) {
      const now = this.now();
      const summitInside = Physics.stateInsideImprint(
        session.state,
        session.imprint
      );
      session.summitRunningSince = summitInside ? now : null;
      session.summitWasInside = summitInside;
    }
    return true;
  }

  applySettingsPreset(session, preset = {}) {
    if (!session || !preset || typeof preset !== "object") {
      return false;
    }

    const physicsKeys = Object.keys(Physics.DEFAULT_PHYSICS);
    const nextPhysics = Physics.sanitizePhysics(preset);
    const nextRoomSettings = RoomSettings.sanitizeRoomSettings(preset);
    const physicsChanged = !settingsEqual(
      session.physics,
      nextPhysics,
      physicsKeys
    );
    const roomSettingsChanged = !settingsEqual(
      session.roomSettings,
      nextRoomSettings,
      RoomSettings.ROOM_SETTINGS_KEYS
    );

    if (!physicsChanged && !roomSettingsChanged) {
      return false;
    }

    if (roomSettingsChanged) {
      const previousRoomSettings = session.roomSettings;
      rescaleSceneVerticalMotion(
        session,
        previousRoomSettings,
        nextRoomSettings
      );
      session.roomSettings = nextRoomSettings;
      trimTrailToRoomSettings(session.trail, session.roomSettings);
      this.syncHolderBehaviorTimers(session, previousRoomSettings);
      this.reconcileHeightGateProgress(session);
    }
    if (physicsChanged) {
      session.physics = nextPhysics;
    }
    session.settingsRevision += 1;
    this.syncDrag(session);
    this.markChanged(session);
    this.broadcastSnapshot(session, { includeConfig: true });
    return true;
  }

  serializeSessions() {
    return [...this.sessions.values()].map((session) => ({
      id: session.id,
      state: { ...session.state },
      physics: { ...session.physics },
      physicsVersion: Physics.PHYSICS_VERSION,
      roomSettings: { ...session.roomSettings },
      roomSettingsVersion: RoomSettings.ROOM_SETTINGS_VERSION,
      settingsRevision: session.settingsRevision,
      trail: session.trail.map((point) => [...point]),
      trailWriterId: session.trailWriterId,
      imprint: session.imprint ? { ...session.imprint } : null,
      persistent: Boolean(session.persistent),
      singleClient: Boolean(session.singleClient),
      revision: session.revision,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      expiresAt: session.expiresAt,
      emptyDeleteAt: session.emptyDeleteAt,
      lastPointer: { ...session.lastPointer },
      lastPointerAt: session.lastPointerAt,
      groundTouchSeq: session.groundTouchSeq,
      summitElapsedMs: session.summitElapsedMs,
      summitRunningSince: session.summitRunningSince,
      heightGateProgress: {
        passedGateIds: [...session.passedHeightGateIds],
        activeGate: session.activeHeightGate
          ? { ...session.activeHeightGate }
          : null,
      },
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

      const persistent =
        record.persistent === true || record.id === DEFAULT_SESSION_ID;
      const expiresAt = persistent
        ? Math.max(finite(record.expiresAt, now + this.ttlMs), now + this.ttlMs)
        : finite(record.expiresAt, now + this.ttlMs);
      const emptyDeleteAt = record.emptyDeleteAt === null
        ? null
        : finite(record.emptyDeleteAt, null);
      if (
        !persistent &&
        (expiresAt <= now || (emptyDeleteAt !== null && emptyDeleteAt <= now))
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
      const imprint = Physics.createSummitImprint(record.imprint);
      const summitInside = Physics.stateInsideImprint(state, imprint);
      const hasSummitRunningSince = Object.hasOwn(
        record,
        "summitRunningSince"
      );
      const summitElapsedMs = Math.min(
        Number.MAX_SAFE_INTEGER,
        Math.max(0, finite(record.summitElapsedMs, 0))
      );
      const restoredRunningSince =
        record.summitRunningSince === null
          ? null
          : finite(record.summitRunningSince, null);
      const summitRunningSince =
        restoredRunningSince !== null
          ? Math.min(restoredRunningSince, now)
          : hasSummitRunningSince &&
              summitElapsedMs === 0 &&
              summitInside
            ? now
          : !hasSummitRunningSince &&
              Object.hasOwn(record, "summitElapsedMs") &&
              summitElapsedMs > 0 &&
              summitInside
            ? now
          : null;
      const lastPointer = {
        vx: finite(record.lastPointer?.vx, 0),
        vy: finite(record.lastPointer?.vy, 0),
      };
      const lastPointerAt = finite(record.lastPointerAt, 0);
      const releasePointer = pointerVelocityAt(lastPointer, lastPointerAt, now);
      const configuredHeightGateIds = new Set(
        roomSettings.heightGates.map((gate) => gate.id)
      );
      const passedHeightGateIds = new Set(
        Array.isArray(record.heightGateProgress?.passedGateIds)
          ? record.heightGateProgress.passedGateIds.filter((id) =>
              configuredHeightGateIds.has(id)
            )
          : []
      );
      const storedActiveGate = record.heightGateProgress?.activeGate;
      const configuredActiveGate = roomSettings.heightGates.find(
        (gate) => gate.id === storedActiveGate?.id
      );
      const activeHeightGate =
        configuredActiveGate &&
        Number.isFinite(Number(storedActiveGate?.unlockAt)) &&
        Number(storedActiveGate.unlockAt) > now
          ? {
              id: configuredActiveGate.id,
              heightPercent: configuredActiveGate.heightPercent,
              unlockAt: Number(storedActiveGate.unlockAt),
            }
          : null;
      if (configuredActiveGate && !activeHeightGate) {
        passedHeightGateIds.add(configuredActiveGate.id);
      }

      let releasedStoredDrag = false;
      if (record.state?.dragging) {
        if (state.phase === Physics.PHASES.INTRO) {
          releasedStoredDrag = Physics.beginFirstFall(state, physics, {
            motionScale: RoomSettings.sceneMotionMultiplier(roomSettings),
          });
        } else if (state.phase === Physics.PHASES.PLAY) {
          Physics.applyReleaseImpulse(
            state,
            physics,
            releasePointer.vx,
            releasePointer.vy
          );
          releasedStoredDrag = true;
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
        trail: sanitizeTrail(record.trail, roomSettings),
        trailWriterId: normalizeClientId(record.trailWriterId),
        imprint,
        persistent,
        singleClient: record.singleClient === true,
        clients: new Map(),
        holder: null,
        revision: Number.isSafeInteger(record.revision)
          ? Math.max(1, record.revision)
          : 1,
        settingsRevision: Number.isSafeInteger(record.settingsRevision)
          ? Math.max(1, record.settingsRevision)
          : 1,
        createdAt: Math.min(finite(record.createdAt, now), now),
        lastActivityAt: Math.min(finite(record.lastActivityAt, now), now),
        expiresAt,
        emptyDeleteAt: persistent ? null : emptyDeleteAt,
        lastTickAt: now,
        accumulator: 0,
        nextSnapshotAt: now,
        lastTrailAt: now,
        groundTouchSeq: Math.max(0, Number(record.groundTouchSeq) || 0),
        firstFallAt: null,
        stationaryHoldSince: null,
        stationaryHoldPosition: null,
        passedHeightGateIds,
        activeHeightGate,
        summitElapsedMs,
        summitRunningSince,
        summitWasInside: summitInside,
        finalFallEnteredAt: null,
        lastPointer,
        lastPointerAt,
        dirty: true,
      };

      if (activeHeightGate) {
        const gateY =
          Physics.WORLD_HEIGHT * (1 - activeHeightGate.heightPercent / 100);
        session.state.y = Math.max(session.state.y, gateY);
      }

      if (releasedStoredDrag) {
        this.stopSummitTimer(session, now);
      }
      this.syncSummitTimer(session, now);
      this.sessions.set(session.id, session);
      restored += 1;
    });

    if (restored > 0) {
      this.logger("sessions_restored", { sessions: restored });
    }
    return restored;
  }

  isPersistentSession(session) {
    return Boolean(session?.persistent || session?.id === DEFAULT_SESSION_ID);
  }

  getSession(id) {
    const session = this.sessions.get(id);
    if (!session) {
      return null;
    }

    if (this.isPersistentSession(session)) {
      if (session.emptyDeleteAt !== null) {
        this.cancelEmptyCleanup(session);
      }
      if (this.now() >= session.expiresAt) {
        this.touch(session);
      }
      return session;
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
    if (this.isPersistentSession(session)) {
      this.cancelEmptyCleanup(session);
      return;
    }
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

  slipDelayMs() {
    return Math.round(
      this.slipDelayMinMs +
        this.random() * (this.slipDelayMaxMs - this.slipDelayMinMs)
    );
  }

  activeHolder(session) {
    const holder = session?.holder;
    if (!holder || !session.clients.has(holder.clientId)) {
      return null;
    }
    return holder;
  }

  syncHolderBehaviorTimers(session, previousSettings, now = this.now()) {
    const holder = this.activeHolder(session);
    if (!holder) {
      return;
    }
    const previous = previousSettings || session.roomSettings;
    const next = session.roomSettings;

    if (!next.randomDropEnabled) {
      holder.slipAt = null;
    } else if (!previous.randomDropEnabled || holder.slipAt === null) {
      holder.slipAt = now + this.slipDelayMs();
    }

    if (!next.rockJumpEnabled) {
      holder.jumpAt = null;
    } else if (
      !previous.rockJumpEnabled ||
      previous.rockJumpIntervalSeconds !== next.rockJumpIntervalSeconds ||
      holder.jumpAt === null
    ) {
      holder.jumpAt = now + next.rockJumpIntervalSeconds * 1000;
    }
  }

  holderId(session) {
    return this.activeHolder(session)?.clientId || null;
  }

  holderVelocity(session, holder, now = this.now()) {
    return pointerVelocityAt(
      { vx: holder.vx, vy: holder.vy },
      holder.lastMoveAt,
      now
    );
  }

  summitElapsedAt(session, now = this.now()) {
    const elapsedMs = Math.min(
      Number.MAX_SAFE_INTEGER,
      Math.max(0, finite(session.summitElapsedMs, 0))
    );
    if (session.summitRunningSince === null) {
      return elapsedMs;
    }
    return Math.min(
      Number.MAX_SAFE_INTEGER,
      elapsedMs + Math.max(0, now - session.summitRunningSince)
    );
  }

  stopSummitTimer(session, now = this.now()) {
    if (session.summitRunningSince === null) {
      return false;
    }
    session.summitElapsedMs = this.summitElapsedAt(session, now);
    session.summitRunningSince = null;
    return true;
  }

  summitTimerShouldStopForFall(session) {
    const state = session.state;
    if (
      session.summitRunningSince === null ||
      state.dragging ||
      state.suspended
    ) {
      return false;
    }
    if (state.phase === Physics.PHASES.FALLING) {
      return true;
    }
    if (state.phase !== Physics.PHASES.PLAY) {
      return false;
    }
    return state.vy >= 0 || state.y >= Physics.WORLD_HEIGHT - 0.01;
  }

  syncSummitTimer(session, now = this.now()) {
    const wasInside = session.summitWasInside;
    const inside = Physics.stateInsideImprint(session.state, session.imprint);
    const changedInsideState = inside !== wasInside;
    session.summitWasInside = inside;

    let changed = changedInsideState;
    if (
      session.summitRunningSince === null &&
      inside &&
      !wasInside
    ) {
      session.summitRunningSince = now;
      changed = true;
    }
    if (this.summitTimerShouldStopForFall(session)) {
      changed = this.stopSummitTimer(session, now) || changed;
    }
    return changed;
  }

  syncFinalFallGate(session, now = this.now()) {
    const insideWhileHeld =
      session.roomSettings.finalFallEnabled &&
      session.state.dragging &&
      Physics.stateInsideImprint(session.state, session.imprint);
    if (!insideWhileHeld) {
      session.finalFallEnteredAt = null;
      return false;
    }
    if (session.finalFallEnteredAt === null) {
      session.finalFallEnteredAt = now;
    }
    return (
      now - session.finalFallEnteredAt >=
      session.roomSettings.finalFallDelaySeconds * 1000
    );
  }

  heightGateY(gate) {
    return Physics.WORLD_HEIGHT * (1 - gate.heightPercent / 100);
  }

  heightGateState(session) {
    return {
      passedGateIds: [...session.passedHeightGateIds],
      activeGate: session.activeHeightGate
        ? { ...session.activeHeightGate }
        : null,
    };
  }

  broadcastHeightGateState(session, type) {
    const payload = {
      ...this.heightGateState(session),
      serverTime: this.now(),
    };
    session.clients.forEach((client) => this.sendTo(client, type, payload));
  }

  reconcileHeightGateProgress(session, now = this.now()) {
    const configuredIds = new Set(
      session.roomSettings.heightGates.map((gate) => gate.id)
    );
    session.passedHeightGateIds = new Set(
      [...session.passedHeightGateIds].filter((id) => configuredIds.has(id))
    );
    const activeConfig = session.roomSettings.heightGates.find(
      (gate) => gate.id === session.activeHeightGate?.id
    );
    if (!activeConfig) {
      const hadActiveGate = Boolean(session.activeHeightGate);
      session.activeHeightGate = null;
      if (hadActiveGate) {
        this.broadcastHeightGateState(session, "heightGate.released");
      }
      return hadActiveGate;
    }
    session.activeHeightGate.heightPercent = activeConfig.heightPercent;
    return this.completeActiveHeightGate(session, now);
  }

  activateHeightGate(session, gate, now = this.now()) {
    if (
      !gate ||
      session.activeHeightGate ||
      session.passedHeightGateIds.has(gate.id)
    ) {
      return false;
    }
    session.activeHeightGate = {
      id: gate.id,
      heightPercent: gate.heightPercent,
      unlockAt: now + gate.durationSeconds * 1000,
    };
    this.broadcastHeightGateState(session, "heightGate.activated");
    return true;
  }

  completeActiveHeightGate(session, now = this.now()) {
    const active = session.activeHeightGate;
    if (!active || now < active.unlockAt) {
      return false;
    }
    session.passedHeightGateIds.add(active.id);
    session.activeHeightGate = null;
    this.markChanged(session);
    this.broadcastHeightGateState(session, "heightGate.released");
    return true;
  }

  constrainHeightGateMovement(session, fromY, desiredY, now = this.now()) {
    this.completeActiveHeightGate(session, now);
    const active = session.activeHeightGate;
    if (active) {
      return Math.max(desiredY, this.heightGateY(active));
    }
    if (desiredY >= fromY) {
      return desiredY;
    }
    const gate = session.roomSettings.heightGates.find((candidate) => {
      if (session.passedHeightGateIds.has(candidate.id)) {
        return false;
      }
      const gateY = this.heightGateY(candidate);
      return fromY >= gateY && desiredY <= gateY;
    });
    if (!gate) {
      return desiredY;
    }
    this.activateHeightGate(session, gate, now);
    return this.heightGateY(gate);
  }

  clearStationaryHold(session) {
    session.stationaryHoldSince = null;
    session.stationaryHoldPosition = null;
  }

  updateStationaryHold(session, now = this.now()) {
    if (session.roomSettings?.stationaryAutoSlipEnabled === false) {
      this.clearStationaryHold(session);
      return false;
    }
    const state = session.state;
    const holder = this.activeHolder(session);
    const isOnGround = state.y >= Physics.WORLD_HEIGHT - STATIONARY_POSITION_EPSILON;
    if (!state.dragging || !holder || isOnGround) {
      this.clearStationaryHold(session);
      return false;
    }

    const previous = session.stationaryHoldPosition;
    const moved =
      !previous ||
      Math.abs(state.x - previous.x) > STATIONARY_POSITION_EPSILON ||
      Math.abs(state.y - previous.y) > STATIONARY_POSITION_EPSILON ||
      Math.abs(holder.x - state.x) > STATIONARY_POSITION_EPSILON ||
      Math.abs(holder.y - state.y) > STATIONARY_POSITION_EPSILON;
    if (moved) {
      session.stationaryHoldPosition = { x: state.x, y: state.y };
      session.stationaryHoldSince = now;
      return false;
    }

    return now - session.stationaryHoldSince >= this.stationaryHoldReleaseMs;
  }

  syncDrag(session, now = this.now()) {
    const holder = this.activeHolder(session);
    const state = session.state;
    const wasDragging = state.dragging;

    if (!holder) {
      state.dragging = false;
      state.controllerId = null;
      if (wasDragging && state.phase === Physics.PHASES.PLAY) {
        state.vy = Math.max(0, state.vy);
        this.stopSummitTimer(session, now);
      }
      this.updateStationaryHold(session, now);
      this.syncFinalFallGate(session, now);
      return;
    }

    const velocity = this.holderVelocity(session, holder, now);
    state.dragging = true;
    state.controllerId = holder.clientId;
    state.suspended = false;
    session.lastPointer = {
      vx: velocity.vx,
      vy: velocity.vy,
    };
    session.lastPointerAt = now;
    session.firstFallAt = null;
    this.updateStationaryHold(session, now);
    this.syncFinalFallGate(session, now);
  }

  removeHolder(session, clientId, options = {}) {
    const holder = this.activeHolder(session);
    if (!holder || holder.clientId !== clientId) {
      return false;
    }

    const now = this.now();
    const wasDragging = session.state.dragging;
    const releasedInsideImprint =
      options.applyReleaseImpulse &&
      Physics.stateInsideImprint(session.state, session.imprint);
    const finalFallReady =
      releasedInsideImprint && this.syncFinalFallGate(session, now);
    const releaseVelocity = options.applyReleaseImpulse
      ? this.holderVelocity(session, holder, now)
      : { vx: 0, vy: 0 };
    const notify = options.notify !== false;
    const reason = options.reason || "released";
    const client = session.clients.get(clientId);
    session.holder = null;
    if (client?.pointer) {
      client.pointer.mode = "grab";
      client.pointer.updatedAt = now;
      this.broadcastPointer(session, client);
    }
    this.syncDrag(session, now);
    let jump = null;
    if (
      options.applyReleaseImpulse &&
      wasDragging &&
      !session.state.dragging &&
      session.state.phase === Physics.PHASES.PLAY
    ) {
      if (finalFallReady) {
        Physics.beginFinalFall(session.state);
      } else {
        Physics.applyReleaseImpulse(
          session.state,
          session.physics,
          releaseVelocity.vx,
          releaseVelocity.vy
        );
      }
    } else if (
      options.applyRockJumpImpulse &&
      wasDragging &&
      session.state.phase === Physics.PHASES.PLAY
    ) {
      const angleDegrees =
        (this.random() - 0.5) *
        session.roomSettings.rockJumpAngleSpreadDegrees;
      const spread =
        session.roomSettings.rockJumpInertiaSpreadPercent / 100;
      const inertiaFactor = 1 - spread + this.random() * spread * 2;
      jump = Physics.applyRockJumpImpulse(
        session.state,
        session.physics,
        angleDegrees,
        inertiaFactor
      );
    }
    this.syncFinalFallGate(session, now);
    this.markChanged(session);
    this.broadcastSnapshot(session);
    this.broadcastPresence(session);
    if (notify && client) {
      this.sendTo(client, "control.slipped", {
        reason,
        holderId: this.holderId(session),
        ...(jump || {}),
      });
    }
    return true;
  }

  connectClient(session, clientId, socket) {
    const now = this.now();
    const previous = session.clients.get(clientId);
    const occupied = [...session.clients.values()].some(
      (participant) =>
        participant.id !== clientId && socketIsOpen(participant.socket)
    );

    if (session.singleClient && occupied) {
      const rejected = { socket };
      this.sendError(
        rejected,
        "session_occupied",
        "В пользовательской сессии уже есть активный клиент"
      );
      socket.close(4009, "session_occupied");
      return null;
    }

    if (previous && socketIsOpen(previous.socket) && previous.socket !== socket) {
      previous.socket.close(4001, "connection_replaced");
    }

    const client = previous || {
      id: clientId,
      lastSeq: -1,
      connectedAt: now,
      disconnectedAt: null,
      role: null,
      trailCursor: 0,
      trailHistoryCursor: 0,
    };

    client.role = "master";
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
      ...this.snapshot(session, { includeTrail: false, includeConfig: true }),
      leaveToken: client.leaveToken,
      clientRole: client.role,
    });
    this.sendSharedTrailHistory(client);
    this.sendTo(client, "productionPreset.current", {
      canSelect: this.clientCanSelectProductionPreset(session, client),
      selection: this.getProductionPresetSelection(),
    });
    if (this.clientCanUseDebugSettings(session, client)) {
      this.sendSettingsTemplatesPage(session, client, {});
    }
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
      if (!session.singleClient || this.isPersistentSession(session)) {
        this.touch(session);
        this.scheduleEmptyCleanup(session);
      } else {
        this.destroySession(session, 1000, "session_left");
      }
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

  connectedCountExcluding(session, clientId) {
    let count = 0;
    session.clients.forEach((client) => {
      if (client.id !== clientId && socketIsOpen(client.socket)) {
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
        this.updatePhysics(session, client, payload);
        break;
      case "roomSettings.update":
        this.updateRoomSettings(session, client, payload);
        break;
      case "settings.update":
        this.updateSettings(session, client, payload);
        break;
      case "settingsTemplates.list":
        this.sendSettingsTemplatesPage(session, client, payload);
        break;
      case "settingsTemplates.import":
        this.importSettingsTemplateEntries(session, client, payload);
        break;
      case "settingsTemplates.save":
        this.saveSettingsTemplateEntry(session, client, payload);
        break;
      case "settingsTemplates.delete":
        this.deleteSettingsTemplateEntry(session, client, payload);
        break;
      case "productionPreset.select":
        this.selectProductionPreset(session, client, payload);
        break;
      case "session.restart":
        this.restartSession(session, payload);
        break;
      case "pointer.update":
        this.updatePointer(session, client, payload);
        break;
      case "audio.play":
        this.playSessionAudio(session, client);
        break;
      case "trail.append":
        this.appendClientTrail(session, client, payload);
        break;
      case "trail.ack":
        this.acknowledgeSharedTrail(client, payload);
        break;
      case "trail.resync":
        this.sendSharedTrailHistory(client);
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

  playSessionAudio(session, client) {
    if (session.state.phase !== Physics.PHASES.PLAY) {
      return false;
    }
    const chainSoundIndex = Math.min(
      ChainSounds.CHAIN_SOUND_FILENAMES.length - 1,
      Math.max(
        0,
        Math.floor(
          this.soundRandom() * ChainSounds.CHAIN_SOUND_FILENAMES.length
        )
      )
    );
    const filename = ChainSounds.CHAIN_SOUND_FILENAMES[chainSoundIndex];
    if (!ChainSounds.isChainSoundFilename(filename)) {
      return false;
    }

    const now = this.now();
    const payload = {
      eventId: crypto.randomBytes(12).toString("base64url"),
      actorId: client.id,
      role: "master",
      filename,
      playAt: now + this.audioLeadMs,
      serverTime: now,
    };
    session.clients.forEach((participant) => {
      this.sendTo(participant, "audio.play", payload);
    });
    return payload;
  }

  startSession(session, payload = {}) {
    const state = session.state;
    if (
      state.phase !== Physics.PHASES.INTRO ||
      state.dragging ||
      this.activeHolder(session)
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
      trimTrailToRoomSettings(session.trail, session.roomSettings);
    }
    session.firstFallAt = null;
    this.clearStationaryHold(session);
    session.lastPointer = { vx: 0, vy: 0 };
    session.lastPointerAt = this.now();
    Physics.beginFirstFall(state, session.physics, sceneMotionOptions(session));
    this.markChanged(session);
    this.broadcastSnapshot(session, { includeConfig: true });
    return true;
  }

  acquireControl(session, client, payload = {}) {
    const state = session.state;
    if (state.phase !== Physics.PHASES.PLAY) {
      this.sendTo(client, "control.denied", { reason: "phase_locked" });
      return false;
    }

    const now = this.now();
    const activeHolder = this.activeHolder(session);
    if (activeHolder) {
      this.sendTo(client, "control.denied", { reason: "already_controlled" });
      return false;
    }
    state.suspended = false;
    session.holder = {
      clientId: client.id,
      x: Physics.clamp(finite(payload.x, state.x), 0, Physics.WORLD_WIDTH),
      y: Physics.clamp(finite(payload.y, state.y), 0, Physics.WORLD_HEIGHT),
      vx: 0,
      vy: 0,
      acquiredAt: now,
      lastMoveAt: now,
      slipAt: session.roomSettings.randomDropEnabled
        ? now + this.slipDelayMs()
        : null,
      jumpAt: session.roomSettings.rockJumpEnabled
        ? now + session.roomSettings.rockJumpIntervalSeconds * 1000
        : null,
    };
    session.firstFallAt = null;
    session.trailWriterId = client.id;
    this.syncDrag(session, now);
    this.markChanged(session);

    this.sendTo(client, "control.granted", {
      holderId: client.id,
      trailWriterId: session.trailWriterId,
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
    const holder = this.activeHolder(session);
    if (!holder || holder.clientId !== client.id) {
      return false;
    }

    const now = this.now();
    holder.x = Physics.clamp(finite(payload.x, state.x), 0, Physics.WORLD_WIDTH);
    holder.y = Physics.clamp(finite(payload.y, state.y), 0, Physics.WORLD_HEIGHT);
    holder.vx = Physics.clamp(finite(payload.vx, holder.vx), -4000, 4000);
    holder.vy = Physics.clamp(finite(payload.vy, holder.vy), -9000, 9000);
    holder.lastMoveAt = now;
    if (payload.pointer) {
      this.updatePointer(session, client, payload.pointer);
    }
    this.syncDrag(session, now);
    this.markChanged(session);
    return true;
  }

  releaseControl(session, client, payload = {}) {
    const holder = this.activeHolder(session);
    if (!holder || holder.clientId !== client.id) {
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
    this.syncDrag(session);
    return this.removeHolder(session, client.id, {
      applyReleaseImpulse: true,
      notify: false,
      reason: "released",
    });
  }

  clientCanEditSettings(session, client) {
    return Boolean(client && session.clients.get(client.id) === client);
  }

  clientCanUseDebugSettings(session, client) {
    return Boolean(
      this.settingsTemplatesEnabled &&
        client &&
        session.clients.get(client.id) === client,
    );
  }

  clientCanSelectProductionPreset(session, client) {
    return Boolean(
      this.productionPresetSelectionEnabled &&
        this.clientCanUseDebugSettings(session, client),
    );
  }

  rejectSettingsAccess(client) {
    this.sendError(
      client,
      "settings_forbidden",
      "Параметры комнаты недоступны этому подключению",
    );
    return false;
  }

  selectProductionPreset(session, client, payload = {}) {
    if (!this.productionPresetSelectionEnabled) {
      this.sendError(
        client,
        "debug_only",
        "Production preset можно выбрать только при DEBUG=true",
      );
      return false;
    }
    if (!this.clientCanSelectProductionPreset(session, client)) {
      this.sendError(
        client,
        "debug_only",
        "Production preset доступен участнику личной сессии при DEBUG=true",
      );
      return false;
    }
    try {
      const document = this.saveProductionPresetSelection(payload);
      if (!document || !document.source) {
        throw new Error("production_preset_store_unavailable");
      }
      const selection = {
        selectedAt: document.selectedAt,
        source: { ...document.source },
      };
      this.sessions.forEach((targetSession) => {
        targetSession.clients.forEach((participant) => {
          this.sendTo(participant, "productionPreset.selected", {
            canSelect: this.clientCanSelectProductionPreset(
              targetSession,
              participant,
            ),
            selection,
          });
        });
      });
      return true;
    } catch (error) {
      const invalid = error.code === "invalid_production_preset";
      this.sendError(
        client,
        invalid
          ? "invalid_production_preset"
          : "production_preset_store_unavailable",
        invalid
          ? "Некорректный production preset"
          : "Не удалось сохранить production preset",
      );
      return false;
    }
  }

  settingsTemplateProtectedId() {
    return this.getProductionPresetSelection()?.source?.id || "";
  }

  sendSettingsTemplatesPage(session, client, payload = {}) {
    if (!this.clientCanUseDebugSettings(session, client)) {
      this.sendError(
        client,
        "debug_only",
        "Общие шаблоны доступны только при DEBUG=true",
      );
      return false;
    }
    try {
      const page = this.getSettingsTemplatesPage(payload);
      this.sendTo(client, "settingsTemplates.page", page);
      return true;
    } catch {
      this.sendError(
        client,
        "settings_template_store_unavailable",
        "Не удалось загрузить общие шаблоны",
      );
      return false;
    }
  }

  broadcastSettingsTemplateChange(payload) {
    this.sessions.forEach((session) => {
      session.clients.forEach((participant) => {
        if (this.clientCanUseDebugSettings(session, participant)) {
          this.sendTo(participant, "settingsTemplates.changed", payload);
        }
      });
    });
  }

  importSettingsTemplateEntries(session, client, payload = {}) {
    if (!this.clientCanUseDebugSettings(session, client)) {
      this.sendError(client, "debug_only", "Импорт доступен только при DEBUG=true");
      return false;
    }
    try {
      const result = this.importSettingsTemplates(payload.entries, {
        protectedId: this.settingsTemplateProtectedId(),
      });
      this.sendTo(client, "settingsTemplates.imported", result);
      if (result.entries.length > 0) {
        this.broadcastSettingsTemplateChange({
          action: "upsert",
          revision: result.revision,
          entries: result.entries,
        });
      }
      return true;
    } catch (error) {
      this.sendSettingsTemplateError(client, error);
      return false;
    }
  }

  saveSettingsTemplateEntry(session, client, payload = {}) {
    if (!this.clientCanUseDebugSettings(session, client)) {
      this.sendError(
        client,
        "debug_only",
        "Сохранение доступно только при DEBUG=true",
      );
      return false;
    }
    try {
      const result = this.saveSettingsTemplate(payload.entry, {
        baseUpdatedAt: payload.baseUpdatedAt,
        protectedId: this.settingsTemplateProtectedId(),
      });
      this.sendTo(client, "settingsTemplates.saved", result);
      this.broadcastSettingsTemplateChange({
        action: "upsert",
        revision: result.revision,
        entries: result.entry ? [result.entry] : [],
      });
      return true;
    } catch (error) {
      this.sendSettingsTemplateError(client, error);
      return false;
    }
  }

  deleteSettingsTemplateEntry(session, client, payload = {}) {
    if (!this.clientCanUseDebugSettings(session, client)) {
      this.sendError(client, "debug_only", "Удаление доступно только при DEBUG=true");
      return false;
    }
    try {
      const result = this.deleteSettingsTemplate(payload.id, {
        protectedId: this.settingsTemplateProtectedId(),
      });
      this.sendTo(client, "settingsTemplates.deleted", result);
      if (result.deletedId) {
        this.broadcastSettingsTemplateChange({
          action: "delete",
          revision: result.revision,
          id: result.deletedId,
        });
      }
      return true;
    } catch (error) {
      this.sendSettingsTemplateError(client, error);
      return false;
    }
  }

  sendSettingsTemplateError(client, error) {
    const protectedTemplate = error.code === "production_template_protected";
    const invalid = error.code === "invalid_settings_template";
    this.sendError(
      client,
      protectedTemplate
        ? "production_template_protected"
        : invalid
          ? "invalid_settings_template"
          : "settings_template_store_unavailable",
      protectedTemplate
        ? "Сначала выберите другой production preset"
        : invalid
          ? "Некорректный шаблон настроек"
          : "Не удалось сохранить общий шаблон",
    );
  }

  updateSettings(session, client, payload = {}) {
    if (!this.clientCanUseDebugSettings(session, client)) {
      this.sendError(
        client,
        "debug_only",
        "Общие настройки доступны всем только при DEBUG=true",
      );
      return false;
    }
    const requestId = String(payload.requestId || "").trim().slice(0, 120);
    const baseRevision = Number(payload.baseRevision);
    if (
      !requestId ||
      !Number.isSafeInteger(baseRevision) ||
      !payload.settings ||
      typeof payload.settings !== "object" ||
      Array.isArray(payload.settings)
    ) {
      this.sendError(
        client,
        "invalid_settings_update",
        "Некорректное обновление настроек",
      );
      return false;
    }
    if (baseRevision !== session.settingsRevision) {
      try {
        const conflict = this.createSettingsConflict(payload.settings, {
          name: String(payload.name || "Конфликт").slice(0, 120),
          settingsSchemaVersion: payload.settingsSchemaVersion,
          protectedId: this.settingsTemplateProtectedId(),
        });
        this.sendTo(client, "settings.conflict", {
          requestId,
          settingsRevision: session.settingsRevision,
          entry: conflict.entry,
          settings: {
            ...session.roomSettings,
            ...session.physics,
          },
        });
        if (conflict.entry) {
          this.broadcastSettingsTemplateChange({
            action: "upsert",
            revision: conflict.revision,
            entries: [conflict.entry],
          });
        }
        return false;
      } catch (error) {
        this.sendSettingsTemplateError(client, error);
        return false;
      }
    }

    const nextPhysics = Physics.sanitizePhysics(payload.settings, session.physics);
    const nextRoomSettings = RoomSettings.sanitizeRoomSettings(
      payload.settings,
      session.roomSettings,
    );
    const physicsChanged = !settingsEqual(
      session.physics,
      nextPhysics,
      Object.keys(Physics.DEFAULT_PHYSICS),
    );
    const roomSettingsChanged = !settingsEqual(
      session.roomSettings,
      nextRoomSettings,
      RoomSettings.ROOM_SETTINGS_KEYS,
    );
    if (roomSettingsChanged) {
      const previousRoomSettings = session.roomSettings;
      rescaleSceneVerticalMotion(
        session,
        previousRoomSettings,
        nextRoomSettings,
      );
      session.roomSettings = nextRoomSettings;
      trimTrailToRoomSettings(session.trail, session.roomSettings);
      this.syncHolderBehaviorTimers(session, previousRoomSettings);
      this.reconcileHeightGateProgress(session);
    }
    if (physicsChanged) {
      session.physics = nextPhysics;
    }
    if (physicsChanged || roomSettingsChanged) {
      session.settingsRevision += 1;
      this.syncDrag(session);
      this.markChanged(session);
      this.broadcastSnapshot(session, { includeConfig: true });
    }
    this.sendTo(client, "settings.applied", {
      requestId,
      settingsRevision: session.settingsRevision,
    });
    return true;
  }

  updatePhysics(session, clientOrPayload, maybePayload) {
    const client = maybePayload === undefined ? null : clientOrPayload;
    const payload = maybePayload === undefined ? clientOrPayload : maybePayload;
    if (client && !this.clientCanEditSettings(session, client)) {
      return this.rejectSettingsAccess(client);
    }
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
    session.settingsRevision += 1;
    this.syncDrag(session);
    this.markChanged(session);
    this.broadcastSnapshot(session, { includeConfig: true });
  }

  updateRoomSettings(session, clientOrPayload, maybePayload) {
    const client = maybePayload === undefined ? null : clientOrPayload;
    const payload = maybePayload === undefined ? clientOrPayload : maybePayload;
    if (client && !this.clientCanEditSettings(session, client)) {
      return this.rejectSettingsAccess(client);
    }
    const sourcePayload =
      payload && typeof payload === "object" ? payload : {};
    const previousRoomSettings = session.roomSettings;
    const nextRoomSettings = RoomSettings.sanitizeRoomSettings(
      { ...session.roomSettings, ...sourcePayload },
      session.roomSettings
    );
    rescaleSceneVerticalMotion(session, previousRoomSettings, nextRoomSettings);
    session.roomSettings = nextRoomSettings;
    trimTrailToRoomSettings(session.trail, session.roomSettings);
    this.syncHolderBehaviorTimers(session, previousRoomSettings);
    this.reconcileHeightGateProgress(session);
    session.settingsRevision += 1;
    this.markChanged(session);
    this.broadcastSnapshot(session, { includeConfig: true });
  }

  restartSession(session, payload = {}) {
    const now = this.now();
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
    session.holder = null;
    session.firstFallAt = null;
    session.passedHeightGateIds = new Set();
    session.activeHeightGate = null;
    this.clearStationaryHold(session);
    session.lastPointer = { vx: 0, vy: 0 };
    session.lastPointerAt = now;
    session.accumulator = 0;
    session.lastTickAt = now;
    session.nextSnapshotAt = now;
    session.lastTrailAt = now;
    this.syncSummitTimer(session, now);
    session.clients.forEach((client) => {
      client.pointer.mode = "grab";
      client.pointer.visible = false;
      client.pointer.updatedAt = now;
    });

    this.markChanged(session);
    this.broadcastSnapshot(session, true);
    this.broadcastPresence(session);
    return true;
  }

  updatePointer(session, client, payload = {}) {
    const x = Number(payload.x);
    const y = Number(payload.y);
    const hasRockOffsetX = Object.hasOwn(payload, "rockOffsetX");
    const hasRockOffsetY = Object.hasOwn(payload, "rockOffsetY");
    const hasRockOffset = hasRockOffsetX || hasRockOffsetY;
    const rockOffsetX = Number(payload.rockOffsetX);
    const rockOffsetY = Number(payload.rockOffsetY);
    const visible = payload.visible;
    const mode = payload.mode;
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      x > Physics.WORLD_WIDTH ||
      y < 0 ||
      y > Physics.WORLD_HEIGHT ||
      (hasRockOffset &&
        (!hasRockOffsetX ||
          !hasRockOffsetY ||
          !Number.isFinite(rockOffsetX) ||
          !Number.isFinite(rockOffsetY) ||
          Math.abs(rockOffsetX) > MAX_ROCK_POINTER_OFFSET ||
          Math.abs(rockOffsetY) > MAX_ROCK_POINTER_OFFSET)) ||
      typeof visible !== "boolean" ||
      !POINTER_MODES.has(mode)
    ) {
      this.sendError(client, "invalid_pointer", "Некорректное состояние указателя");
      return false;
    }
    if (mode === "grabbing" && this.holderId(session) !== client.id) {
      this.sendError(client, "pointer_not_controller", "Указатель не управляет камнем");
      return false;
    }

    client.pointer = {
      x,
      y,
      mode,
      visible,
      ...(hasRockOffset ? { rockOffsetX, rockOffsetY } : {}),
      updatedAt: this.now(),
    };
    this.broadcastPointer(session, client);
    return true;
  }

  markChanged(session) {
    session.revision += 1;
    session.dirty = true;
  }

  activeTrailWriter(session) {
    const writer = session.clients.get(session.trailWriterId);
    return socketIsOpen(writer?.socket) ? writer : null;
  }

  appendClientTrail(session, client, payload = {}) {
    if (session.trailWriterId !== client.id) {
      return false;
    }
    const source = Array.isArray(payload.points)
      ? payload.points.slice(0, MAX_TRAIL_BATCH_POINTS)
      : [];
    const points = sanitizeTrail(source, { trailMaxPoints: HARD_TRAIL_LIMIT }).filter(
      (point) => point[2] === VISUAL_TRAIL_POINT_VERSION,
    );
    if (points.length === 0) {
      return false;
    }
    session.trail.push(...points);
    trimTrailToRoomSettings(session.trail, session.roomSettings);
    points.forEach((point) => this.publishSharedTrailPoint(session, point));
    this.markChanged(session);
    return true;
  }

  recordTrailPoint(session, now) {
    if (this.activeTrailWriter(session)) {
      return;
    }
    if (now - session.lastTrailAt < SNAPSHOT_INTERVAL_MS) {
      return;
    }
    session.lastTrailAt = now;
    const point = [
      Math.round(session.state.x),
      Math.round(session.state.y),
    ];
    session.trail.push(point);
    trimTrailToRoomSettings(session.trail, session.roomSettings);
    this.publishSharedTrailPoint(session, point);
  }

  publishSharedTrailPoint(session, point) {
    const hub = this.sharedTrailHub;
    if (
      !hub ||
      session.id === DEFAULT_SESSION_ID ||
      !this.sessions.has(hub.id)
    ) {
      return;
    }

    const clean = sanitizeTrail([point], { trailMaxPoints: HARD_TRAIL_LIMIT })[0];
    if (!clean) {
      return;
    }
    hub.trail.push(clean);
    trimTrailToRoomSettings(hub.trail, {
      trailMaxPoints: Math.min(
        trailPointLimit(hub.roomSettings),
        HARD_TRAIL_LIMIT,
      ),
    });
    this.sharedTrailEvents.push({
      id: ++this.sharedTrailRevision,
      sourceSessionId: session.id,
      point: clean,
    });
    if (this.sharedTrailEvents.length > MAX_TRAIL_EVENTS) {
      this.sharedTrailEvents.splice(
        0,
        this.sharedTrailEvents.length - MAX_TRAIL_EVENTS
      );
    }
    this.markChanged(hub);
  }

  sendSharedTrailHistory(client) {
    const points = this.sharedTrailHub
      ? this.sharedTrailHub.trail
          .slice(-HARD_TRAIL_LIMIT)
          .map((point) => [...point])
      : [];
    const cursor = this.sharedTrailRevision;
    client.trailHistoryCursor = cursor;
    return this.sendTo(client, "trail.history", { cursor, points });
  }

  acknowledgeSharedTrail(client, payload = {}) {
    const cursor = Number(payload.cursor);
    if (
      !Number.isSafeInteger(cursor) ||
      cursor < 0 ||
      cursor > this.sharedTrailRevision
    ) {
      this.sendError(client, "invalid_trail_cursor", "Некорректная ревизия следа");
      return false;
    }
    client.trailCursor = Math.max(Number(client.trailCursor) || 0, cursor);
    return true;
  }

  broadcastSharedTrailBatches(now = this.now()) {
    if (now < this.nextTrailSyncAt) {
      return false;
    }
    this.nextTrailSyncAt = now + this.trailSyncIntervalMs;

    const oldestCursor = this.sharedTrailEvents[0]?.id || this.sharedTrailRevision;
    this.sessions.forEach((session) => {
      if (session.id === DEFAULT_SESSION_ID) {
        return;
      }
      session.clients.forEach((client) => {
        if (!socketIsOpen(client.socket)) {
          return;
        }
        const cursor = Math.max(0, Number(client.trailCursor) || 0);
        if (cursor < oldestCursor - 1) {
          this.sendSharedTrailHistory(client);
          return;
        }
        const pending = this.sharedTrailEvents.filter(
          (entry) => entry.id > cursor
        );
        if (pending.length === 0) {
          return;
        }
        this.sendTo(client, "trail.batch", {
          baseCursor: cursor,
          cursor: this.sharedTrailRevision,
          points: pending
            .filter((entry) => entry.sourceSessionId !== session.id)
            .map((entry) => [...entry.point]),
        });
      });
    });
    return true;
  }

  tick(now = this.now()) {
    this.broadcastSharedTrailBatches(now);
    for (const session of [...this.sessions.values()]) {
      if (session.trailHubOnly) {
        session.dirty = false;
        continue;
      }
      const persistent = this.isPersistentSession(session);
      if (now >= session.expiresAt) {
        if (persistent || this.connectedCount(session) > 0) {
          this.touch(session);
        } else {
          this.destroySession(session, 4004, "session_expired");
          continue;
        }
      }

      if (
        !persistent &&
        session.emptyDeleteAt !== null &&
        now >= session.emptyDeleteAt &&
        this.connectedCount(session) === 0
      ) {
        this.destroySession(session, 1000, "session_empty");
        continue;
      }

      const connectedHolder = this.activeHolder(session);
      if (connectedHolder) {
        const client = session.clients.get(connectedHolder.clientId);
        if (
          client &&
          !socketIsOpen(client.socket) &&
          client.disconnectedAt !== null &&
          now - client.disconnectedAt >= DISCONNECT_GRACE_MS
        ) {
          this.removeHolder(session, connectedHolder.clientId, {
            notify: false,
            reason: "disconnect",
          });
        }
      }

      session.clients.forEach((client, clientId) => {
        if (
          !socketIsOpen(client.socket) &&
          client.disconnectedAt !== null &&
          now - client.disconnectedAt >= DISCONNECTED_CLIENT_TTL_MS &&
          this.holderId(session) !== clientId
        ) {
          session.clients.delete(clientId);
        }
      });

      this.completeActiveHeightGate(session, now);

      if (this.updateStationaryHold(session, now)) {
        const stationaryHolder = this.activeHolder(session);
        if (stationaryHolder) {
          this.removeHolder(session, stationaryHolder.clientId, {
            notify: true,
            reason: "stationary",
          });
        }
      }

      const timedHolder = this.activeHolder(session);
      if (
        timedHolder &&
        timedHolder.jumpAt !== null &&
        now >= timedHolder.jumpAt
      ) {
        this.removeHolder(session, timedHolder.clientId, {
          applyRockJumpImpulse: true,
          notify: true,
          reason: "jumped",
        });
      } else if (
        timedHolder &&
        timedHolder.slipAt !== null &&
        now >= timedHolder.slipAt
      ) {
          this.removeHolder(session, timedHolder.clientId, {
            notify: true,
            reason: "slipped",
          });
      }

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
        const previousY = session.state.y;
        const wasAboveGround = session.state.y < Physics.WORLD_HEIGHT - 0.01;
        const dragHolder = this.activeHolder(session);
        const stepped = session.state.dragging && dragHolder
          ? Physics.stepDragState(
              session.state,
              session.physics,
              dragHolder.x,
              dragHolder.y,
              Physics.FIXED_STEP_SECONDS,
              sceneMotionOptions(session)
            )
          : Physics.stepState(
              session.state,
              session.physics,
              Physics.FIXED_STEP_SECONDS,
              sceneMotionOptions(session)
            );
        if (session.state.dragging && dragHolder) {
          const constrainedY = this.constrainHeightGateMovement(
            session,
            previousY,
            session.state.y,
            now
          );
          if (constrainedY !== session.state.y) {
            session.state.y = constrainedY;
            session.state.vy = 0;
          }
        }
        if (wasAboveGround && session.state.y >= Physics.WORLD_HEIGHT - 0.01) {
          groundTouched = true;
        }
        session.accumulator -= Physics.FIXED_STEP_SECONDS;
        physicsChanged = stepped || physicsChanged;
      }

      if (groundTouched) {
        session.groundTouchSeq += 1;
      }

      const summitTimerChanged = this.syncSummitTimer(session, now);
      this.syncFinalFallGate(session, now);
      if (physicsChanged || summitTimerChanged) {
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

  snapshot(session, options = {}) {
    const normalized =
      typeof options === "boolean"
        ? { includeTrail: options, includeConfig: true }
        : {
            includeTrail: Boolean(options.includeTrail),
            includeConfig: options.includeConfig !== false,
          };
    const serverTime = this.now();
    const payload = {
      phase: session.state.phase,
      x: roundNetworkNumber(session.state.x),
      y: roundNetworkNumber(session.state.y),
      vx: roundNetworkNumber(session.state.vx),
      vy: roundNetworkNumber(session.state.vy),
      dragging: Boolean(session.state.dragging),
      controllerId: session.state.controllerId,
      suspended: Boolean(session.state.suspended),
      turbTime: roundNetworkNumber(session.state.turbTime),
      holderId: this.holderId(session),
      trailWriterId: session.trailWriterId,
      groundTouchSeq: session.groundTouchSeq,
      summitElapsedMs: this.summitElapsedAt(session, serverTime),
      summitTimerRunning: session.summitRunningSince !== null,
      settingsRevision: session.settingsRevision,
      revision: session.revision,
      serverTime,
      heightGateState: this.heightGateState(session),
    };
    if (normalized.includeConfig) {
      payload.physics = { ...session.physics };
      payload.roomSettings = { ...session.roomSettings };
      payload.imprint = session.imprint ? { ...session.imprint } : null;
      payload.expiresAt = session.expiresAt;
    }
    if (normalized.includeTrail) {
      payload.trail = session.trail.map((point) => [...point]);
    }
    return payload;
  }

  broadcastSnapshot(session, options = {}) {
    const normalized =
      typeof options === "boolean"
        ? { includeTrail: options, includeConfig: true }
        : {
            includeTrail: Boolean(options.includeTrail),
            includeConfig: Boolean(options.includeConfig),
          };
    const payload = this.snapshot(session, normalized);
    session.clients.forEach((client) => {
      this.sendTo(client, "session.snapshot", payload);
    });
    session.dirty = false;
  }

  broadcastPresence(session) {
    const payload = {
      participants: this.connectedCount(session),
      controllerId: session.state.controllerId,
      holderId: this.holderId(session),
      pointers: [...session.clients.values()]
        .filter((client) => socketIsOpen(client.socket) && client.pointer?.visible)
        .map((client) => this.pointerPayload(client)),
    };
    session.clients.forEach((client) => {
      this.sendTo(client, "presence.update", payload);
    });
  }

  pointerPayload(client) {
    const hasRockOffset =
      Number.isFinite(client.pointer.rockOffsetX) &&
      Number.isFinite(client.pointer.rockOffsetY);
    return {
      clientId: client.id,
      x: roundNetworkNumber(client.pointer.x),
      y: roundNetworkNumber(client.pointer.y),
      ...(hasRockOffset
        ? {
            rockOffsetX: roundNetworkNumber(client.pointer.rockOffsetX),
            rockOffsetY: roundNetworkNumber(client.pointer.rockOffsetY),
          }
        : {}),
      mode: client.pointer.mode,
      visible: client.pointer.visible,
      role: "master",
      serverTime: this.now(),
    };
  }

  broadcastPointer(session, client) {
    const payload = this.pointerPayload(client);
    session.clients.forEach((participant) => {
      if (participant.id === client.id) {
        return;
      }
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
  DEFAULT_SESSION_ID,
  DISCONNECT_GRACE_MS,
  SNAPSHOT_INTERVAL_MS,
  MAX_TRAIL_POINTS,
  TRAIL_SYNC_INTERVAL_MS,
  DISCONNECTED_CLIENT_TTL_MS,
  DEFAULT_EMPTY_SESSION_GRACE_MS,
  SLIP_DELAY_MIN_MS,
  SLIP_DELAY_MAX_MS,
  STATIONARY_HOLD_RELEASE_MS,
  DEFAULT_AUDIO_LEAD_MS,
};
