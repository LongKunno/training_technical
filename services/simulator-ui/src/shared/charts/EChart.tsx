import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import {
  type BarSeriesOption,
  type EChartsOption,
  type GridComponentOption,
  type LegendComponentOption,
  type LineSeriesOption,
  type TooltipComponentOption,
} from "echarts";
import type { ComposeOption } from "echarts/core";

import { EmptyState } from "../ui/EmptyState";
import { SparklineIcon } from "../ui/icons";
import { cx } from "../ui/cx";

export type AppChartOption = ComposeOption<
  | BarSeriesOption
  | GridComponentOption
  | LegendComponentOption
  | LineSeriesOption
  | TooltipComponentOption
>;

type EChartsCoreModule = typeof import("echarts/core");
type ChartInstance = ReturnType<EChartsCoreModule["init"]>;

let echartsLoader: Promise<EChartsCoreModule> | null = null;

async function loadECharts() {
  if (!echartsLoader) {
    echartsLoader = (async () => {
      const [{ BarChart, LineChart }, components, echarts, { CanvasRenderer }] = await Promise.all([
        import("echarts/charts"),
        import("echarts/components"),
        import("echarts/core"),
        import("echarts/renderers"),
      ]);

      echarts.use([
        BarChart,
        CanvasRenderer,
        components.GridComponent,
        components.LegendComponent,
        LineChart,
        components.TooltipComponent,
      ]);

      return echarts;
    })();
  }

  return echartsLoader;
}

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
  const [isRuntimeReady, setIsRuntimeReady] = useState(false);

  useEffect(() => {
    if (!elementRef.current) {
      return undefined;
    }

    let observer: ResizeObserver | null = null;
    let cancelled = false;
    setIsRuntimeReady(false);

    void loadECharts().then((echarts) => {
      if (cancelled || !elementRef.current) {
        return;
      }

      const instance = echarts.init(elementRef.current, undefined, {
        renderer: "canvas",
      });

      instanceRef.current = instance;
      setIsRuntimeReady(true);
      onReady?.(instance);

      observer = new ResizeObserver(() => {
        instance.resize();
      });

      observer.observe(elementRef.current);
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
      const instance = instanceRef.current;
      if (!instance) {
        return;
      }

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

  const showChart = Boolean(option) || loading;
  const showRuntimeOverlay = Boolean(option) && !isRuntimeReady;
  const showEmptyState = !option && !loading;

  return (
    <div
      className={cx(
        "chart-fade-mask relative overflow-hidden rounded-[24px] border border-white/8 bg-white/[0.02]",
        className,
      )}
      style={{ height, ...style }}
    >
      <div ref={elementRef} className={cx("h-full w-full", !showChart ? "opacity-0" : "")} />
      {showRuntimeOverlay ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/55 backdrop-blur-sm">
          <div className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-slate-300">
            Loading chart runtime...
          </div>
        </div>
      ) : null}
      {showEmptyState ? (
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
