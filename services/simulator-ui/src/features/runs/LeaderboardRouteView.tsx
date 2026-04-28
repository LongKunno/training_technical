import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { formatOperatorErrorMessage } from "../../shared/api";
import {
  ChartPanel,
  createHorizontalBarOption,
} from "../../shared/charts";
import {
  useMarketReplayScenarioCatalogQuery,
  useSimulationBotsQuery,
  useSimulationLeaderboardQuery,
} from "../../shared/query";
import type { LeaderboardEntry, LeaderboardFilter } from "../../shared/types";
import {
  Badge,
  Button,
  DataTable,
  DisclosurePanel,
  InfoTooltip,
  PageHeader,
  Panel,
  Select,
  SummaryStrip,
} from "../../shared/ui";
import {
  formatCurrency,
  formatDateTime,
  formatRunStatus,
  formatSignedCurrency,
  getRunStatusTone,
} from "./formatters";

function buildTopPerformerPoints(rows: LeaderboardEntry[]) {
  return rows.slice(0, 5).map((row) => ({
    label: row.run_id,
    value: row.metrics_snapshot.total_pnl,
  }));
}

function buildDrawdownPoints(rows: LeaderboardEntry[]) {
  return [...rows]
    .sort(
      (left, right) =>
        left.metrics_snapshot.max_drawdown -
        right.metrics_snapshot.max_drawdown,
    )
    .slice(0, 5)
    .map((row) => ({
      label: row.run_id,
      value: row.metrics_snapshot.max_drawdown,
    }));
}

function formatLeaderboardError(error: unknown) {
  return formatOperatorErrorMessage(error, "Leaderboard could not be loaded.");
}

export function LeaderboardRouteView() {
  const navigate = useNavigate();
  const botsQuery = useSimulationBotsQuery();
  const scenariosQuery = useMarketReplayScenarioCatalogQuery();
  const [botId, setBotId] = useState("");
  const [scenarioId, setScenarioId] = useState("");
  const filter: LeaderboardFilter = {
    bot_id: botId,
    scenario_id: scenarioId,
    limit: 50,
    offset: 0,
  };
  const leaderboardQuery = useSimulationLeaderboardQuery(filter);
  const rows = leaderboardQuery.data ?? [];
  const leaderboardError = leaderboardQuery.isError
    ? formatLeaderboardError(leaderboardQuery.error)
    : null;
  const topPnlRow = rows[0];
  const lowestDrawdownRow = [...rows].sort(
    (left, right) =>
      left.metrics_snapshot.max_drawdown - right.metrics_snapshot.max_drawdown,
  )[0];
  const topPerformerOption = rows.length
    ? createHorizontalBarOption(buildTopPerformerPoints(rows), {
        formatter: (value) => formatSignedCurrency(value),
      })
    : undefined;
  const lowDrawdownOption = rows.length
    ? createHorizontalBarOption(buildDrawdownPoints(rows), {
        formatter: (value) => formatCurrency(value),
      })
    : undefined;
  return (
    <div className="space-y-6">
      <PageHeader
        variant="compact"
        tone="soft"
        eyebrow="Simulation Platform"
        title="Standalone run leaderboard"
        description="Trang này chỉ xếp hạng completed standalone run; aggregate của batch experiment vẫn nằm ở experiment detail."
        actions={
          <>
            <Button tone="secondary" onClick={() => navigate("/runs")}>
              Back to runs
            </Button>
            <Button tone="secondary" onClick={() => navigate("/experiments")}>
              Open experiments
            </Button>
            <Button tone="ghost" onClick={() => navigate("/dashboard")}>
              Open dashboard
            </Button>
          </>
        }
        meta={[
          { label: "Completed runs", value: String(rows.length) },
          { label: "Bots", value: String(botsQuery.data?.length ?? 0) },
          {
            label: "Scenarios",
            value: String(scenariosQuery.data?.length ?? 0),
          },
        ]}
        aside={
          <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">Single-run only</Badge>
              <Badge tone="warning">No experiment aggregate</Badge>
            </div>
            <DisclosurePanel
              className="mt-4"
              label="View rules"
              contentClassName="space-y-2"
            >
              <p>
                Leaderboard này chỉ nhận các run standalone đã completed. Nó
                không trộn row aggregate từ experiments vào bảng xếp hạng chung.
              </p>
              <p>
                Nếu anh muốn so sánh matrix batch, hãy mở experiment detail thay
                vì dùng trang này.
              </p>
            </DisclosurePanel>
          </div>
        }
      />

      <SummaryStrip
        items={[
          {
            badge: <Badge tone="success">Best</Badge>,
            label: "Best total PnL",
            meta: topPnlRow ? topPnlRow.bot_name : "Chưa có completed run nào để xếp hạng.",
            tone: "success",
            value: topPnlRow ? formatSignedCurrency(topPnlRow.metrics_snapshot.total_pnl) : "-",
          },
          {
            badge: <Badge tone="info">Drawdown</Badge>,
            label: "Lowest drawdown",
            meta: lowestDrawdownRow
              ? lowestDrawdownRow.scenario_id
              : "Cần có completed run để so drawdown.",
            tone: "accent",
            value: lowestDrawdownRow ? formatCurrency(lowestDrawdownRow.metrics_snapshot.max_drawdown) : "-",
          },
          {
            badge: <Badge tone="neutral">Visible</Badge>,
            label: "Visible rows",
            meta: `${botId || "All bots"} · ${scenarioId || "All scenarios"}`,
            tone: "neutral",
            value: String(rows.length),
          },
        ]}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Panel
          eyebrow="Ranking"
          title={
            <span className="inline-flex items-center gap-2">
              Completed standalone run outcomes
              <InfoTooltip content="Bảng này vẫn là source of truth để đọc đầy đủ run ID, bot, scenario, PnL, drawdown và thời điểm cập nhật." />
            </span>
          }
          description="Chỉ đọc persisted metrics snapshot của standalone run."
        >
          <div className="mb-5 grid gap-4 md:grid-cols-2">
            <Select
              label="Bot"
              value={botId}
              options={[
                { label: "All bots", value: "" },
                ...(botsQuery.data ?? []).map((bot) => ({
                  label: bot.name,
                  value: bot.bot_id,
                })),
              ]}
              onChange={(event) => setBotId(event.target.value)}
            />
            <Select
              label="Scenario"
              value={scenarioId}
              options={[
                { label: "All scenarios", value: "" },
                ...(scenariosQuery.data ?? []).map((scenario) => ({
                  label: scenario.name,
                  value: scenario.scenario_id,
                })),
              ]}
              onChange={(event) => setScenarioId(event.target.value)}
            />
          </div>

          {leaderboardError ? (
            <div className="mb-5 rounded-[18px] border border-rose-300/20 bg-rose-300/[0.08] px-4 py-4 text-sm text-rose-100">
              <div className="font-medium">Leaderboard unavailable</div>
              <p className="mt-2 leading-6 text-rose-50/85">
                {leaderboardError}
              </p>
            </div>
          ) : null}

          <DataTable
            caption="Simulation leaderboard"
            columns={[
              {
                key: "status",
                header: "Status",
                cell: (row) => (
                  <Badge tone={getRunStatusTone(row.status)}>
                    {formatRunStatus(row.status)}
                  </Badge>
                ),
              },
              {
                key: "run",
                header: "Run",
                cell: (row) => (
                  <div className="space-y-1">
                    <div className="font-medium text-white">{row.run_id}</div>
                    <div className="text-xs text-slate-500">
                      {row.bot_id} · {row.bot_version}
                    </div>
                  </div>
                ),
              },
              {
                key: "scenario",
                header: "Scenario",
                cell: (row) => row.scenario_id,
              },
              {
                key: "total",
                header: "Total PnL",
                cell: (row) =>
                  formatSignedCurrency(row.metrics_snapshot.total_pnl),
                align: "right",
              },
              {
                key: "drawdown",
                header: "Max DD",
                cell: (row) =>
                  formatCurrency(row.metrics_snapshot.max_drawdown),
                align: "right",
              },
              {
                key: "updated",
                header: "Updated",
                cell: (row) => formatDateTime(row.updated_at),
              },
              {
                key: "actions",
                header: "Actions",
                cell: (row) => (
                  <Link
                    to={`/runs/${encodeURIComponent(row.run_id)}`}
                    className="text-sm font-medium text-sky-200 hover:text-sky-100"
                  >
                    Open detail
                  </Link>
                ),
                align: "right",
              },
            ]}
            rows={rows}
            getRowId={(row) => row.run_id}
            emptyTitle={
              leaderboardError
                ? "Leaderboard unavailable"
                : leaderboardQuery.isLoading
                ? "Loading leaderboard"
                : "No completed runs yet"
            }
            emptyDescription={
              leaderboardError ??
              "Khi completed standalone run có metrics snapshot, row sẽ xuất hiện tại đây."
            }
          />
        </Panel>

        <div className="grid gap-6">
          <ChartPanel
            tone="soft"
            eyebrow="PnL"
            title={
              <span className="inline-flex items-center gap-2">
                Top performers
                <InfoTooltip content="Biểu đồ này xếp các run có total PnL cao nhất trong tập đang hiển thị để anh scan kết quả tốt nhất nhanh hơn." />
              </span>
            }
            description="Top run theo total PnL trên tập hiện tại."
            chart={{
              emptyDescription: "Chưa có completed standalone run để so PnL.",
              emptyTitle: "No top performers",
              height: 260,
              loading: leaderboardQuery.isLoading,
              option: topPerformerOption,
            }}
          />

          <ChartPanel
            tone="soft"
            eyebrow="Resilience"
            title={
              <span className="inline-flex items-center gap-2">
                Lowest drawdown leaders
                <InfoTooltip content="Biểu đồ này lấy các run có max drawdown thấp nhất để đọc nhanh nhóm có resilience tốt hơn trong leaderboard." />
              </span>
            }
            description="Top run theo drawdown thấp nhất trên tập hiện tại."
            chart={{
              emptyDescription:
                "Chưa có completed standalone run để so drawdown.",
              emptyTitle: "No low drawdown leaders",
              height: 260,
              loading: leaderboardQuery.isLoading,
              option: lowDrawdownOption,
            }}
          />
        </div>
      </div>
    </div>
  );
}
