const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

function uuidFromRandomBytes(cryptoApi) {
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function fallbackClientId() {
  const timestamp = Date.now().toString(36);
  const random = [
    Math.random().toString(36).slice(2),
    Math.random().toString(36).slice(2),
  ].join("");
  return `client-${timestamp}-${random}`.slice(0, 64).padEnd(16, "0");
}

export function createClientId(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.randomUUID === "function") {
    try {
      const clientId = cryptoApi.randomUUID();
      if (CLIENT_ID_PATTERN.test(clientId)) {
        return clientId;
      }
    } catch {
      // Continue with APIs available in non-secure browser contexts.
    }
  }

  if (typeof cryptoApi?.getRandomValues === "function") {
    try {
      return uuidFromRandomBytes(cryptoApi);
    } catch {
      // Very old browsers still receive a collision-resistant-enough local ID.
    }
  }

  return fallbackClientId();
}
