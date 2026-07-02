"use client";

import type { StationProperties } from "@/lib/types";

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

function Row({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | string | null;
  unit?: string;
}) {
  return (
    <div className="flex justify-between gap-4 text-xs">
      <span className="text-gray-400">{label}</span>
      <span className="font-medium text-gray-100">
        {value === null || value === undefined || value === ""
          ? "—"
          : `${value}${unit ?? ""}`}
      </span>
    </div>
  );
}

export default function WeatherStationPopup({ p }: { p: StationProperties }) {
  return (
    <div className="min-w-[190px] space-y-1.5">
      <div>
        <div className="text-sm font-bold text-white">{p.stationName}</div>
        <div className="text-[11px] text-gray-400">
          {[p.county, p.town].filter(Boolean).join(" / ") || "—"}
        </div>
        <div className="text-[11px] text-gray-500">
          觀測 {fmtTime(p.observedAt)}
        </div>
      </div>
      <div className="space-y-1 border-t border-white/10 pt-1.5">
        <Row label="氣溫" value={p.temperature} unit=" °C" />
        <Row label="相對濕度" value={p.humidity} unit=" %" />
        <Row label="測站氣壓" value={p.pressure} unit=" hPa" />
        <Row label="風速" value={p.windSpeed} unit=" m/s" />
        <Row label="風向" value={p.windDirection} unit="°" />
        <Row label="最大瞬間風" value={p.gustSpeed} unit=" m/s" />
        <Row label="雨量" value={p.precipitation} unit=" mm" />
        {p.uvi !== null && <Row label="紫外線指數" value={p.uvi} />}
        {p.weather && <Row label="天氣現象" value={p.weather} />}
      </div>
    </div>
  );
}
