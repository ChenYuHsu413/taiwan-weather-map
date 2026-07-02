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

const WEATHER_LEGEND = [
  { icon: "☀️", label: "晴" },
  { icon: "⛅", label: "多雲" },
  { icon: "☁️", label: "陰" },
  { icon: "🌧️", label: "有雨" },
  { icon: "⛈️", label: "雷雨" },
  { icon: "🌫️", label: "霧/靄" },
];

export default function WeatherLegend({ mode }: { mode: LayerKey }) {
  if (mode === "weather") {
    return (
      <div className="pointer-events-auto rounded-lg bg-panel p-3 shadow-lg backdrop-blur">
        <div className="mb-2 text-xs font-semibold text-gray-100">
          天氣（各縣市代表）
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {WEATHER_LEGEND.map((it) => (
            <div key={it.label} className="flex items-center gap-2">
              <span className="text-sm">{it.icon}</span>
              <span className="text-xs text-gray-300">{it.label}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 border-t border-white/10 pt-2 text-[10px] text-gray-400">
          取各縣市多數測站的天氣現象
        </div>
      </div>
    );
  }

  if (mode === "forecast") {
    return (
      <div className="pointer-events-auto rounded-lg bg-panel p-3 shadow-lg backdrop-blur">
        <div className="mb-2 text-xs font-semibold text-gray-100">
          今明天氣預報
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {WEATHER_LEGEND.map((it) => (
            <div key={it.label} className="flex items-center gap-2">
              <span className="text-sm">{it.icon}</span>
              <span className="text-xs text-gray-300">{it.label}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 border-t border-white/10 pt-2 text-[10px] text-gray-400">
          徽章：天氣 + 高溫 · 💧降雨機率；點縣市看今明 36 小時
        </div>
      </div>
    );
  }

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
          填色為內插後的雨量分布
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
