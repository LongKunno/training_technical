import { Navigate, createBrowserRouter } from "react-router-dom";

import { App } from "./App";

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
        lazy: loadDashboardPage,
      },
      {
        path: "sessions",
        lazy: loadSessionsPage,
      },
      {
        path: "sessions/:sessionId",
        lazy: loadSessionDetailPage,
      },
      {
        path: "lab",
        lazy: loadLabPage,
      },
    ],
  },
]);
