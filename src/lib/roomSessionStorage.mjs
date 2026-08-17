export const ROOM_SESSION_STORAGE_KEY = "sisyphus-room-session-v1";
export const LEGACY_ROOM_SESSION_STORAGE_KEY = "sisyphus-room-session-id";
export const ROOM_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

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

  try {
    const raw = localStorage?.getItem(ROOM_SESSION_STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      const sessionId = String(stored?.sessionId || "");
      const expiresAt = normalizedExpiresAt(stored?.expiresAt);
      if (!ROOM_SESSION_ID_PATTERN.test(sessionId)) {
        removeStorageItem(localStorage, ROOM_SESSION_STORAGE_KEY);
      } else if (expiresAt !== null && expiresAt <= now) {
        removeStorageItem(localStorage, ROOM_SESSION_STORAGE_KEY);
        removeStorageItem(sessionStorage, LEGACY_ROOM_SESSION_STORAGE_KEY);
        return null;
      } else {
        return { sessionId, expiresAt };
      }
    }
  } catch {
    removeStorageItem(localStorage, ROOM_SESSION_STORAGE_KEY);
  }

  try {
    const legacySessionId =
      sessionStorage?.getItem(LEGACY_ROOM_SESSION_STORAGE_KEY) || "";
    if (!ROOM_SESSION_ID_PATTERN.test(legacySessionId)) {
      return null;
    }
    writeStoredRoomSession(legacySessionId, null, {
      localStorage,
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
  try {
    localStorage?.setItem(
      ROOM_SESSION_STORAGE_KEY,
      JSON.stringify({
        sessionId,
        expiresAt: normalizedExpiresAt(expiresAt),
      }),
    );
    removeStorageItem(sessionStorage, LEGACY_ROOM_SESSION_STORAGE_KEY);
    return Boolean(localStorage);
  } catch {
    return false;
  }
}

export function clearStoredRoomSession(expectedSessionId = "", options = {}) {
  const localStorage = options.localStorage ?? storageFromGlobal("localStorage");
  const sessionStorage =
    options.sessionStorage ?? storageFromGlobal("sessionStorage");
  if (expectedSessionId) {
    const stored = readStoredRoomSession({
      localStorage,
      sessionStorage,
      now: options.now,
    });
    if (stored && stored.sessionId !== expectedSessionId) {
      return false;
    }
  }
  removeStorageItem(localStorage, ROOM_SESSION_STORAGE_KEY);
  removeStorageItem(sessionStorage, LEGACY_ROOM_SESSION_STORAGE_KEY);
  return true;
}
