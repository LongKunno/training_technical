import { useParams } from "react-router-dom";

import { ExperimentDetailRouteView } from "../../features/runs";

export function ExperimentDetailPage() {
  const { experimentId = "" } = useParams();
  return <ExperimentDetailRouteView experimentId={experimentId} />;
}
