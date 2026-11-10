import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Vite's `envDir` defaults to the directory holding this config — which is
 * `frontend/` in this npm workspace. Every documented variable, including the
 * browser-facing `VITE_*` ones, lives in the repository-root `.env`, so point
 * Vite there rather than keeping a second, drifting copy in `frontend/`.
 */
const envDir = resolve(here, "..");

export default defineConfig(({ mode }) => {
  // Only the public VITE_ prefix is loaded here; backend secrets in the same
  // .env are never read by (or exposed to) the frontend build.
  const env = loadEnv(mode, envDir, "VITE_");
  const apiTarget = process.env.VITE_API_TARGET ?? env.VITE_API_TARGET ?? "http://localhost:4000";

  return {
    envDir,
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      allowedHosts: [".ngrok-free.dev"],
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on("error", (_err, _req, res) => {
              if (res && "writeHead" in res && !res.headersSent) {
                res.writeHead(503, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Backend server unavailable" }));
              }
            });
          },
        },
        "/socket.io": {
          target: apiTarget,
          changeOrigin: true,
          ws: true,
          configure: (proxy) => {
            proxy.on("error", (err: any, _req: any, res: any) => {
              if (res && typeof res.writeHead === "function" && !res.headersSent) {
                res.writeHead(503);
                res.end();
              } else if (res && typeof res.destroy === "function") {
                res.destroy();
              }
            });
            proxy.on("proxyReqWs", (_proxyReq: any, _req: any, socket: any) => {
              socket.on("error", () => {
                socket.destroy();
              });
            });
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./tests/setup.ts"],
      include: ["tests/**/*.test.{ts,tsx}"],
      css: false,
    },
  };
});
