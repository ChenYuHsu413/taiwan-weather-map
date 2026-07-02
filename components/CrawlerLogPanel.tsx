"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface CrawlerLog {
  id: number;
  sourceName: string;
  sourceUrl: string;
  fetchedAt: string;
  status: "success" | "failed" | "cache_hit" | "stale";
  httpStatus: number | null;
  contentType: string | null;
  fileSize: number | null;
  fromCache: boolean;
  stale: boolean;
  durationMs: number | null;
  errorMessage: string | null;
}

interface CrawlerLogsResponse {
  success: boolean;
  logs?: CrawlerLog[];
  error?: string;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function fmtSize(bytes: number | null): string {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function statusLabel(status: CrawlerLog["status"]): string {
  switch (status) {
    case "success":
      return "成功";
    case "cache_hit":
      return "快取";
    case "stale":
      return "舊快取";
    case "failed":
      return "失敗";
  }
}

function statusClass(status: CrawlerLog["status"]): string {
  switch (status) {
    case "success":
      return "bg-emerald-500/20 text-emerald-300";
    case "cache_hit":
      return "bg-sky-500/20 text-sky-300";
    case "stale":
      return "bg-amber-500/20 text-amber-300";
    case "failed":
      return "bg-rose-500/20 text-rose-300";
  }
}

export default function CrawlerLogPanel() {
  const [logs, setLogs] = useState<CrawlerLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latest = logs[0] ?? null;
  const latestDetail = useMemo(() => {
    if (!latest) return "尚無紀錄";
    return `${fmtSize(latest.fileSize)} · ${
      latest.httpStatus ? `HTTP ${latest.httpStatus}` : "no HTTP"
    }`;
  }, [latest]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/crawler/logs?limit=5", {
        cache: "no-store",
      });
      const json = (await res.json()) as CrawlerLogsResponse;
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setLogs(json.logs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "讀取爬蟲紀錄失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  const runCrawler = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/radar", { cache: "no-store" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      await res.blob();
      await loadLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "執行爬蟲失敗");
      await loadLogs();
    } finally {
      setRunning(false);
    }
  }, [loadLogs]);

  useEffect(() => {
    loadLogs();
    const timer = setInterval(loadLogs, 60000);
    return () => clearInterval(timer);
  }, [loadLogs]);

  return (
    <div className="pointer-events-auto w-72 rounded-lg bg-panel p-4 shadow-lg backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            CWA 爬蟲紀錄
          </div>
          <div className="mt-1 text-sm font-semibold text-white">
            雷達回波網站圖資
          </div>
        </div>
        {latest && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${statusClass(
              latest.status
            )}`}
          >
            {statusLabel(latest.status)}
          </span>
        )}
      </div>

      <div className="mt-2 space-y-1 text-[11px] text-gray-400">
        <div>
          來源：<span className="text-gray-200">cwa.gov.tw/Data/radar</span>
        </div>
        <div>
          最近抓取：
          <span className="text-gray-200">
            {latest ? fmtTime(latest.fetchedAt) : "-"}
          </span>
        </div>
        <div>
          結果：<span className="text-gray-200">{latestDetail}</span>
        </div>
      </div>

      {error && (
        <div className="mt-2 rounded-md bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300">
          {error}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={runCrawler}
          disabled={running}
          className="flex-1 rounded-md bg-sky-600/90 px-3 py-1.5 text-xs text-white hover:bg-sky-600 disabled:opacity-60"
        >
          {running ? "執行中" : "執行爬蟲"}
        </button>
        <button
          onClick={loadLogs}
          disabled={loading}
          className="rounded-md bg-white/10 px-3 py-1.5 text-xs text-gray-200 hover:bg-white/20 disabled:opacity-60"
        >
          更新
        </button>
      </div>

      {logs.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-white/10 pt-2">
          {logs.slice(0, 3).map((log) => (
            <div
              key={log.id}
              className="flex items-center justify-between gap-2 text-[11px]"
            >
              <span className="truncate text-gray-400">
                {fmtTime(log.fetchedAt)}
              </span>
              <span className={statusClass(log.status).replace("/20", "/0")}>
                {statusLabel(log.status)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
