import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backend = "http://127.0.0.1:8081";
const sharedReloadDelayMs = 600;
const sharedPhysicsPath = fileURLToPath(
  new URL("./shared/physics.js", import.meta.url),
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

export default defineConfig({
  base: "./",
  plugins: [react(), reloadSharedPhysics()],
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
    hmr: hmrClientPort ? { clientPort: hmrClientPort } : undefined,
    watch: {
      usePolling: true,
      interval: 150,
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
});
