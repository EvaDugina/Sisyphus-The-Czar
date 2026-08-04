import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backend = "http://127.0.0.1:8081";

function positiveIntegerFromEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const sharedReloadDelayMs = positiveIntegerFromEnv(
  "VITE_SHARED_RELOAD_DELAY_MS",
  250,
);
const watchIntervalMs = positiveIntegerFromEnv(
  "VITE_WATCH_INTERVAL_MS",
  50,
);
const sharedPhysicsPath = fileURLToPath(
  new URL("./shared/physics.js", import.meta.url),
);
const productionControlsStylePath = fileURLToPath(
  new URL("./src/styles/controls.prod.css", import.meta.url),
);
const productionSettingsPanelPath = fileURLToPath(
  new URL("./src/components/SettingsPanel.prod.jsx", import.meta.url),
);
const productionToolbarPath = fileURLToPath(
  new URL("./src/components/Toolbar.prod.jsx", import.meta.url),
);
const productionSettingsControllerPath = fileURLToPath(
  new URL("./src/runtime/createSettingsController.prod.js", import.meta.url),
);
const configuredHmrClientPort = Number.parseInt(
  process.env.VITE_HMR_CLIENT_PORT ?? "",
  10,
);
const hmrClientPort = Number.isInteger(configuredHmrClientPort)
  ? configuredHmrClientPort
  : null;

function reloadSharedPhysics() {
  let reloadTimer = null;

  return {
    name: "reload-shared-physics",
    configureServer(server) {
      server.watcher.add(sharedPhysicsPath);
      server.watcher.on("change", (changedPath) => {
        if (changedPath === sharedPhysicsPath) {
          clearTimeout(reloadTimer);
          reloadTimer = setTimeout(() => {
            reloadTimer = null;
            server.ws.send({ type: "full-reload", path: "*" });
          }, sharedReloadDelayMs);
        }
      });
    },
  };
}

function serveMainFromDraftPath() {
  return {
    name: "serve-main-from-draft-path",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (request.url === "/drafts" || request.url === "/drafts/") {
          request.url = "/index.html";
        }
        next();
      });
    },
  };
}

export default defineConfig(({ command }) => {
  const isProductionBuild = command === "build";
  const debugUiEnabled =
    !isProductionBuild || process.env.VITE_DEBUG_UI === "true";

  return {
    base: "./",
    plugins: [react(), reloadSharedPhysics(), serveMainFromDraftPath()],
    resolve: {
      alias: isProductionBuild && !debugUiEnabled
        ? [
            {
              find: "./styles/controls.css",
              replacement: productionControlsStylePath,
            },
            {
              find: "./components/SettingsPanel",
              replacement: productionSettingsPanelPath,
            },
            {
              find: "./components/Toolbar",
              replacement: productionToolbarPath,
            },
            {
              find: "./createSettingsController.js",
              replacement: productionSettingsControllerPath,
            },
          ]
        : [],
    },
    server: {
      host: "0.0.0.0",
      port: 8080,
      strictPort: true,
      hmr: hmrClientPort ? { clientPort: hmrClientPort } : undefined,
      watch: {
        usePolling: true,
        interval: watchIntervalMs,
        ignored: [
          "**/.git/**",
          "**/node_modules/**",
          "**/data/**",
          "**/dist/**",
          "**/playwright-report/**",
          "**/test-results/**",
        ],
      },
      proxy: {
        "/api": backend,
        "/healthz": backend,
        "/shared": backend,
        "/realtime": {
          target: backend,
          ws: true,
        },
      },
    },
  };
});
