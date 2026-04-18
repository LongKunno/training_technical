import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const host = process.env.HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "80", 10);
const coreTarget =
  process.env.SIMULATOR_UI_CORE_PROXY_TARGET ?? "http://core_trading:8080";
const dataTarget =
  process.env.SIMULATOR_UI_DATA_PROXY_TARGET ?? "http://data_pipeline:8000";

const distDir = path.resolve(__dirname, "../dist");
const indexFile = path.join(distDir, "index.html");

if (!existsSync(indexFile)) {
  console.error(`No UI build found. Expected index.html in ${distDir}.`);
  process.exit(1);
}

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", true);

const createUpstreamProxy = (target) =>
  createProxyMiddleware({
    target,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    proxyTimeout: 0,
    timeout: 0,
    pathRewrite: (requestPath) =>
      requestPath.replace(/^\/(?:core|data)/, ""),
  });

app.use("/core", createUpstreamProxy(coreTarget));
app.use("/data", createUpstreamProxy(dataTarget));

app.use(
  express.static(distDir, {
    extensions: ["html"],
    index: "index.html",
  }),
);

app.use((request, response, next) => {
  if (!["GET", "HEAD"].includes(request.method)) {
    next();
    return;
  }

  if (request.path.startsWith("/core") || request.path.startsWith("/data")) {
    next();
    return;
  }

  response.sendFile(indexFile);
});

app.listen(port, host, () => {
  console.log(`simulator-ui runtime listening on http://${host}:${port}`);
  console.log(`Serving assets from ${distDir}`);
  console.log(`Proxying /core -> ${coreTarget}`);
  console.log(`Proxying /data -> ${dataTarget}`);
});
