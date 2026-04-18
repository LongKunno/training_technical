import { graphic } from "echarts/core";
import type { EChartsOption } from "echarts";

import { chartTheme } from "./chartTheme";

export interface TimelinePoint {
  label: string;
  value: number;
}

export interface DistributionPoint {
  label: string;
  value: number;
}

export function createTimelineAreaOption(points: TimelinePoint[]): EChartsOption {
  return {
    animationDuration: 500,
    color: chartTheme.palette,
    grid: {
      left: 10,
      right: 10,
      top: 18,
      bottom: 22,
      containLabel: true,
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(7, 16, 27, 0.92)",
      borderColor: "rgba(126, 203, 255, 0.2)",
      textStyle: {
        color: "#eef6ff",
      },
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: points.map((point) => point.label),
      axisLine: { lineStyle: { color: chartTheme.axisLine } },
      axisTick: { show: false },
      axisLabel: {
        color: chartTheme.axisLabel,
        fontSize: 11,
      },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: chartTheme.axisSplit } },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: chartTheme.axisLabel,
        fontSize: 11,
      },
    },
    series: [
      {
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 8,
        lineStyle: {
          width: 3,
          color: chartTheme.palette[0],
        },
        areaStyle: {
          color: new graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(126, 203, 255, 0.38)" },
            { offset: 1, color: "rgba(126, 203, 255, 0.02)" },
          ]),
        },
        emphasis: {
          scale: true,
          itemStyle: {
            borderColor: chartTheme.emphasis,
            borderWidth: 2,
          },
        },
        data: points.map((point) => point.value),
      },
    ],
  };
}

export function createDistributionBarOption(points: DistributionPoint[]): EChartsOption {
  return {
    animationDuration: 500,
    grid: {
      left: 10,
      right: 10,
      top: 18,
      bottom: 8,
      containLabel: true,
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: "rgba(7, 16, 27, 0.92)",
      borderColor: "rgba(66, 217, 186, 0.2)",
      textStyle: {
        color: "#eef6ff",
      },
    },
    xAxis: {
      type: "value",
      splitLine: { lineStyle: { color: chartTheme.axisSplit } },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: chartTheme.axisLabel,
        fontSize: 11,
      },
    },
    yAxis: {
      type: "category",
      data: points.map((point) => point.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: chartTheme.axisLabel,
        fontSize: 11,
      },
    },
    series: [
      {
        type: "bar",
        barWidth: 14,
        data: points.map((point) => point.value),
        itemStyle: {
          borderRadius: [0, 999, 999, 0],
          color: new graphic.LinearGradient(1, 0, 0, 0, [
            { offset: 0, color: "rgba(66, 217, 186, 0.95)" },
            { offset: 1, color: "rgba(126, 203, 255, 0.78)" },
          ]),
        },
      },
    ],
  };
}
