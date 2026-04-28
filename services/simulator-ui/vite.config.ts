import path from "node:path";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig, searchForWorkspaceRoot } from "vite";

const srcDir = path.resolve(__dirname, "src");
const distDir = path.resolve(__dirname, "dist");
const publicDir = path.resolve(__dirname, "public");

function isBlockedInternalProxyRoute(requestUrl: string) {
  const requestPath = requestUrl.split("?")[0] ?? "";

  return (
    requestPath.startsWith("/core/internal/ops") ||
    requestPath.startsWith("/data/internal/ops") ||
    ((requestPath === "/bot" || requestPath.startsWith("/bot/")) &&
      requestPath !== "/bot/health")
  );
}

function blockInternalProxyRoutes(): Plugin {
  return {
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = request.url ?? "";
        if (!isBlockedInternalProxyRoute(requestUrl)) {
          next();
          return;
        }

        response.statusCode = 404;
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            error: {
              code: "not_found",
              message: "Not found",
            },
          }),
        );
      });
    },
    name: "block-internal-proxy-routes",
  };
}

const proxyConfig = {
  "/core": {
    target:
      process.env.SIMULATOR_UI_CORE_PROXY_TARGET ?? "http://core_trading:8080",
    changeOrigin: true,
    secure: false,
    rewrite: (requestPath: string) => requestPath.replace(/^\/core/, ""),
  },
  "/data": {
    target:
      process.env.SIMULATOR_UI_DATA_PROXY_TARGET ?? "http://data_pipeline:8000",
    changeOrigin: true,
    secure: false,
    rewrite: (requestPath: string) => requestPath.replace(/^\/data/, ""),
  },
  "^/bot/health$": {
    target:
      process.env.SIMULATOR_UI_BOT_PROXY_TARGET ?? "http://bot_runner:8001",
    changeOrigin: true,
    secure: false,
    rewrite: () => "/health",
  },
};

export default defineConfig({
  envDir: __dirname,
  publicDir,
  cacheDir: path.resolve(__dirname, "node_modules/.vite"),
  plugins: [blockInternalProxyRoutes(), react()],
  resolve: {
    alias: {
      "@": srcDir,
      "@app": path.resolve(srcDir, "app"),
      "@features": path.resolve(srcDir, "features"),
      "@shared": path.resolve(srcDir, "shared"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: ["simulator_ui", "localhost", "127.0.0.1"],
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), srcDir],
    },
    proxy: proxyConfig,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    proxy: proxyConfig,
  },
  build: {
    outDir: distDir,
    emptyOutDir: true,
    sourcemap: true,
    assetsDir: "assets",
  },
});
