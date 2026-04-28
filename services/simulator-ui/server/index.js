import { randomUUID } from "node:crypto";
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
const botTarget =
  process.env.SIMULATOR_UI_BOT_PROXY_TARGET ?? "http://bot_runner:8001";
const startedAt = new Date().toISOString();

const distDir = path.resolve(__dirname, "../dist");
const indexFile = path.join(distDir, "index.html");

function writeLog(level, event, fields = {}) {
  const payload = {
    event,
    level,
    service: "simulator_ui",
    timestamp: new Date().toISOString(),
    ...fields,
  };

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }

  console.log(line);
}

if (!existsSync(indexFile)) {
  writeLog("error", "startup_failed", {
    reason: "missing_index_html",
    dist_dir: distDir,
  });
  process.exit(1);
}

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", true);

app.use((request, response, next) => {
  const incomingRequestId = request.get("x-request-id")?.trim();
  const requestId = incomingRequestId || randomUUID();

  request.headers["x-request-id"] = requestId;
  response.setHeader("x-request-id", requestId);
  next();
});

function firstQueryValue(value) {
  if (Array.isArray(value)) {
    return value.find((item) => typeof item === "string" && item.trim()) ?? "";
  }

  return typeof value === "string" ? value.trim() : "";
}

function decodePathValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractRouteContext(pathName, query) {
  const context = {};
  const sessionID = firstQueryValue(query.session_id);
  const runID = firstQueryValue(query.run_id);
  const experimentID = firstQueryValue(query.experiment_id);

  if (sessionID) {
    context.session_id = sessionID;
  }

  if (runID) {
    context.run_id = runID;
  }

  if (experimentID) {
    context.experiment_id = experimentID;
  }

  const runPathMatch =
    pathName.match(/^\/core\/api\/sim\/runs\/([^/]+)$/) ??
    pathName.match(/^\/core\/api\/sim\/runs\/([^/]+)\/stop$/) ??
    pathName.match(/^\/core\/internal\/sim\/runs\/([^/]+)\/(?:status|heartbeat)$/);
  if (runPathMatch?.[1] && !context.run_id) {
    context.run_id = decodePathValue(runPathMatch[1]);
  }

  const experimentPathMatch =
    pathName.match(/^\/core\/api\/sim\/experiments\/([^/]+)$/) ??
    pathName.match(/^\/core\/api\/sim\/experiments\/([^/]+)\/(?:summary|stop)$/);
  if (experimentPathMatch?.[1] && !context.experiment_id) {
    context.experiment_id = decodePathValue(experimentPathMatch[1]);
  }

  return context;
}

function resolveUpstreamName(requestPath) {
  if (requestPath.startsWith("/core/") || requestPath === "/core") {
    return "core";
  }

  if (requestPath.startsWith("/data/") || requestPath === "/data") {
    return "data";
  }

  if (requestPath.startsWith("/bot/") || requestPath === "/bot") {
    return "bot";
  }

  return "ui";
}

app.use((request, response, next) => {
  const startedAtNs = process.hrtime.bigint();
  const originalPath = request.path;
  const originalQuery = { ...request.query };

  response.on("finish", () => {
    const durationMs =
      Number(process.hrtime.bigint() - startedAtNs) / 1_000_000;

    writeLog("info", "http_request", {
      duration_ms: Number(durationMs.toFixed(2)),
      method: request.method,
      path: originalPath,
      request_id: request.get("x-request-id"),
      status: response.statusCode,
      upstream: resolveUpstreamName(originalPath),
      ...extractRouteContext(originalPath, originalQuery),
    });
  });

  next();
});

app.get("/health", (request, response) => {
  response.json({
    mode: process.env.NODE_ENV ?? "production",
    request_id: request.get("x-request-id"),
    service: "simulator_ui",
    started_at: startedAt,
    status: "ok",
    upstreams: {
      bot: botTarget,
      core: coreTarget,
      data: dataTarget,
    },
  });
});

const isBlockedOpsRoute = (requestPath) =>
  requestPath.startsWith("/core/internal/ops") || requestPath.startsWith("/data/internal/ops");

app.use((request, response, next) => {
  if (!isBlockedOpsRoute(request.path)) {
    next();
    return;
  }

  response.status(404).json({
    error: {
      code: "not_found",
      message: "Not found",
    },
  });
});

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
app.get("/bot/health", async (request, response) => {
  try {
    const upstreamResponse = await fetch(new URL("/health", botTarget), {
      headers: {
        "x-request-id": request.get("x-request-id"),
      },
    });
    const payload = await upstreamResponse.text();
    response
      .status(upstreamResponse.status)
      .type(upstreamResponse.headers.get("content-type") ?? "application/json")
      .send(payload);
  } catch {
    response.status(503).json({
      error: {
        code: "upstream_unavailable",
        message: "Bot runner is unavailable.",
      },
    });
  }
});

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

  if (
    request.path.startsWith("/core") ||
    request.path.startsWith("/data") ||
    request.path.startsWith("/bot")
  ) {
    next();
    return;
  }

  response.sendFile(indexFile);
});

app.listen(port, host, () => {
  writeLog("info", "runtime_started", {
    dist_dir: distDir,
    host,
    port,
    upstreams: {
      bot: botTarget,
      core: coreTarget,
      data: dataTarget,
    },
  });
});
