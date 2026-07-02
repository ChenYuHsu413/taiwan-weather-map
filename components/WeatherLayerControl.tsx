"use client";

import type { LayerKey } from "@/lib/types";

const MODES: { key: LayerKey; label: string; icon: string }[] = [
  { key: "temperature", label: "氣溫", icon: "🌡️" },
  { key: "precipitation", label: "雨量", icon: "🌧️" },
  { key: "wind", label: "風速風向", icon: "💨" },
  { key: "humidity", label: "濕度", icon: "💧" },
  { key: "stations", label: "測站點位", icon: "📍" },
];

interface Props {
  mode: LayerKey;
  onModeChange: (m: LayerKey) => void;
  basemap: "dark" | "osm";
  onBasemapChange: (b: "dark" | "osm") => void;
  showCounties: boolean;
  onToggleCounties: (v: boolean) => void;
  showWindStations: boolean;
  onToggleWindStations: (v: boolean) => void;
  showRadar: boolean;
  onToggleRadar: (v: boolean) => void;
  onLocate: () => void;
  locating: boolean;
}

export default function WeatherLayerControl({
  mode,
  onModeChange,
  basemap,
  onBasemapChange,
  showCounties,
  onToggleCounties,
  showWindStations,
  onToggleWindStations,
  showRadar,
  onToggleRadar,
  onLocate,
  locating,
}: Props) {
  return (
    <div className="pointer-events-auto w-56 rounded-lg bg-panel p-3 shadow-lg backdrop-blur">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
        圖層
      </div>
      <div className="grid grid-cols-1 gap-1">
        {MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => onModeChange(m.key)}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition ${
              mode === m.key
                ? "bg-sky-500/90 text-white"
                : "bg-white/5 text-gray-200 hover:bg-white/10"
            }`}
          >
            <span>{m.icon}</span>
            <span>{m.label}</span>
          </button>
        ))}
      </div>

      <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-md bg-white/5 px-3 py-2 text-sm text-gray-200 hover:bg-white/10">
        <input
          type="checkbox"
          checked={showCounties}
          onChange={(e) => onToggleCounties(e.target.checked)}
          className="accent-sky-500"
        />
        縣市界線
      </label>

      {mode === "wind" && (
        <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-md bg-white/5 px-3 py-2 text-sm text-gray-200 hover:bg-white/10">
          <input
            type="checkbox"
            checked={showWindStations}
            onChange={(e) => onToggleWindStations(e.target.checked)}
            className="accent-sky-500"
          />
          風場測站箭頭
        </label>
      )}

      <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-md bg-white/5 px-3 py-2 text-sm text-gray-200 hover:bg-white/10">
        <input
          type="checkbox"
          checked={showRadar}
          onChange={(e) => onToggleRadar(e.target.checked)}
          className="accent-sky-500"
        />
        🛰️ 雷達回波
      </label>

      <div className="mt-3 border-t border-white/10 pt-3">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
          底圖
        </div>
        <div className="grid grid-cols-2 gap-1">
          {(
            [
              { key: "dark", label: "深色" },
              { key: "osm", label: "街道圖" },
            ] as const
          ).map((b) => (
            <button
              key={b.key}
              onClick={() => onBasemapChange(b.key)}
              className={`rounded-md px-3 py-1.5 text-sm transition ${
                basemap === b.key
                  ? "bg-sky-500/90 text-white"
                  : "bg-white/5 text-gray-200 hover:bg-white/10"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={onLocate}
        disabled={locating}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600/90 px-3 py-2 text-sm text-white transition hover:bg-emerald-600 disabled:opacity-60"
      >
        {locating ? "定位中…" : "📌 定位我的位置"}
      </button>
    </div>
  );
}
