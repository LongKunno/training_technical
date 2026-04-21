import { useParams } from "react-router-dom";

import { RunDetailRouteView } from "../../features/runs";

export function RunDetailPage() {
  const { runId } = useParams();

  return <RunDetailRouteView runId={runId ?? ""} />;
}
