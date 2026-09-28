"use strict";

const crypto = require("node:crypto");
const http = require("node:http");
const path = require("node:path");
const express = require("express");
const { WebSocketServer } = require("ws");
const {
  SessionManager,
  DEFAULT_SESSION_ID,
} = require("./session-manager");
const { SessionStore } = require("./session-store");
const { ProductionPresetStore } = require("./production-preset-store");
const { SettingsTemplateStore } = require("./settings-template-store");
const ProductionPreset = require("../shared/production-preset");

const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const MAX_WS_MESSAGE_BYTES = 64 * 1024;
const HEARTBEAT_INTERVAL_MS = 20_000;
const CONNECTION_TIMEOUT_MS = 45_000;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const LEAVE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const ACCESS_COOKIE_NAME = "sisyphus_access";
const ACCESS_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function normalizeBasePath(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  return normalized ? `/${normalized}` : "";
}

function withBasePath(basePath, pathname) {
  const normalizedPath = `/${String(pathname || "").replace(/^\/+/, "")}`;
  return `${basePath}${normalizedPath}`;
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

function accessFormOriginAllowed(request, allowedOrigins, debug) {
  if (originAllowed(request, allowedOrigins, debug)) {
    return true;
  }
  return request.headers["sec-fetch-site"] === "same-origin";
}

function parseCookieHeader(header) {
  const cookies = new Map();
  String(header || "")
    .split(";")
    .forEach((part) => {
      const separator = part.indexOf("=");
      if (separator <= 0) {
        return;
      }
      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      if (name) {
        cookies.set(name, value);
      }
    });
  return cookies;
}

function timingSafeStringEqual(left, right) {
  const leftBuffer = crypto
    .createHash("sha256")
    .update(String(left || ""), "utf8")
    .digest();
  const rightBuffer = crypto
    .createHash("sha256")
    .update(String(right || ""), "utf8")
    .digest();
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function safeReturnTo(value, basePath = "") {
  const fallback = withBasePath(basePath, "/scene-1");
  const candidate = String(value || "");
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.length > 2048
  ) {
    return fallback;
  }
  try {
    const url = new URL(candidate, "http://local.invalid");
    const accessPath = withBasePath(basePath, "/access");
    const outsideBasePath =
      basePath &&
      url.pathname !== basePath &&
      !url.pathname.startsWith(`${basePath}/`);
    if (
      url.origin !== "http://local.invalid" ||
      url.pathname === accessPath ||
      outsideBasePath
    ) {
      return fallback;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function accessPage(returnTo, errorMessage = "", basePath = "") {
  const safeTarget = escapeHtml(safeReturnTo(returnTo, basePath));
  const accessPath = escapeHtml(withBasePath(basePath, "/access"));
  const feedback = errorMessage
    ? `<p class="error" role="alert">${escapeHtml(errorMessage)}</p>`
    : "";
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Доступ к миниатюре</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: #10100f; color: #f5f2e9; }
      main { width: min(100%, 390px); padding: 32px; border: 1px solid #4d493f; border-radius: 18px; background: #1a1917; box-shadow: 0 24px 70px #0008; }
      h1 { margin: 0 0 10px; font-size: 28px; }
      p { margin: 0 0 24px; color: #bbb5a8; line-height: 1.5; }
      label { display: grid; gap: 8px; font-weight: 700; }
      input { width: 100%; min-height: 48px; border: 1px solid #6a6458; border-radius: 10px; padding: 10px 12px; background: #0e0e0d; color: inherit; font: inherit; }
      input:focus-visible { outline: 3px solid #d5aa55; outline-offset: 2px; }
      button { width: 100%; min-height: 48px; margin-top: 18px; border: 0; border-radius: 10px; background: #d5aa55; color: #17130c; font: inherit; font-weight: 800; cursor: pointer; }
      button:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
      .error { margin: 0 0 16px; color: #ff9a8f; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <h1>Закрытый показ</h1>
      <p>Введите пароль, чтобы открыть сцены.</p>
      ${feedback}
      <form method="post" action="${accessPath}">
        <input type="hidden" name="returnTo" value="${safeTarget}" />
        <label for="access-password">
          Пароль
          <input id="access-password" name="password" type="password" autocomplete="current-password" required autofocus maxlength="256" />
        </label>
        <button type="submit">Войти</button>
      </form>
    </main>
  </body>
</html>`;
}

function isLoopbackHostname(hostname) {
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
    String(hostname || "").toLowerCase()
  );
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
    sessionCreateRateLimit: Math.max(
      1,
      Number(
        options.sessionCreateRateLimit ??
          process.env.SESSION_CREATE_RATE_LIMIT ??
          10
      )
    ),
    sessionStorePath: String(
      options.sessionStorePath ?? process.env.SESSION_STORE_PATH ?? ""
    ).trim(),
    productionPresetPath: String(
      options.productionPresetPath ??
        process.env.PRODUCTION_PRESET_PATH ??
        ""
    ).trim(),
    settingsTemplateStorePath: String(
      options.settingsTemplateStorePath ??
        process.env.SETTINGS_TEMPLATE_STORE_PATH ??
        ""
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
    basePath: normalizeBasePath(options.basePath ?? process.env.BASE_PATH ?? ""),
  };
  const accessPassword = String(
    options.accessPassword ?? process.env.ACCESS_PASSWORD ?? ""
  );
  config.accessProtectionEnabled =
    options.accessProtectionEnabled ?? (!config.debug || Boolean(accessPassword));
  if (config.accessProtectionEnabled && !accessPassword) {
    throw new Error("ACCESS_PASSWORD is required when access protection is enabled");
  }

  const log = options.logger || createLogger();
  const productionPresetStore =
    options.productionPresetStore ||
    new ProductionPresetStore(config.productionPresetPath, { logger: log });
  let storedProductionPreset = productionPresetStore.load();
  const settingsTemplateStore =
    options.settingsTemplateStore ||
    new SettingsTemplateStore(config.settingsTemplateStorePath, { logger: log });
  settingsTemplateStore.load();
  const manager =
    options.manager ||
    new SessionManager({
      ttlMs: config.ttlMs,
      emptyGraceMs: config.emptyGraceMs,
      audioLeadMs: options.audioLeadMs,
      trailSyncIntervalMs: options.trailSyncIntervalMs,
      soundRandom: options.soundRandom,
      productionPresetSelectionEnabled: config.debug,
      getProductionPresetSelection: () => productionPresetStore.metadata(),
      saveProductionPresetSelection: (selection) => {
        storedProductionPreset = productionPresetStore.save(selection);
        return storedProductionPreset;
      },
      settingsTemplatesEnabled: config.debug,
      getSettingsTemplatesPage: (payload = {}) =>
        settingsTemplateStore.page(payload.offset, payload.limit),
      saveSettingsTemplate: (entry, storeOptions) =>
        settingsTemplateStore.saveEntry(entry, storeOptions),
      deleteSettingsTemplate: (id, storeOptions) =>
        settingsTemplateStore.deleteEntry(id, storeOptions),
      createSettingsConflict: (settings, storeOptions) =>
        settingsTemplateStore.createConflict(settings, storeOptions),
      logger: log,
    });
  const sessionStore =
    options.sessionStore ||
    new SessionStore(config.sessionStorePath, { logger: log });
  const storedSessions = sessionStore.load();
  manager.restoreLeaderboard(sessionStore.leaderboardState);
  manager.restoreSessions(storedSessions);
  const persistSessions = (force = false) =>
    sessionStore.save(manager.serializeSessions(), {
      force,
      leaderboard: manager.serializeLeaderboard(),
    });
  const settingsPresetForNewSession = () =>
    storedProductionPreset?.settings || ProductionPreset.settings;
  const defaultSession = manager.ensureDefaultSession();
  defaultSession.trailHubOnly = true;
  const startupSettingsPreset = settingsPresetForNewSession();
  if (startupSettingsPreset) {
    manager.applySettingsPreset(defaultSession, startupSettingsPreset);
  }
  persistSessions(true);
  const createLimiter = new WindowRateLimiter(
    config.sessionCreateRateLimit,
    60_000
  );
  const connectLimiter = new WindowRateLimiter(30, 60_000);
  const accessLimiter = new WindowRateLimiter(5, 60_000);
  const accessToken = crypto.randomBytes(32).toString("base64url");
  const accessAuthorized = (request) => {
    if (!config.accessProtectionEnabled) {
      return true;
    }
    const cookieValue = parseCookieHeader(request.headers.cookie).get(
      ACCESS_COOKIE_NAME
    );
    return timingSafeStringEqual(cookieValue, accessToken);
  };
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  app.use(securityHeaders(config.debug));
  app.use(express.json({ limit: "16kb", strict: true }));

  const healthHandler = (_request, response) => {
    response.json({
      status: "ok",
      sessions: manager.sessions.size,
      sessionPersistence: sessionStore.enabled,
      memoryRssBytes: process.memoryUsage().rss,
    });
  };
  app.get("/healthz", healthHandler);

  if (config.basePath) {
    app.use((request, response, next) => {
      if (request.path === config.basePath) {
        const queryIndex = request.originalUrl.indexOf("?");
        const query = queryIndex >= 0 ? request.originalUrl.slice(queryIndex) : "";
        response.redirect(308, `${config.basePath}/${query}`);
        return;
      }
      if (!request.path.startsWith(`${config.basePath}/`)) {
        response.status(404).type("text/plain").send("Not found");
        return;
      }
      request.url = request.url.slice(config.basePath.length) || "/";
      next();
    });
    app.get("/healthz", healthHandler);
  }

  if (config.accessProtectionEnabled) {
    app.get("/access", (request, response) => {
      const returnTo = safeReturnTo(request.query.returnTo, config.basePath);
      response.setHeader("Cache-Control", "no-store");
      if (accessAuthorized(request)) {
        response.redirect(303, returnTo);
        return;
      }
      response.status(200).type("html").send(accessPage(returnTo, "", config.basePath));
    });

    app.post(
      "/access",
      express.urlencoded({ extended: false, limit: "2kb" }),
      (request, response) => {
        const returnTo = safeReturnTo(request.body?.returnTo, config.basePath);
        response.setHeader("Cache-Control", "no-store");
        if (!accessFormOriginAllowed(
          request,
          config.allowedOrigins,
          config.debug
        )) {
          response.status(403).type("html").send(
            accessPage(
              returnTo,
              "Запрос отклонён. Обновите страницу и попробуйте снова.",
              config.basePath
            )
          );
          return;
        }
        const ip = request.ip || requestIp(request);
        if (!timingSafeStringEqual(request.body?.password, accessPassword)) {
          if (!accessLimiter.consume(ip)) {
            response.status(429).type("html").send(
              accessPage(
                returnTo,
                "Слишком много попыток. Повторите через минуту.",
                config.basePath
              )
            );
            return;
          }
          log("access_denied", { ip });
          response
            .status(401)
            .type("html")
            .send(accessPage(returnTo, "Неверный пароль.", config.basePath));
          return;
        }
        response.cookie(ACCESS_COOKIE_NAME, accessToken, {
          httpOnly: true,
          sameSite: "strict",
          secure: request.secure || !isLoopbackHostname(request.hostname),
          path: config.basePath || "/",
          maxAge: ACCESS_COOKIE_MAX_AGE_MS,
        });
        log("access_granted", { ip });
        response.redirect(303, returnTo);
      }
    );

    app.use((request, response, next) => {
      if (accessAuthorized(request)) {
        next();
        return;
      }
      const acceptsHtml = String(request.headers.accept || "").includes(
        "text/html"
      );
      if ((request.method === "GET" || request.method === "HEAD") && acceptsHtml) {
        const returnTo = safeReturnTo(request.originalUrl, config.basePath);
        response.redirect(
          303,
          `${withBasePath(config.basePath, "/access")}?returnTo=${encodeURIComponent(returnTo)}`
        );
        return;
      }
      response.status(401).json({ error: "access_required" });
    });
  }

  app.post("/api/sessions", (request, response) => {
    if (!originAllowed(request, config.allowedOrigins, config.debug)) {
      response.status(403).json({ error: "origin_not_allowed" });
      return;
    }
    if (!createLimiter.consume(request.ip || requestIp(request))) {
      response.status(429).json({ error: "rate_limited" });
      return;
    }

    const session = manager.createSession(request.body || {}, {
      singleClient: true,
    });
    const settingsPreset = settingsPresetForNewSession();
    if (settingsPreset) {
      manager.applySettingsPreset(session, settingsPreset);
    }
    persistSessions();
    response.status(201).json({
      sessionId: session.id,
      expiresAt: session.expiresAt,
    });
  });

  app.post("/api/sessions/root", (request, response) => {
    if (!originAllowed(request, config.allowedOrigins, config.debug)) {
      response.status(403).json({ error: "origin_not_allowed" });
      return;
    }
    if (!createLimiter.consume(request.ip || requestIp(request))) {
      response.status(429).json({ error: "rate_limited" });
      return;
    }

    const session = manager.ensureDefaultSession();
    response.status(200).json({
      sessionId: session.id,
      expiresAt: session.expiresAt,
    });
  });

  app.post("/api/sessions/leave", (request, response) => {
    if (!originAllowed(request, config.allowedOrigins, config.debug)) {
      response.status(403).json({ error: "origin_not_allowed" });
      return;
    }

    const clientId = String(request.body?.clientId || "");
    const leaveToken = String(request.body?.leaveToken || "");
    if (
      !CLIENT_ID_PATTERN.test(clientId) ||
      !LEAVE_TOKEN_PATTERN.test(leaveToken)
    ) {
      response.status(400).json({ error: "invalid_leave" });
      return;
    }

    const session = manager.ensureDefaultSession();
    if (!manager.leaveClient(session, clientId, leaveToken)) {
      response.status(403).json({ error: "invalid_leave_token" });
      return;
    }
    persistSessions();
    response.status(204).end();
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

  app.get("/shared/room-settings.js", (_request, response) => {
    response.type("application/javascript");
    response.setHeader(
      "Cache-Control",
      config.debug ? "no-store" : "public, max-age=3600"
    );
    response.sendFile(path.join(ROOT_DIR, "shared", "room-settings.js"));
  });

  app.get("/shared/production-preset.js", (_request, response) => {
    response.type("application/javascript");
    response.setHeader(
      "Cache-Control",
      config.debug ? "no-store" : "public, max-age=3600"
    );
    response.sendFile(path.join(ROOT_DIR, "shared", "production-preset.js"));
  });

  app.get("/shared/gachi-sounds.js", (_request, response) => {
    response.type("application/javascript");
    response.setHeader(
      "Cache-Control",
      config.debug ? "no-store" : "public, max-age=3600"
    );
    response.sendFile(path.join(ROOT_DIR, "shared", "gachi-sounds.js"));
  });

  app.get("/shared/chain-sounds.js", (_request, response) => {
    response.type("application/javascript");
    response.setHeader(
      "Cache-Control",
      config.debug ? "no-store" : "public, max-age=3600"
    );
    response.sendFile(path.join(ROOT_DIR, "shared", "chain-sounds.js"));
  });

  const sendIndex = (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.sendFile(path.join(DIST_DIR, "index.html"));
  };
  app.get("/", sendIndex);
  app.get("/index.html", sendIndex);
  app.get(/^\/scene-[123]\/$/, (request, response) => {
    const queryIndex = request.originalUrl.indexOf("?");
    const query = queryIndex >= 0 ? request.originalUrl.slice(queryIndex) : "";
    response.redirect(
      308,
      `${withBasePath(config.basePath, request.path.replace(/\/$/, ""))}${query}`
    );
  });
  app.get(["/scene-1", "/scene-2", "/scene-3"], sendIndex);
  app.get(["/settings", "/settings/"], (request, response) => {
    const queryIndex = request.originalUrl.indexOf("?");
    const query = queryIndex >= 0 ? request.originalUrl.slice(queryIndex) : "";
    response.redirect(308, `${withBasePath(config.basePath, "/scene-1")}${query}`);
  });

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

    if (url.pathname !== withBasePath(config.basePath, "/realtime")) {
      socket.destroy();
      return;
    }
    if (!accessAuthorized(request)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
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

    const requestedSessionId = url.searchParams.get("session") || "";
    const clientId = url.searchParams.get("client") || "";
    if (
      !SESSION_ID_PATTERN.test(requestedSessionId) ||
      !CLIENT_ID_PATTERN.test(clientId)
    ) {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request, {
        sessionId: requestedSessionId,
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
    if (!client) {
      return;
    }
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
      if (!closingPromise) {
        persistSessions();
      }
    });
    websocket.on("error", () => {
      manager.disconnectClient(session, context.clientId, websocket);
      if (!closingPromise) {
        persistSessions();
      }
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
    productionPresetStore,
    settingsTemplateStore,
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
