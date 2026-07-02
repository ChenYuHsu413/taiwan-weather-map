// 從清洗後的 GeoJSON 計算全台摘要統計。

import type {
  WeatherFeatureCollection,
  WeatherSummary,
  SummaryExtreme,
} from "./types";

type Metric = "temperature" | "precipitation" | "windSpeed";

function findExtreme(
  fc: WeatherFeatureCollection,
  metric: Metric,
  mode: "max" | "min"
): SummaryExtreme | null {
  let best: SummaryExtreme | null = null;
  for (const f of fc.features) {
    const value = f.properties[metric];
    if (value === null) continue;
    if (
      best === null ||
      (mode === "max" && value > best.value) ||
      (mode === "min" && value < best.value)
    ) {
      best = { stationName: f.properties.stationName, value };
    }
  }
  return best;
}

export function buildSummary(fc: WeatherFeatureCollection): WeatherSummary {
  return {
    maxTemperature: findExtreme(fc, "temperature", "max"),
    minTemperature: findExtreme(fc, "temperature", "min"),
    maxPrecipitation: findExtreme(fc, "precipitation", "max"),
    maxWindSpeed: findExtreme(fc, "windSpeed", "max"),
  };
}
