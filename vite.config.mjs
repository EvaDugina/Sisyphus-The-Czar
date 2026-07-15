import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backend = "http://127.0.0.1:8081";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
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
