import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  useMarketReplayScenarioCatalogQuery,
  useSimulationBotsQuery,
  useSimulationLeaderboardQuery,
} from "../../shared/query";
import type { LeaderboardFilter } from "../../shared/types";
import { Badge, Button, DataTable, PageHeader, Panel, Select, StatCard } from "../../shared/ui";
import {
  formatCurrency,
  formatDateTime,
  formatRunStatus,
  formatSignedCurrency,
  getRunStatusTone,
} from "./formatters";

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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Simulation Platform"
        title="Leaderboard ranks completed standalone runs by outcome and resilience."
        description="This page stays single-run only. Experiment aggregates remain on experiment detail so batch matrices do not pollute the global ranking."
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
          { label: "Scenarios", value: String(scenariosQuery.data?.length ?? 0) },
        ]}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Panel
          eyebrow="Ranking"
          title="Completed standalone run outcomes"
          description="The leaderboard reads persisted metrics snapshots from standalone runs only, so historical rankings stay stable and batch aggregates stay separate."
        >
          <div className="mb-5 grid gap-4 md:grid-cols-2">
            <Select
              label="Bot"
              value={botId}
              options={[
                { label: "All bots", value: "" },
                ...(botsQuery.data ?? []).map((bot) => ({ label: bot.name, value: bot.bot_id })),
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

          <DataTable
            caption="Simulation leaderboard"
            columns={[
              {
                key: "status",
                header: "Status",
                cell: (row) => (
                  <Badge tone={getRunStatusTone(row.status)}>{formatRunStatus(row.status)}</Badge>
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
                cell: (row) => formatSignedCurrency(row.metrics_snapshot.total_pnl),
                align: "right",
              },
              {
                key: "drawdown",
                header: "Max DD",
                cell: (row) => formatCurrency(row.metrics_snapshot.max_drawdown),
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
            emptyTitle={leaderboardQuery.isLoading ? "Loading leaderboard" : "No completed runs yet"}
            emptyDescription="Completed runs with metrics snapshots will appear here."
          />
        </Panel>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <StatCard
            label="Best total PnL"
            value={rows[0] ? formatSignedCurrency(rows[0].metrics_snapshot.total_pnl) : "-"}
            detail={rows[0] ? rows[0].bot_name : "Run queue has no completed benchmark yet."}
            tone="success"
          />
          <StatCard
            label="Lowest drawdown"
            value={rows[0] ? formatCurrency(rows[0].metrics_snapshot.max_drawdown) : "-"}
            detail={rows[0] ? rows[0].scenario_id : "Need completed runs to compare resilience."}
            tone="accent"
          />
        </div>
      </div>
    </div>
  );
}
