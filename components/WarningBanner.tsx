"use client";

import { useCallback, useEffect, useState } from "react";

interface Warning {
  id: string;
  event: string;
  headline: string;
  effective: string | null;
  expires: string | null;
  updated: string | null;
  capUrl: string | null;
}

interface WarningsResponse {
  success: boolean;
  count?: number;
  warnings?: Warning[];
  stale?: boolean;
  error?: string;
}

function eventClass(event: string): string {
  if (/高溫/.test(event)) return "bg-orange-500/25 text-orange-200";
  if (/雨|豪雨|大雨|降雨/.test(event)) return "bg-sky-500/25 text-sky-200";
  if (/風/.test(event)) return "bg-teal-500/25 text-teal-200";
  if (/雷/.test(event)) return "bg-amber-500/25 text-amber-200";
  if (/濃霧|霧/.test(event)) return "bg-slate-400/25 text-slate-100";
  return "bg-rose-500/25 text-rose-200";
}

function fmtExpires(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function WarningBanner() {
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [stale, setStale] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/warnings", { cache: "no-store" });
      const json = (await res.json()) as WarningsResponse;
      if (json.success) {
        setWarnings(json.warnings ?? []);
        setStale(Boolean(json.stale));
      }
    } catch {
      // 特報是輔助資訊，抓不到就靜默略過，不影響主地圖。
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 10 * 60 * 1000);
    return () => clearInterval(timer);
  }, [load]);

  // 尚未載入完成、或收合時不佔版面。
  if (!loaded) return null;

  const hasWarnings = warnings.length > 0;

  return (
    <div className="pointer-events-auto w-[min(92vw,560px)] rounded-lg bg-panel shadow-lg backdrop-blur">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <span>{hasWarnings ? "⚠️" : "✅"}</span>
          <span>
            天氣特報
            {hasWarnings && (
              <span className="ml-1 text-amber-300">{warnings.length} 則</span>
            )}
          </span>
          <span className="text-[10px] font-normal text-gray-400">
            來源：NCDR CAP 爬蟲 · 中央氣象署
          </span>
        </div>
        {hasWarnings && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 rounded bg-white/10 px-2 py-0.5 text-[11px] text-gray-200 hover:bg-white/20"
          >
            {open ? "收合" : "展開"}
          </button>
        )}
      </div>

      {!hasWarnings ? (
        <div className="px-3 pb-2.5 text-[11px] text-gray-400">
          {stale
            ? "特報來源暫時無法連線，顯示資料庫中的最後狀態。"
            : "目前全台無生效中的天氣特報。"}
        </div>
      ) : (
        open && (
          <div className="max-h-52 space-y-1.5 overflow-y-auto border-t border-white/10 px-3 py-2">
            {stale && (
              <div className="rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
                特報來源暫時無法連線，顯示資料庫中的最後狀態。
              </div>
            )}
            {warnings.map((w) => (
              <div key={w.id} className="rounded-md bg-white/5 px-2.5 py-1.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${eventClass(
                      w.event
                    )}`}
                  >
                    {w.event || "特報"}
                  </span>
                  {w.expires && (
                    <span className="text-[10px] text-gray-400">
                      有效至 {fmtExpires(w.expires)}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-gray-200">
                  {w.headline}
                </p>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
