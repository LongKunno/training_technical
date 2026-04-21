import { Navigate, createBrowserRouter } from "react-router-dom";

import { App } from "./App";
import { RouteHydrateFallback } from "./RouteHydrateFallback";

async function loadDashboardPage() {
  const module = await import("./routes/DashboardPage");
  return { Component: module.DashboardPage };
}

async function loadSessionsPage() {
  const module = await import("./routes/SessionsPage");
  return { Component: module.SessionsPage };
}

async function loadSessionDetailPage() {
  const module = await import("./routes/SessionDetailPage");
  return { Component: module.SessionDetailPage };
}

async function loadLabPage() {
  const module = await import("./routes/LabPage");
  return { Component: module.LabPage };
}

async function loadRunsPage() {
  const module = await import("./routes/RunsPage");
  return { Component: module.RunsPage };
}

async function loadExperimentsPage() {
  const module = await import("./routes/ExperimentsPage");
  return { Component: module.ExperimentsPage };
}

async function loadExperimentDetailPage() {
  const module = await import("./routes/ExperimentDetailPage");
  return { Component: module.ExperimentDetailPage };
}

async function loadRunDetailPage() {
  const module = await import("./routes/RunDetailPage");
  return { Component: module.RunDetailPage };
}

async function loadLeaderboardPage() {
  const module = await import("./routes/LeaderboardPage");
  return { Component: module.LeaderboardPage };
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        index: true,
        element: <Navigate to="/dashboard" replace />,
      },
      {
        path: "dashboard",
        hydrateFallbackElement: (
          <RouteHydrateFallback
            title="Loading dashboard"
            description="Preparing the live operator surface and current-session chart runtime."
          />
        ),
        lazy: loadDashboardPage,
      },
      {
        path: "sessions",
        hydrateFallbackElement: (
          <RouteHydrateFallback
            title="Loading sessions"
            description="Resolving saved session history and historical preview panels."
          />
        ),
        lazy: loadSessionsPage,
      },
      {
        path: "sessions/:sessionId",
        hydrateFallbackElement: (
          <RouteHydrateFallback
            title="Loading session detail"
            description="Preparing immutable report, audit, and timeline detail for the selected run."
          />
        ),
        lazy: loadSessionDetailPage,
      },
      {
        path: "lab",
        hydrateFallbackElement: (
          <RouteHydrateFallback
            title="Loading operator lab"
            description="Preparing session controls, replay tools, and manual signal workflows."
          />
        ),
        lazy: loadLabPage,
      },
      {
        path: "runs",
        hydrateFallbackElement: (
          <RouteHydrateFallback
            title="Loading simulation runs"
            description="Preparing the bot catalog, run queue, and creation workflow."
          />
        ),
        lazy: loadRunsPage,
      },
      {
        path: "experiments",
        hydrateFallbackElement: (
          <RouteHydrateFallback
            title="Loading experiments"
            description="Preparing the sequential batch planner, recent experiment list, and aggregate evaluation surface."
          />
        ),
        lazy: loadExperimentsPage,
      },
      {
        path: "leaderboard",
        hydrateFallbackElement: (
          <RouteHydrateFallback
            title="Loading leaderboard"
            description="Preparing standalone-run rankings while batch experiment aggregates stay on experiment detail."
          />
        ),
        lazy: loadLeaderboardPage,
      },
      {
        path: "runs/:runId",
        hydrateFallbackElement: (
          <RouteHydrateFallback
            title="Loading run detail"
            description="Preparing immutable run metadata alongside session-scoped report, audit, and timeline data."
          />
        ),
        lazy: loadRunDetailPage,
      },
      {
        path: "experiments/:experimentId",
        hydrateFallbackElement: (
          <RouteHydrateFallback
            title="Loading experiment detail"
            description="Preparing experiment progress, summary aggregation, and child-run links."
          />
        ),
        lazy: loadExperimentDetailPage,
      },
    ],
  },
]);
