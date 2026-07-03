"use client";

import { useState } from "react";
import type { LayerKey, WeatherApiResponse } from "@/lib/types";
import { MODES } from "@/components/WeatherLayerControl";
import WeatherSummaryPanel from "@/components/WeatherSummaryPanel";
import WeatherLegend from "@/components/WeatherLegend";

interface Props {
  meta: WeatherApiResponse;
  mode: LayerKey;
  onModeChange: (m: LayerKey) => void;
  basemap: "dark" | "osm";
  onBasemapChange: (b: "dark" | "osm") => void;
  showCounties: boolean;
  onToggleCounties: (v: boolean) => void;
  showWindStations: boolean;
  onToggleWindStations: (v: boolean) => void;
  showTempLabels: boolean;
  onToggleTempLabels: (v: boolean) => void;
  onLocate: () => void;
  locating: boolean;
  locateMsg: string | null;
  userLocation: { lat: number; lng: number } | null;
  onRefresh: () => void;
}

// 手機版控制層：桌機（md 以上）完全不顯示，改由 page.tsx 的原四角面板負責。
// 設計原則：地圖優先，控制項收進底部列與可召喚的 bottom sheet。
export default function MobileControls({
  meta,
  mode,
  onModeChange,
  basemap,
  onBasemapChange,
  showCounties,
  onToggleCounties,
  showWindStations,
  onToggleWindStations,
  showTempLabels,
  onToggleTempLabels,
  onLocate,
  locating,
  locateMsg,
  userLocation,
  onRefresh,
}: Props) {
  const [sheet, setSheet] = useState<null | "summary" | "settings">(null);
  const close = () => setSheet(null);

  return (
    <div className="md:hidden">
      {/* 底部控制列：圖層 pills + 工具列 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[900] flex flex-col gap-2 px-3 pb-6">
        {/* 工具列：更新時間、摘要、設定 */}
        <div className="pointer-events-auto flex items-center justify-between gap-2">
          <button
            onClick={onRefresh}
            className="rounded-full bg-panel px-3 py-1.5 text-[11px] text-gray-200 shadow-lg backdrop-blur"
          >
            ↻{" "}
            {new Date(meta.updatedAt).toLocaleTimeString("zh-TW", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}
          </button>
          <div className="flex items-center gap-2">
            <SquareBtn label="摘要" onClick={() => setSheet("summary")}>
              ℹ️
            </SquareBtn>
            <SquareBtn label="設定" onClick={() => setSheet("settings")}>
              ⚙️
            </SquareBtn>
          </div>
        </div>

        {/* 色階條（常駐，跟著目前圖層變化） */}
        <div className="pointer-events-auto flex justify-center">
          <WeatherLegend mode={mode} />
        </div>

        {/* 圖層切換：橫向可滑 pills */}
        <div className="pointer-events-auto flex gap-2 overflow-x-auto rounded-xl bg-panel p-1.5 shadow-lg backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => onModeChange(m.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition ${
                mode === m.key
                  ? "bg-sky-500/90 text-white"
                  : "bg-white/5 text-gray-200"
              }`}
            >
              <span>{m.icon}</span>
              <span className="whitespace-nowrap">{m.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 摘要 sheet */}
      {sheet === "summary" && (
        <Backdrop onClose={close}>
          <div
            className="relative mb-4"
            onClick={(e) => e.stopPropagation()}
          >
            <WeatherSummaryPanel meta={meta} />
            <CloseX onClick={close} />
          </div>
        </Backdrop>
      )}

      {/* 設定 sheet：底圖、圖層開關、定位 */}
      {sheet === "settings" && (
        <Backdrop onClose={close}>
          <div
            className="relative w-full max-w-md rounded-t-2xl bg-panel p-4 pb-8 shadow-2xl backdrop-blur"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">地圖設定</h2>
              <button
                onClick={close}
                className="rounded-md bg-white/10 px-2.5 py-1 text-xs text-gray-200"
              >
                關閉
              </button>
            </div>

            <ToggleRow
              checked={showCounties}
              onChange={onToggleCounties}
              label="縣市界線"
            />
            {mode === "wind" && (
              <ToggleRow
                checked={showWindStations}
                onChange={onToggleWindStations}
                label="風場測站箭頭"
              />
            )}
            {mode === "temperature" && (
              <ToggleRow
                checked={showTempLabels}
                onChange={onToggleTempLabels}
                label="氣溫數字標籤"
              />
            )}

            <div className="mt-3 border-t border-white/10 pt-3">
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                底圖
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { key: "dark", label: "深色" },
                    { key: "osm", label: "街道圖" },
                  ] as const
                ).map((b) => (
                  <button
                    key={b.key}
                    onClick={() => onBasemapChange(b.key)}
                    className={`rounded-md px-3 py-2 text-sm transition ${
                      basemap === b.key
                        ? "bg-sky-500/90 text-white"
                        : "bg-white/5 text-gray-200"
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
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600/90 px-3 py-2.5 text-sm text-white transition disabled:opacity-60"
            >
              {locating ? "定位中…" : "📌 定位我的位置"}
            </button>
            {locateMsg && !userLocation && (
              <div className="mt-2 rounded-md bg-amber-500/20 px-3 py-2 text-xs text-amber-200">
                {locateMsg}
              </div>
            )}
          </div>
        </Backdrop>
      )}
    </div>
  );
}

function SquareBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-10 w-10 items-center justify-center rounded-full bg-panel text-lg shadow-lg backdrop-blur"
    >
      {children}
    </button>
  );
}

function ToggleRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-md bg-white/5 px-3 py-2.5 text-sm text-gray-200">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-sky-500"
      />
      {label}
    </label>
  );
}

// 底部對齊的半透明遮罩，點擊空白處關閉。
function Backdrop({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[1100] flex items-end justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative w-full flex justify-center">{children}</div>
    </div>
  );
}

function CloseX({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="關閉"
      className="absolute -top-3 -right-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-gray-100 shadow-lg backdrop-blur"
    >
      ✕
    </button>
  );
}
