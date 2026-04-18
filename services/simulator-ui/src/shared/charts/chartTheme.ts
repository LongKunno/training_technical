export const chartTheme = {
  axisLabel: "#8ba2b8",
  axisLine: "rgba(139, 162, 184, 0.18)",
  axisSplit: "rgba(139, 162, 184, 0.12)",
  gridLine: "rgba(255, 255, 255, 0.06)",
  surface: "rgba(255, 255, 255, 0.03)",
  palette: ["#7ecbff", "#42d9ba", "#f4be51", "#ff8b7a", "#8ba2ff"],
  emphasis: "#eef6ff",
};

interface GradientStop {
  offset: number;
  color: string;
}

export interface LinearGradientToken {
  type: "linear";
  x: number;
  y: number;
  x2: number;
  y2: number;
  colorStops: GradientStop[];
  global: false;
}

export function createLinearGradient(
  x: number,
  y: number,
  x2: number,
  y2: number,
  colorStops: GradientStop[],
): LinearGradientToken {
  return {
    colorStops,
    global: false,
    type: "linear",
    x,
    x2,
    y,
    y2,
  };
}
