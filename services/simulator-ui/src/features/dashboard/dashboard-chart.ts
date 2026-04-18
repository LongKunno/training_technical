import type { EChartsOption } from "echarts";

import { chartTheme, createLinearGradient } from "../../shared/charts";
import type { SessionTimelinePoint } from "../../shared/types";
import { formatCompactCurrency, formatShortTime } from "./dashboard-formatters";

export function createCurrentTimelineOption(
  points: SessionTimelinePoint[],
): EChartsOption | undefined {
  if (!points.length) {
    return undefined;
  }

  const seriesPoints = points.slice(-48);

  return {
    animationDuration: 450,
    color: [chartTheme.palette[0], chartTheme.palette[2]],
    legend: {
      icon: "roundRect",
      itemHeight: 8,
      itemWidth: 12,
      right: 12,
      textStyle: {
        color: chartTheme.axisLabel,
        fontSize: 11,
      },
      top: 12,
    },
    grid: {
      bottom: 22,
      containLabel: true,
      left: 10,
      right: 10,
      top: 54,
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(7, 16, 27, 0.92)",
      borderColor: "rgba(126, 203, 255, 0.2)",
      textStyle: {
        color: "#eef6ff",
      },
    },
    xAxis: [
      {
        axisLabel: {
          color: chartTheme.axisLabel,
          fontSize: 11,
        },
        axisLine: {
          lineStyle: { color: chartTheme.axisLine },
        },
        axisTick: { show: false },
        boundaryGap: false,
        data: seriesPoints.map((point) => formatShortTime(point.timestamp)),
        type: "category",
      },
    ],
    yAxis: [
      {
        axisLabel: {
          color: chartTheme.axisLabel,
          formatter: (value: number) => formatCompactCurrency(value),
          fontSize: 11,
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: {
          lineStyle: { color: chartTheme.axisSplit },
        },
        type: "value",
      },
      {
        axisLabel: {
          color: chartTheme.axisLabel,
          formatter: (value: number) => formatCompactCurrency(value),
          fontSize: 11,
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        position: "right",
        type: "value",
      },
    ],
    series: [
      {
        areaStyle: {
          color: createLinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(126, 203, 255, 0.38)" },
            { offset: 1, color: "rgba(126, 203, 255, 0.03)" },
          ]),
        },
        data: seriesPoints.map((point) => Number(point.equity ?? 0)),
        emphasis: {
          itemStyle: {
            borderColor: chartTheme.emphasis,
            borderWidth: 2,
          },
          scale: true,
        },
        lineStyle: {
          color: chartTheme.palette[0],
          width: 3,
        },
        name: "Equity",
        showSymbol: false,
        smooth: true,
        symbol: "circle",
        symbolSize: 7,
        type: "line",
      },
      {
        barMaxWidth: 14,
        data: seriesPoints.map((point) => Math.max(Number(point.drawdown ?? 0), 0)),
        itemStyle: {
          borderRadius: [999, 999, 0, 0],
          color: createLinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(244, 190, 81, 0.92)" },
            { offset: 1, color: "rgba(244, 190, 81, 0.22)" },
          ]),
        },
        name: "Drawdown",
        type: "bar",
        yAxisIndex: 1,
      },
    ],
  };
}
