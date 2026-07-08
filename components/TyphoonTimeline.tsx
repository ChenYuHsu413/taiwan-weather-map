"use client";

import { categorize, sampleAt, type TyTimeline } from "@/lib/typhoonFrames";

interface Props {
  timeline: TyTimeline;
  time: number; // 目前顯示時刻（unix ms）
  playing: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
}

const fmtDay = (t: number) =>
  new Date(t).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" });
const fmtHour = (t: number) => `${String(new Date(t).getHours()).padStart(2, "0")}時`;
const pos = (t: number, min: number, max: number) =>
  max > min ? ((t - min) / (max - min)) * 100 : 0;

/**
 * 颱風時間軸控制列：播放鈕 + 連續時間滑桿（各報刻度 + 「現在」分界）+
 * 目前顯示時刻與強度讀數。播放時颱風中心會沿路徑平滑移動。
 */
export default function TyphoonTimeline({
  timeline,
  time,
  playing,
  onTogglePlay,
  onSeek,
}: Props) {
  const { tMin, tMax, tCurrent, ticks, tracks } = timeline;
  const step = Math.max(60_000, Math.round((tMax - tMin) / 1000));

  // 以主颱風（第一條軌跡）取樣目前狀態做讀數。
  const primary = tracks[0];
  const s = sampleAt(primary.moments, time);
  const isForecast = time > tCurrent + 1000;
  const category = categorize(s?.maxWind ?? null);

  const fillPct = pos(time, tMin, tMax);
  const nowPct = pos(tCurrent, tMin, tMax);

  return (
    <div className="pointer-events-auto absolute bottom-[132px] left-1/2 z-[900] flex w-[min(92vw,480px)] -translate-x-1/2 items-center gap-3.5 rounded-xl bg-panel px-4 py-3 shadow-lg backdrop-blur md:bottom-8">
      <button
        onClick={onTogglePlay}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-rose-500 text-white shadow-md transition hover:bg-rose-400 active:scale-95"
        aria-label={playing ? "暫停" : "播放"}
      >
        {playing ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <rect x="3" y="2.5" width="3.5" height="11" rx="1" />
            <rect x="9.5" y="2.5" width="3.5" height="11" rx="1" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 2.6c0-.8.86-1.3 1.55-.9l8 5.4c.64.43.64 1.37 0 1.8l-8 5.4c-.7.4-1.55-.1-1.55-.9V2.6Z" />
          </svg>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center justify-between text-[11px] text-gray-400">
          <span className="flex items-center gap-1.5 font-medium text-gray-200">
            <span className="text-sm">🌀</span>
            {primary.name}
            {category && <span className="text-rose-300">{category}</span>}
          </span>
          <span
            className={`rounded px-1.5 py-px text-[10px] font-semibold ${
              isForecast
                ? "bg-rose-500/20 text-rose-200"
                : "bg-sky-500/20 text-sky-200"
            }`}
          >
            {isForecast ? "預報" : "實測"}
          </span>
        </div>

        {/* 進度軌：底軌 + 預報段染色 + 已行經填色 + 各報刻度 + 現在分界 + range */}
        <div className="relative flex h-5 items-center">
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/12" />
          <div
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-r-full bg-rose-500/25"
            style={{ left: `${nowPct}%`, right: 0 }}
          />
          <div
            className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-sky-400 to-rose-400"
            style={{ width: `${fillPct}%` }}
          />
          {ticks.map((tk, i) => (
            <span
              key={i}
              className="absolute top-1/2 h-1.5 w-px -translate-x-1/2 -translate-y-1/2 bg-white/30"
              style={{ left: `${pos(tk, tMin, tMax)}%` }}
            />
          ))}
          {/* 現在分界線 */}
          <span
            className="pointer-events-none absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-amber-300"
            style={{ left: `${nowPct}%` }}
          />
          <input
            type="range"
            min={tMin}
            max={tMax}
            step={step}
            value={time}
            onChange={(e) => onSeek(Number(e.target.value))}
            className="radar-range absolute inset-0 w-full"
            aria-label="颱風預報時刻"
          />
        </div>

        <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
          <span>{fmtDay(tMin)}</span>
          <span className="text-amber-300">現在</span>
          <span>{fmtDay(tMax)}</span>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="text-[11px] leading-none text-gray-400">{fmtDay(time)}</div>
        <div className="mt-0.5 font-mono text-base font-semibold tabular-nums leading-none text-gray-100">
          {fmtHour(time)}
        </div>
        {s && (
          <div className="mt-1 text-[11px] text-gray-400 tabular-nums">
            {s.maxWind !== null ? `${Math.round(s.maxWind)} m/s` : ""}
            {s.pressure !== null ? ` · ${Math.round(s.pressure)} hPa` : ""}
          </div>
        )}
      </div>
    </div>
  );
}
