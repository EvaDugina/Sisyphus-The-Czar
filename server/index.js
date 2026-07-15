"use strict";

const crypto = require("node:crypto");
const http = require("node:http");
const path = require("node:path");
const express = require("express");
const { WebSocketServer } = require("ws");
const { SessionManager } = require("./session-manager");
const { SessionStore } = require("./session-store");

const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const MAX_WS_MESSAGE_BYTES = 64 * 1024;
const HEARTBEAT_INTERVAL_MS = 20_000;
const CONNECTION_TIMEOUT_MS = 45_000;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const LEAVE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function createLogger(output = console.log) {
  return (event, details = {}) => {
    output(
      JSON.stringify({
        level: event.endsWith("error") ? "error" : "info",
        event,
        at: new Date().toISOString(),
        ...details,
      })
    );
  };
}

class WindowRateLimiter {
  constructor(limit, windowMs, now = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.entries = new Map();
  }

  consume(key) {
    const now = this.now();
    if (this.entries.size >= 10_000) {
      this.entries.forEach((entry, entryKey) => {
        if (now >= entry.resetAt) {
          this.entries.delete(entryKey);
        }
      });
      if (this.entries.size >= 10_000 && !this.entries.has(key)) {
        return false;
      }
    }
    const current = this.entries.get(key);
    if (!current || now >= current.resetAt) {
      this.entries.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (current.count >= this.limit) {
      return false;
    }
    current.count += 1;
    return true;
  }
}

function requestIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request.socket.remoteAddress || "unknown";
}

function requestHost(request) {
  const forwarded = request.headers["x-forwarded-host"];
  if (typeof forwarded === "string" && forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request.headers.host || "";
}

function originAllowed(request, allowedOrigins, debug) {
  const origin = request.headers.origin;
  if (!origin) {
    return true;
  }
  if (allowedOrigins.size > 0) {
    return allowedOrigins.has(origin);
  }
  if (debug) {
    return true;
  }
  try {
    return new URL(origin).host === requestHost(request);
  } catch {
    return false;
  }
}

function securityHeaders(debug) {
  return (request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    response.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "img-src 'self' data:",
        "font-src 'self' https://fonts.gstatic.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "script-src 'self'",
        "connect-src 'self' ws: wss:",
      ].join("; ")
    );
    if (!debug) {
      response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    }
    next();
  };
}

function createService(options = {}) {
  const config = {
    port: Number(options.port ?? process.env.PORT ?? 8080),
    host: options.host ?? process.env.HOST ?? "0.0.0.0",
    debug: options.debug ?? parseBoolean(process.env.DEBUG, false),
    ttlMs:
      options.ttlMs ??
      Number(process.env.SESSION_TTL_SECONDS || 86_400) * 1000,
    emptyGraceMs:
      options.emptyGraceMs ??
      Number(process.env.EMPTY_SESSION_GRACE_SECONDS || 10) * 1000,
    sessionStorePath: String(
      options.sessionStorePath ?? process.env.SESSION_STORE_PATH ?? ""
    ).trim(),
    persistIntervalMs: Math.max(
      100,
      Number(
        options.persistIntervalMs ??
          process.env.SESSION_PERSIST_INTERVAL_MS ??
          250
      ) || 250
    ),
    allowedOrigins: new Set(
      String(options.allowedOrigin ?? process.env.ALLOWED_ORIGIN ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    ),
  };

  const log = options.logger || createLogger();
  const manager =
    options.manager ||
    new SessionManager({
      ttlMs: config.ttlMs,
      emptyGraceMs: config.emptyGraceMs,
      logger: log,
    });
  const sessionStore =
    options.sessionStore ||
    new SessionStore(config.sessionStorePath, { logger: log });
  manager.restoreSessions(sessionStore.load());
  const persistSessions = (force = false) =>
    sessionStore.save(manager.serializeSessions(), { force });
  const createLimiter = new WindowRateLimiter(10, 60_000);
  const connectLimiter = new WindowRateLimiter(30, 60_000);
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  app.use(securityHeaders(config.debug));
  app.use(express.json({ limit: "16kb", strict: true }));

  app.get("/healthz", (_request, response) => {
    response.json({
      status: "ok",
      sessions: manager.sessions.size,
      sessionPersistence: sessionStore.enabled,
      memoryRssBytes: process.memoryUsage().rss,
    });
  });

  app.post("/api/sessions", (request, response) => {
    if (!originAllowed(request, config.allowedOrigins, config.debug)) {
      response.status(403).json({ error: "origin_not_allowed" });
      return;
    }
    if (!createLimiter.consume(request.ip || requestIp(request))) {
      response.status(429).json({ error: "rate_limited" });
      return;
    }

    const session = manager.createSession(request.body || {});
    persistSessions();
    response.status(201).json({
      sessionId: session.id,
      expiresAt: session.expiresAt,
    });
  });

  app.post("/api/sessions/:sessionId/leave", (request, response) => {
    if (!originAllowed(request, config.allowedOrigins, config.debug)) {
      response.status(403).json({ error: "origin_not_allowed" });
      return;
    }

    const sessionId = String(request.params.sessionId || "");
    const clientId = String(request.body?.clientId || "");
    const leaveToken = String(request.body?.leaveToken || "");
    if (
      !SESSION_ID_PATTERN.test(sessionId) ||
      !CLIENT_ID_PATTERN.test(clientId) ||
      !LEAVE_TOKEN_PATTERN.test(leaveToken)
    ) {
      response.status(400).json({ error: "invalid_leave" });
      return;
    }

    const session = manager.getSession(sessionId);
    if (!session) {
      response.status(204).end();
      return;
    }
    if (!manager.leaveClient(session, clientId, leaveToken)) {
      response.status(403).json({ error: "invalid_leave_token" });
      return;
    }
    persistSessions();
    response.status(204).end();
  });

  app.use(
    "/assets",
    express.static(path.join(DIST_DIR, "assets"), {
      dotfiles: "deny",
      immutable: !config.debug,
      maxAge: config.debug ? 0 : "1y",
    })
  );

  app.get("/shared/physics.js", (_request, response) => {
    response.type("application/javascript");
    response.setHeader(
      "Cache-Control",
      config.debug ? "no-store" : "public, max-age=3600"
    );
    response.sendFile(path.join(ROOT_DIR, "shared", "physics.js"));
  });

  const sendIndex = (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.sendFile(path.join(DIST_DIR, "index.html"));
  };
  app.get("/", sendIndex);
  app.get("/index.html", sendIndex);

  app.use((error, _request, response, next) => {
    if (error && error.type === "entity.too.large") {
      response.status(413).json({ error: "payload_too_large" });
      return;
    }
    if (error instanceof SyntaxError) {
      response.status(400).json({ error: "invalid_json" });
      return;
    }
    next(error);
  });

  app.use((request, response) => {
    if (request.path.startsWith("/api/")) {
      response.status(404).json({ error: "not_found" });
      return;
    }
    response.status(404).type("text/plain").send("Not found");
  });

  const server = http.createServer(app);
  const websocketServer = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    let url;
    try {
      url = new URL(request.url, "http://localhost");
    } catch {
      socket.destroy();
      return;
    }

    if (url.pathname !== "/realtime") {
      socket.destroy();
      return;
    }
    if (!originAllowed(request, config.allowedOrigins, config.debug)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!connectLimiter.consume(requestIp(request))) {
      socket.write("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    const sessionId = url.searchParams.get("session") || "";
    const clientId = url.searchParams.get("client") || "";
    if (!SESSION_ID_PATTERN.test(sessionId) || !CLIENT_ID_PATTERN.test(clientId)) {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request, {
        sessionId,
        clientId,
      });
    });
  });

  websocketServer.on("connection", (websocket, _request, context) => {
    const session = manager.getSession(context.sessionId);
    if (!session) {
      websocket.send(
        JSON.stringify({
          v: 1,
          type: "error",
          payload: {
            code: "session_not_found",
            message: "Сессия не найдена или уже истекла",
          },
        })
      );
      websocket.close(4004, "session_not_found");
      return;
    }

    websocket.lastPongAt = Date.now();
    websocket.on("pong", () => {
      websocket.lastPongAt = Date.now();
    });

    const client = manager.connectClient(session, context.clientId, websocket);
    websocket.on("message", (data) => {
      if (data.length > MAX_WS_MESSAGE_BYTES) {
        websocket.close(1009, "message_too_large");
        return;
      }
      let message;
      try {
        message = JSON.parse(data.toString("utf8"));
      } catch {
        manager.sendError(client, "invalid_json", "Сообщение не является JSON");
        return;
      }
      manager.handleMessage(session, client, message);
    });
    websocket.on("close", () => {
      manager.disconnectClient(session, context.clientId, websocket);
    });
    websocket.on("error", () => {
      manager.disconnectClient(session, context.clientId, websocket);
    });
  });

  const tickTimer = setInterval(() => manager.tick(), 1000 / 60);
  const heartbeatTimer = setInterval(() => {
    const now = Date.now();
    websocketServer.clients.forEach((websocket) => {
      if (now - websocket.lastPongAt > CONNECTION_TIMEOUT_MS) {
        websocket.terminate();
        return;
      }
      websocket.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);
  const persistenceTimer = sessionStore.enabled
    ? setInterval(() => persistSessions(), config.persistIntervalMs)
    : null;
  tickTimer.unref();
  heartbeatTimer.unref();
  persistenceTimer?.unref();

  async function start() {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, config.host, () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    log("server_started", {
      host: config.host,
      port: typeof address === "object" && address ? address.port : config.port,
      debug: config.debug,
      sessionPersistence: sessionStore.enabled,
    });
    return address;
  }

  let closingPromise = null;
  async function close() {
    if (closingPromise) {
      return closingPromise;
    }
    closingPromise = (async () => {
      clearInterval(tickTimer);
      clearInterval(heartbeatTimer);
      if (persistenceTimer) {
        clearInterval(persistenceTimer);
      }
      persistSessions(true);
      manager.close();
      await new Promise((resolve) => server.close(resolve));
    })();
    return closingPromise;
  }

  return {
    app,
    server,
    websocketServer,
    manager,
    sessionStore,
    config,
    start,
    close,
  };
}

if (require.main === module) {
  const service = createService();
  service.start().catch((error) => {
    console.error(
      JSON.stringify({
        level: "error",
        event: "server_start_error",
        at: new Date().toISOString(),
        message: error.message,
      })
    );
    process.exitCode = 1;
  });

  const shutdown = () => {
    service.close().finally(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

module.exports = {
  createService,
  securityHeaders,
  WindowRateLimiter,
  originAllowed,
};
