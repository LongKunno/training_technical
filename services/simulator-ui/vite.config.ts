import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, searchForWorkspaceRoot } from "vite";

const srcDir = path.resolve(__dirname, "src");
const distDir = path.resolve(__dirname, "dist");
const publicDir = path.resolve(__dirname, "public");

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
};

export default defineConfig({
  envDir: __dirname,
  publicDir,
  cacheDir: path.resolve(__dirname, "node_modules/.vite"),
  plugins: [react()],
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
