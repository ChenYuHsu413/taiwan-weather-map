"use client";

import type { LayerKey } from "@/lib/types";
import {
  TEMP_STOPS,
  WIND_STOPS,
  HUMIDITY_STOPS,
  PRECIP_STOPS,
  type ScaleStop,
} from "@/lib/color-scale";

const WEATHER_LEGEND = [
  { icon: "☀️", label: "晴" },
  { icon: "⛅", label: "多雲" },
  { icon: "☁️", label: "陰" },
  { icon: "🌧️", label: "有雨" },
  { icon: "⛈️", label: "雷雨" },
  { icon: "🌫️", label: "霧/靄" },
];

/** 橫向漸層色階條：左側單位 + 漸層 + 邊界數字（精簡示意，不逐段列出）。 */
function GradientBar({ unit, stops }: { unit: string; stops: ScaleStop[] }) {
  const gradient = `linear-gradient(to right, ${stops
    .map((s) => s.color)
    .join(", ")})`;
  // 邊界值＝各段的上限（最後一段為 Infinity，略過）。
  const bounds = stops.slice(0, -1).map((s) => s.max);
  return (
    <div className="pointer-events-auto w-60 rounded-lg bg-panel p-2.5 shadow-lg backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs font-semibold text-gray-100">
          {unit}
        </span>
        <div className="flex-1">
          <div
            className="h-2.5 w-full rounded-full"
            style={{ background: gradient }}
          />
          <div className="mt-1 flex justify-between text-[9px] tabular-nums text-gray-400">
            {bounds.map((b) => (
              <span key={b}>{b}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WeatherLegend({ mode }: { mode: LayerKey }) {
  if (mode === "temperature") return <GradientBar unit="°C" stops={TEMP_STOPS} />;
  if (mode === "wind") return <GradientBar unit="m/s" stops={WIND_STOPS} />;
  if (mode === "humidity") return <GradientBar unit="%" stops={HUMIDITY_STOPS} />;
  if (mode === "precipitation")
    return <GradientBar unit="mm" stops={PRECIP_STOPS} />;

  if (mode === "radar") {
    return (
      <div className="pointer-events-auto w-60 rounded-lg bg-panel p-2.5 shadow-lg backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs font-semibold text-gray-100">
            雷達
          </span>
          <div className="flex-1">
            <div className="h-2.5 w-full rounded-full bg-gradient-to-r from-sky-400 via-lime-400 via-yellow-400 to-red-500" />
            <div className="mt-1 flex justify-between text-[9px] text-gray-400">
              <span>弱</span>
              <span>回波強度</span>
              <span>強</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "typhoon") {
    return (
      <div className="pointer-events-auto w-60 rounded-lg bg-panel p-2.5 text-xs text-gray-300 shadow-lg backdrop-blur">
        <div className="mb-1.5 font-semibold text-gray-100">颱風路徑</div>
        <div className="flex items-center gap-2">
          <span className="h-0.5 w-6 shrink-0 bg-slate-300" />
          <span>過去路徑</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span
            className="h-0.5 w-6 shrink-0"
            style={{
              backgroundImage:
                "repeating-linear-gradient(to right, currentColor 0 6px, transparent 6px 13px)",
            }}
          />
          <span>官方預報路徑（色隨強度）</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="h-3 w-6 shrink-0 rounded border border-rose-400/70 bg-rose-500/15" />
          <span>預報不確定錐（70%）</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="relative h-3 w-3 shrink-0 rounded-full border border-amber-400 bg-amber-400/15">
            <span className="absolute inset-[3px] rounded-full border border-red-500 bg-red-500/25" />
          </span>
          <span>暴風圈：七級（外）／十級（內）</span>
        </div>
        <div className="mt-1.5 mb-0.5 text-[11px] font-medium text-gray-400">
          強度分級
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {[
            ["熱帶低壓", "#38bdf8"],
            ["輕度", "#facc15"],
            ["中度", "#fb923c"],
            ["強烈", "#f43f5e"],
          ].map(([label, c]) => (
            <span key={label} className="flex items-center gap-1">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: c }}
              />
              <span>{label}</span>
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (mode === "weather") {
    return (
      <div className="pointer-events-auto rounded-lg bg-panel p-2.5 shadow-lg backdrop-blur">
        <div className="grid grid-cols-3 gap-x-3 gap-y-1">
          {WEATHER_LEGEND.map((it) => (
            <div key={it.label} className="flex items-center gap-1.5">
              <span className="text-sm">{it.icon}</span>
              <span className="text-xs text-gray-300">{it.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}
