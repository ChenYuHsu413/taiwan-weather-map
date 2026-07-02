"use client";

import type { LayerKey } from "@/lib/types";
import {
  TEMP_STOPS,
  WIND_STOPS,
  HUMIDITY_STOPS,
  PRECIP_STOPS,
} from "@/lib/color-scale";

function StopRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-block h-3 w-3 rounded-sm"
        style={{ backgroundColor: color }}
      />
      <span className="text-xs text-gray-300">{label}</span>
    </div>
  );
}

export default function WeatherLegend({ mode }: { mode: LayerKey }) {
  let title = "";
  let stops: { color: string; label: string }[] = [];

  if (mode === "temperature") {
    title = "氣溫 (°C)";
    stops = TEMP_STOPS;
  } else if (mode === "wind") {
    title = "風速 (m/s)";
    stops = WIND_STOPS;
  } else if (mode === "humidity") {
    title = "相對濕度 (%)";
    stops = HUMIDITY_STOPS;
  } else if (mode === "precipitation") {
    title = "雨量 (mm)";
    stops = PRECIP_STOPS;
  } else {
    return null;
  }

  return (
    <div className="pointer-events-auto rounded-lg bg-panel p-3 shadow-lg backdrop-blur">
      <div className="mb-2 text-xs font-semibold text-gray-100">{title}</div>
      <div className="grid grid-cols-1 gap-1">
        {stops.map((s) => (
          <StopRow key={s.label} color={s.color} label={s.label} />
        ))}
      </div>
      {mode === "precipitation" && (
        <div className="mt-2 border-t border-white/10 pt-2 text-[10px] text-gray-400">
          填色為內插後的雨量分布，小點為測站位置
        </div>
      )}
      {mode === "wind" && (
        <div className="mt-2 border-t border-white/10 pt-2 text-[10px] text-gray-400">
          箭頭指向風的<span className="text-gray-200">去向</span>，顏色代表風速
        </div>
      )}
    </div>
  );
}
