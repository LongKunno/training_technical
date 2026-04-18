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
    ],
  },
]);
