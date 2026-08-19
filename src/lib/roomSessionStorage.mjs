export const ROOM_SESSION_STORAGE_KEY = "sisyphus-room-session-v1";
export const LEGACY_ROOM_SESSION_STORAGE_KEY = "sisyphus-room-session-id";
export const ROOM_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function roomSessionStorageKey(namespace = "") {
  const normalized = String(namespace || "").replace(/[^A-Za-z0-9_-]/g, "");
  return normalized ? `${ROOM_SESSION_STORAGE_KEY}:${normalized}` : ROOM_SESSION_STORAGE_KEY;
}

function legacyRoomSessionStorageKey(namespace = "") {
  const normalized = String(namespace || "").replace(/[^A-Za-z0-9_-]/g, "");
  return normalized
    ? `${LEGACY_ROOM_SESSION_STORAGE_KEY}:${normalized}`
    : LEGACY_ROOM_SESSION_STORAGE_KEY;
}

function storageFromGlobal(name) {
  try {
    return globalThis[name] || null;
  } catch {
    return null;
  }
}

function removeStorageItem(storage, key) {
  try {
    storage?.removeItem(key);
  } catch {
    /* Хранилище может быть запрещено политикой браузера. */
  }
}

function normalizedExpiresAt(value) {
  const expiresAt = Number(value);
  return Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null;
}

export function readStoredRoomSession(options = {}) {
  const now = Number.isFinite(Number(options.now))
    ? Number(options.now)
    : Date.now();
  const localStorage = options.localStorage ?? storageFromGlobal("localStorage");
  const sessionStorage =
    options.sessionStorage ?? storageFromGlobal("sessionStorage");
  const storageKey = roomSessionStorageKey(options.namespace);
  const legacyStorageKey = legacyRoomSessionStorageKey(options.namespace);

  try {
    const raw = localStorage?.getItem(storageKey);
    if (raw) {
      const stored = JSON.parse(raw);
      const sessionId = String(stored?.sessionId || "");
      const expiresAt = normalizedExpiresAt(stored?.expiresAt);
      if (!ROOM_SESSION_ID_PATTERN.test(sessionId)) {
        removeStorageItem(localStorage, storageKey);
      } else if (expiresAt !== null && expiresAt <= now) {
        removeStorageItem(localStorage, storageKey);
        removeStorageItem(sessionStorage, legacyStorageKey);
        return null;
      } else {
        return { sessionId, expiresAt };
      }
    }
  } catch {
    removeStorageItem(localStorage, storageKey);
  }

  try {
    const legacySessionId =
      sessionStorage?.getItem(legacyStorageKey) || "";
    if (!ROOM_SESSION_ID_PATTERN.test(legacySessionId)) {
      return null;
    }
    writeStoredRoomSession(legacySessionId, null, {
      localStorage,
      namespace: options.namespace,
      sessionStorage,
    });
    return { sessionId: legacySessionId, expiresAt: null };
  } catch {
    return null;
  }
}

export function writeStoredRoomSession(sessionId, expiresAt, options = {}) {
  if (!ROOM_SESSION_ID_PATTERN.test(String(sessionId || ""))) {
    return false;
  }
  const localStorage = options.localStorage ?? storageFromGlobal("localStorage");
  const sessionStorage =
    options.sessionStorage ?? storageFromGlobal("sessionStorage");
  const storageKey = roomSessionStorageKey(options.namespace);
  const legacyStorageKey = legacyRoomSessionStorageKey(options.namespace);
  try {
    localStorage?.setItem(
      storageKey,
      JSON.stringify({
        sessionId,
        expiresAt: normalizedExpiresAt(expiresAt),
      }),
    );
    removeStorageItem(sessionStorage, legacyStorageKey);
    return Boolean(localStorage);
  } catch {
    return false;
  }
}

export function clearStoredRoomSession(expectedSessionId = "", options = {}) {
  const localStorage = options.localStorage ?? storageFromGlobal("localStorage");
  const sessionStorage =
    options.sessionStorage ?? storageFromGlobal("sessionStorage");
  const storageKey = roomSessionStorageKey(options.namespace);
  const legacyStorageKey = legacyRoomSessionStorageKey(options.namespace);
  if (expectedSessionId) {
    const stored = readStoredRoomSession({
      localStorage,
      namespace: options.namespace,
      sessionStorage,
      now: options.now,
    });
    if (stored && stored.sessionId !== expectedSessionId) {
      return false;
    }
  }
  removeStorageItem(localStorage, storageKey);
  removeStorageItem(sessionStorage, legacyStorageKey);
  return true;
}
