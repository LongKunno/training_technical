import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  type GridComponentOption,
  type LegendComponentOption,
  type TooltipComponentOption,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { BarSeriesOption, LineSeriesOption } from "echarts/charts";
import type { EChartsOption } from "echarts";

import { EmptyState } from "../ui/EmptyState";
import { SparklineIcon } from "../ui/icons";
import { cx } from "../ui/cx";

echarts.use([BarChart, CanvasRenderer, GridComponent, LegendComponent, LineChart, TooltipComponent]);

export type AppChartOption = echarts.ComposeOption<
  | BarSeriesOption
  | GridComponentOption
  | LegendComponentOption
  | LineSeriesOption
  | TooltipComponentOption
>;

type ChartInstance = ReturnType<typeof echarts.init>;

export interface EChartProps {
  option?: AppChartOption | EChartsOption;
  className?: string;
  height?: number;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  style?: CSSProperties;
  onReady?: (instance: ChartInstance) => void;
}

export function EChart({
  className,
  emptyDescription = "Data hooks can hand this surface a full ECharts option once the domain layer lands.",
  emptyTitle = "Chart will render here",
  height = 320,
  loading = false,
  onReady,
  option,
  style,
}: EChartProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<ChartInstance | null>(null);

  useEffect(() => {
    if (!elementRef.current) {
      return undefined;
    }

    const instance = echarts.init(elementRef.current, undefined, {
      renderer: "canvas",
    });

    instanceRef.current = instance;
    onReady?.(instance);

    const observer = new ResizeObserver(() => {
      instance.resize();
    });

    observer.observe(elementRef.current);

    return () => {
      observer.disconnect();
      instance.dispose();
      instanceRef.current = null;
    };
  }, [onReady]);

  useEffect(() => {
    if (!instanceRef.current) {
      return;
    }

    if (!option) {
      instanceRef.current.clear();
      return;
    }

    instanceRef.current.setOption(option, true);
    instanceRef.current.resize();
  }, [option]);

  useEffect(() => {
    if (!instanceRef.current) {
      return;
    }

    if (loading) {
      instanceRef.current.showLoading("default", {
        color: "#7ecbff",
        textColor: "#8ba2b8",
        maskColor: "rgba(6, 16, 26, 0.46)",
      });
      return;
    }

    instanceRef.current.hideLoading();
  }, [loading]);

  return (
    <div
      className={cx(
        "chart-fade-mask relative overflow-hidden rounded-[24px] border border-white/8 bg-white/[0.02]",
        className,
      )}
      style={{ height, ...style }}
    >
      <div ref={elementRef} className={cx("h-full w-full", !option && !loading ? "opacity-0" : "")} />
      {!option && !loading ? (
        <div className="absolute inset-0">
          <EmptyState
            eyebrow="Chart surface"
            title={emptyTitle}
            description={emptyDescription}
            icon={<SparklineIcon className="size-5" />}
            className="h-full rounded-none border-0 bg-transparent"
          />
        </div>
      ) : null}
    </div>
  );
}
