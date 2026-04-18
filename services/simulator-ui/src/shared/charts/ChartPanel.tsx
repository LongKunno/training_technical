import type { ReactNode } from "react";

import { Panel, type PanelProps } from "../ui/Panel";
import { EChart, type EChartProps } from "./EChart";

export interface ChartPanelProps extends Omit<PanelProps, "children"> {
  chart: EChartProps;
  footer?: ReactNode;
}

export function ChartPanel({ chart, footer, ...panelProps }: ChartPanelProps) {
  return (
    <Panel {...panelProps}>
      <EChart {...chart} />
      {footer ? <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-400">{footer}</div> : null}
    </Panel>
  );
}
