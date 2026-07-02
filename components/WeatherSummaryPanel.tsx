"use client";

import type { WeatherApiResponse } from "@/lib/types";

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function Stat({
  label,
  station,
  value,
  unit,
}: {
  label: string;
  station?: string;
  value?: number | null;
  unit: string;
}) {
  return (
    <div className="rounded-md bg-white/5 px-3 py-2">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="text-lg font-semibold text-gray-100">
        {value === null || value === undefined ? "—" : value}
        <span className="ml-1 text-xs font-normal text-gray-400">{unit}</span>
      </div>
      <div className="truncate text-[11px] text-gray-400">{station ?? "—"}</div>
    </div>
  );
}

export default function WeatherSummaryPanel({
  meta,
}: {
  meta: WeatherApiResponse;
}) {
  const s = meta.summary;
  return (
    <div className="pointer-events-auto w-72 rounded-lg bg-panel p-4 shadow-lg backdrop-blur">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-bold text-white">台灣即時氣象</h1>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] ${
            meta.stale
              ? "bg-amber-500/20 text-amber-300"
              : meta.cached
              ? "bg-sky-500/20 text-sky-300"
              : "bg-emerald-500/20 text-emerald-300"
          }`}
        >
          {meta.stale ? "舊快取" : meta.cached ? "快取" : "即時"}
        </span>
      </div>

      <div className="mt-1 space-y-0.5 text-[11px] text-gray-400">
        <div>
          觀測時間：
          <span className="text-gray-200">{fmtTime(meta.updatedAt)}</span>
        </div>
        <div>
          資料來源：<span className="text-gray-200">{meta.source}</span>
        </div>
        <div>
          測站數量：
          <span className="text-gray-200">{meta.stationCount}</span> 站
        </div>
      </div>

      {meta.stale && (
        <div className="mt-2 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
          ⚠️ 外部 API 暫時無法連線，顯示先前快取資料。
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Stat
          label="最高溫"
          station={s.maxTemperature?.stationName}
          value={s.maxTemperature?.value}
          unit="°C"
        />
        <Stat
          label="最低溫"
          station={s.minTemperature?.stationName}
          value={s.minTemperature?.value}
          unit="°C"
        />
        <Stat
          label="最大雨量"
          station={s.maxPrecipitation?.stationName}
          value={s.maxPrecipitation?.value}
          unit="mm"
        />
        <Stat
          label="最大風速"
          station={s.maxWindSpeed?.stationName}
          value={s.maxWindSpeed?.value}
          unit="m/s"
        />
      </div>
    </div>
  );
}
