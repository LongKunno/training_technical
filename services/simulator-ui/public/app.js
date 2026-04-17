const core = (path) => `/core${path}`;
const data = (path) => `/data${path}`;

const elements = {
  sessionStatus: document.querySelector("#session-status"),
  sessionId: document.querySelector("#session-id"),
  sessionLastEvent: document.querySelector("#session-last-event"),
  totalEquity: document.querySelector("#total-equity"),
  sessionIdInput: document.querySelector("#session-id-input"),
  marketScenario: document.querySelector("#market-scenario"),
  marketTransport: document.querySelector("#market-transport"),
  marketSpeed: document.querySelector("#market-speed"),
  strategyScenario: document.querySelector("#strategy-scenario"),
  strategyId: document.querySelector("#strategy-id"),
  strategyLimit: document.querySelector("#strategy-limit"),
  strategyOffset: document.querySelector("#strategy-offset"),
  manualStrategyId: document.querySelector("#manual-strategy-id"),
  manualSignalId: document.querySelector("#manual-signal-id"),
  manualSymbol: document.querySelector("#manual-symbol"),
  manualSide: document.querySelector("#manual-side"),
  manualPrice: document.querySelector("#manual-price"),
  manualQuantity: document.querySelector("#manual-quantity"),
  manualNotional: document.querySelector("#manual-notional"),
  portfolioStats: document.querySelector("#portfolio-stats"),
  reportStats: document.querySelector("#report-stats"),
  rulesStats: document.querySelector("#rules-stats"),
  positionsBody: document.querySelector("#positions-body"),
  ordersBody: document.querySelector("#orders-body"),
  auditFeed: document.querySelector("#audit-feed"),
  signalsBody: document.querySelector("#signals-body"),
  positionsCount: document.querySelector("#positions-count"),
  ordersCount: document.querySelector("#orders-count"),
  auditCount: document.querySelector("#audit-count"),
  signalsCount: document.querySelector("#signals-count"),
  toast: document.querySelector("#toast"),
};

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "string"
        ? payload
        : payload?.error?.message || payload?.detail || "request failed";
    throw new Error(message);
  }

  return payload;
}

function currency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function number(value, digits = 4) {
  return Number(value || 0).toFixed(digits);
}

function formatTime(value) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function setStats(target, entries) {
  target.innerHTML = entries
    .map(
      (entry) => `
        <div class="stat-item">
          <span>${entry.label}</span>
          <strong>${entry.value}</strong>
        </div>
      `,
    )
    .join("");
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.remove("hidden");
  elements.toast.style.borderColor = isError
    ? "rgba(255, 107, 107, 0.42)"
    : "rgba(123, 211, 137, 0.36)";

  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    elements.toast.classList.add("hidden");
  }, 2400);
}

function renderPositions(positions) {
  elements.positionsCount.textContent = String(positions.length);
  elements.positionsBody.innerHTML =
    positions
      .map(
        (position) => `
          <tr>
            <td>${position.symbol}</td>
            <td>${number(position.quantity, 4)}</td>
            <td>${currency(position.average_price)}</td>
            <td>${currency(position.market_price)}</td>
            <td>${currency(position.unrealized_pnl)}</td>
          </tr>
        `,
      )
      .join("") ||
    `<tr><td colspan="5" class="muted">No positions yet.</td></tr>`;
}

function renderOrders(orders) {
  elements.ordersCount.textContent = String(orders.length);
  elements.ordersBody.innerHTML =
    orders
      .map(
        (order) => `
          <tr>
            <td>${formatTime(order.executed_at)}</td>
            <td>${order.symbol}</td>
            <td><span class="pill ${order.side}">${order.side}</span></td>
            <td>${number(order.quantity, 4)}</td>
            <td>${currency(order.price)}</td>
            <td>${currency(order.fee)}</td>
          </tr>
        `,
      )
      .join("") ||
    `<tr><td colspan="6" class="muted">No orders yet.</td></tr>`;
}

function renderAudit(events) {
  elements.auditCount.textContent = String(events.length);
  elements.auditFeed.innerHTML =
    events
      .map(
        (event) => `
          <article class="audit-entry">
            <header>
              <span>${event.type}</span>
              <span>${formatTime(event.timestamp)}</span>
            </header>
            <strong>${event.message}</strong>
            <div class="muted">${event.symbol || "global"} · ${event.id}</div>
          </article>
        `,
      )
      .join("") ||
    `<div class="muted">No audit events yet.</div>`;
}

function renderSignals(signals) {
  elements.signalsCount.textContent = String(signals.length);
  elements.signalsBody.innerHTML =
    signals
      .map(
        (signal) => `
          <tr>
            <td>${formatTime(signal.timestamp)}</td>
            <td>${signal.strategy_id}</td>
            <td>${signal.signal_id}</td>
            <td>${signal.symbol}</td>
            <td><span class="pill ${signal.side}">${signal.side}</span></td>
          </tr>
        `,
      )
      .join("") ||
    `<tr><td colspan="5" class="muted">No signals in this scenario.</td></tr>`;
}

function setSelectOptions(target, values, emptyLabel = "") {
  const options = [];
  if (emptyLabel) {
    options.push(`<option value="">${emptyLabel}</option>`);
  }
  options.push(
    ...values.map((value) => `<option value="${value}">${value}</option>`),
  );
  target.innerHTML = options.join("");
}

async function loadStrategySignals() {
  const scenario = elements.strategyScenario.value || "baseline";
  const payload = await fetchJSON(
    data(`/api/data/strategy/signals?scenario=${encodeURIComponent(scenario)}`),
  );
  const signals = payload.signals || [];
  renderSignals(signals);

  const strategyIds = [...new Set(signals.map((signal) => signal.strategy_id))];
  const selected = elements.strategyId.value;
  setSelectOptions(elements.strategyId, strategyIds, "All strategies");
  if (strategyIds.includes(selected)) {
    elements.strategyId.value = selected;
  }
}

async function refreshDashboard() {
  const [sessionPayload, portfolioPayload, reportPayload, rulesPayload, ordersPayload, auditPayload] =
    await Promise.all([
      fetchJSON(core("/api/paper/session")),
      fetchJSON(core("/api/paper/portfolio")),
      fetchJSON(core("/api/paper/report")),
      fetchJSON(core("/api/paper/rules")),
      fetchJSON(core("/api/paper/orders?limit=20&offset=0")),
      fetchJSON(core("/api/paper/audit?limit=40&offset=0")),
    ]);

  const session = sessionPayload.session;
  const portfolio = portfolioPayload.portfolio;
  const report = reportPayload.report;
  const rules = rulesPayload.rules;
  const orders = ordersPayload.orders || [];
  const events = auditPayload.events || [];

  elements.sessionStatus.textContent = session.status;
  elements.sessionId.textContent = session.id || "-";
  elements.sessionLastEvent.textContent = `Last event: ${formatTime(session.last_event_at)}`;
  elements.totalEquity.textContent = currency(portfolio.total_equity);
  if (!elements.sessionIdInput.value) {
    elements.sessionIdInput.value = session.id || "";
  }

  setStats(elements.portfolioStats, [
    { label: "Cash", value: currency(portfolio.cash_balance) },
    { label: "Realized PnL", value: currency(portfolio.realized_pnl) },
    { label: "Unrealized PnL", value: currency(portfolio.unrealized_pnl) },
    { label: "Total Equity", value: currency(portfolio.total_equity) },
  ]);

  setStats(elements.reportStats, [
    { label: "Filled Orders", value: String(report.filled_orders) },
    { label: "Rejected Signals", value: String(report.rejected_signals) },
    { label: "Fees Paid", value: currency(report.fees_paid) },
    { label: "Slippage Cost", value: currency(report.slippage_cost) },
    { label: "Max Drawdown", value: currency(report.max_drawdown) },
  ]);

  setStats(elements.rulesStats, [
    { label: "Fee Rate", value: number(rules.fee_rate, 4) },
    { label: "Slippage Rate", value: number(rules.slippage_rate, 4) },
    {
      label: "Allowed Symbols",
      value: (rules.risk_controls.allowed_symbols || []).join(", ") || "all",
    },
    {
      label: "Max Order Notional",
      value:
        Number(rules.risk_controls.max_order_notional || 0) > 0
          ? currency(rules.risk_controls.max_order_notional)
          : "disabled",
    },
  ]);

  renderPositions(portfolio.positions || []);
  renderOrders(orders);
  renderAudit(events);
}

async function hydrateScenarioPickers() {
  const [marketPayload, strategyPayload] = await Promise.all([
    fetchJSON(data("/api/data/market/quotes/replay/scenarios")),
    fetchJSON(data("/api/data/strategy/signals/scenarios")),
  ]);

  setSelectOptions(elements.marketScenario, marketPayload.scenarios || []);
  setSelectOptions(elements.strategyScenario, strategyPayload.scenarios || []);

  elements.marketScenario.value = marketPayload.scenarios?.[0] || "baseline";
  elements.strategyScenario.value = strategyPayload.scenarios?.[0] || "baseline";
  await loadStrategySignals();
}

async function postJSON(url, body) {
  return fetchJSON(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function handleAction(action) {
  switch (action) {
    case "start-session":
      await postJSON(core("/api/paper/session/start"), {
        session_id: elements.sessionIdInput.value.trim(),
      });
      showToast("Session started.");
      break;
    case "reset-session":
      await postJSON(core("/api/paper/session/reset"), {});
      showToast("Session reset.");
      break;
    case "stop-session":
      await postJSON(core("/api/paper/session/stop"), {});
      showToast("Session stopped.");
      break;
    case "publish-market":
      await postJSON(data("/api/data/market/quotes/publish"), {
        scenario: elements.marketScenario.value,
        transport: elements.marketTransport.value,
      });
      showToast("Latest market ticks published.");
      break;
    case "replay-market":
      await postJSON(data("/api/data/market/quotes/replay"), {
        scenario: elements.marketScenario.value,
        speed_multiplier: Number(elements.marketSpeed.value || 0),
        transport: elements.marketTransport.value,
      });
      showToast("Market replay finished.");
      break;
    case "publish-signals":
      await postJSON(data("/api/data/strategy/signals/publish"), {
        scenario: elements.strategyScenario.value,
        strategy_id: elements.strategyId.value || null,
        limit: Number(elements.strategyLimit.value || 0),
        offset: Number(elements.strategyOffset.value || 0),
      });
      showToast("Strategy signals published.");
      break;
    case "replay-signals":
      await postJSON(data("/api/data/strategy/signals/replay"), {
        scenario: elements.strategyScenario.value,
        strategy_id: elements.strategyId.value || null,
        speed_multiplier: 0,
      });
      showToast("Strategy replay finished.");
      break;
    case "send-manual-signal":
      await postJSON(core("/internal/signals"), {
        strategy_id: elements.manualStrategyId.value.trim(),
        signal_id: elements.manualSignalId.value.trim(),
        symbol: elements.manualSymbol.value.trim(),
        side: elements.manualSide.value,
        quantity: Number(elements.manualQuantity.value || 0),
        notional: Number(elements.manualNotional.value || 0),
        price_hint: Number(elements.manualPrice.value || 0),
        timestamp: new Date().toISOString(),
      });
      showToast("Manual signal sent.");
      elements.manualSignalId.value = `manual-signal-${Date.now()}`;
      break;
    default:
      break;
  }

  await loadStrategySignals();
  await refreshDashboard();
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }

  button.disabled = true;
  try {
    await handleAction(button.dataset.action);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

elements.strategyScenario.addEventListener("change", async () => {
  await loadStrategySignals();
});

async function boot() {
  try {
    await hydrateScenarioPickers();
    await refreshDashboard();
    showToast("Dashboard ready.");
  } catch (error) {
    showToast(error.message, true);
  }

  window.setInterval(async () => {
    try {
      await refreshDashboard();
    } catch (error) {
      showToast(error.message, true);
    }
  }, 4000);
}

boot();
