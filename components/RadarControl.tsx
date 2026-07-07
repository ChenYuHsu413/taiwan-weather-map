"use client";

interface RadarFrameMeta {
  time: number; // unix 秒
  path: string;
}

interface Props {
  frames: RadarFrameMeta[];
  idx: number;
  playing: boolean;
  onTogglePlay: () => void;
  onSeek: (idx: number) => void;
}

/**
 * 雷達回波動畫的時間軸控制列：圓形播放鈕 + 帶影格刻度的進度軌 + 相對時間。
 */
export default function RadarControl({
  frames,
  idx,
  playing,
  onTogglePlay,
  onSeek,
}: Props) {
  const last = frames.length - 1;
  const cur = frames[idx];
  const pct = last > 0 ? (idx / last) * 100 : 0;

  const clock = new Date(cur.time * 1000).toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  // 相對最新影格的時間差（分鐘）。最新為「現在」。
  const minsAgo = Math.round((frames[last].time - cur.time) / 60);
  const relative = minsAgo <= 0 ? "現在" : `−${minsAgo} 分`;

  return (
    <div className="absolute bottom-[132px] left-1/2 z-[900] flex w-[min(92vw,440px)] -translate-x-1/2 items-center gap-3.5 rounded-xl bg-panel px-4 py-3 shadow-lg backdrop-blur md:bottom-20">
      <button
        onClick={onTogglePlay}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sky-500 text-white shadow-md transition hover:bg-sky-400 active:scale-95"
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
            <span className="text-sm">🛰️</span> 雷達回波
          </span>
          <span className="tabular-nums">
            {idx + 1}/{frames.length}
          </span>
        </div>

        {/* 進度軌：底軌 + 進度填色 + 影格刻度 + 原生 range（透明軌、可拖曳） */}
        <div className="relative flex h-5 items-center">
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/12" />
          <div
            className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-sky-500 to-sky-300"
            style={{ width: `${pct}%` }}
          />
          {frames.map((f, i) => (
            <span
              key={f.path}
              className="absolute top-1/2 h-1.5 w-px -translate-x-1/2 -translate-y-1/2 bg-white/25"
              style={{ left: `${last > 0 ? (i / last) * 100 : 0}%` }}
            />
          ))}
          <input
            type="range"
            min={0}
            max={last}
            value={idx}
            onChange={(e) => onSeek(Number(e.target.value))}
            className="radar-range absolute inset-0 w-full"
            aria-label="雷達影格時間"
          />
        </div>

        <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
          <span>2 小時前</span>
          <span>現在</span>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="font-mono text-base font-semibold tabular-nums leading-none text-gray-100">
          {clock}
        </div>
        <div
          className={`mt-1 text-[11px] ${
            minsAgo <= 0 ? "text-sky-300" : "text-gray-400"
          }`}
        >
          {relative}
        </div>
      </div>
    </div>
  );
}
