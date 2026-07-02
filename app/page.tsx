"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { LayerKey, WeatherApiResponse } from "@/lib/types";
import WeatherLayerControl from "@/components/WeatherLayerControl";
import WeatherSummaryPanel from "@/components/WeatherSummaryPanel";
import WeatherLegend from "@/components/WeatherLegend";

// Leaflet 依賴 window，需關閉 SSR。
const WeatherMap = dynamic(() => import("@/components/WeatherMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-gray-400">
      地圖載入中…
    </div>
  ),
});

interface UserLoc {
  lat: number;
  lng: number;
}

export default function Home() {
  const [meta, setMeta] = useState<WeatherApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<LayerKey>("temperature");
  const [basemap, setBasemap] = useState<"dark" | "osm">("dark");
  const [showCounties, setShowCounties] = useState(true);
  const [showRadar, setShowRadar] = useState(false);

  // 雷達動畫
  const [radarData, setRadarData] = useState<{
    host: string;
    frames: { time: number; path: string }[];
  } | null>(null);
  const [radarIdx, setRadarIdx] = useState(0);
  const [radarPlaying, setRadarPlaying] = useState(false);

  const [userLocation, setUserLocation] = useState<UserLoc | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateMsg, setLocateMsg] = useState<string | null>(null);

  const loadWeather = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/weather/current");
      const json = (await res.json()) as WeatherApiResponse;
      if (!res.ok || !json.success) {
        throw new Error(json.error || `伺服器回應 ${res.status}`);
      }
      setMeta(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWeather();
  }, [loadWeather]);

  // 開啟雷達時抓取影格清單（過去約 2 小時、每 10 分鐘一張）。
  useEffect(() => {
    if (!showRadar) return;
    let cancelled = false;
    fetch("https://api.rainviewer.com/public/weather-maps.json")
      .then((r) => r.json())
      .then((j) => {
        const past: { time: number; path: string }[] = j?.radar?.past ?? [];
        if (!cancelled && j.host && past.length) {
          setRadarData({ host: j.host, frames: past });
          setRadarIdx(past.length - 1); // 停在最新一張，預設不播放
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showRadar]);

  // 播放：循環切換影格。
  useEffect(() => {
    if (!showRadar || !radarPlaying || !radarData) return;
    const frameCount = radarData.frames.length;
    const timer = setInterval(() => {
      setRadarIdx((i) => (i + 1) % frameCount);
    }, 600);
    return () => clearInterval(timer);
  }, [showRadar, radarPlaying, radarData]);

  const handleLocate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setLocateMsg("此瀏覽器不支援定位功能");
      return;
    }
    setLocating(true);
    setLocateMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setLocateMsg(null);
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setLocateMsg(
          err.code === err.PERMISSION_DENIED
            ? "已拒絕定位權限，可於瀏覽器設定開啟"
            : "無法取得您的位置"
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      {/* 地圖層 */}
      <div className="absolute inset-0">
        {meta && (
          <WeatherMap
            data={meta.data}
            mode={mode}
            basemap={basemap}
            showCounties={showCounties}
            radar={
              showRadar && radarData
                ? {
                    host: radarData.host,
                    frames: radarData.frames,
                    idx: radarIdx,
                  }
                : null
            }
            userLocation={userLocation}
          />
        )}
      </div>

      {/* 載入 / 錯誤覆蓋層 */}
      {loading && (
        <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-gray-950/70">
          <div className="rounded-lg bg-panel px-6 py-4 text-gray-200 shadow-lg">
            正在取得中央氣象署即時資料…
          </div>
        </div>
      )}
      {error && !loading && (
        <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-gray-950/70">
          <div className="max-w-sm rounded-lg bg-panel px-6 py-5 text-center shadow-lg">
            <div className="mb-2 text-2xl">⚠️</div>
            <div className="mb-1 font-semibold text-gray-100">
              無法載入氣象資料
            </div>
            <div className="mb-4 text-sm text-gray-400">{error}</div>
            <button
              onClick={loadWeather}
              className="rounded-md bg-sky-600 px-4 py-2 text-sm text-white hover:bg-sky-500"
            >
              重新載入
            </button>
          </div>
        </div>
      )}

      {/* 左上：摘要面板 */}
      {meta && (
        <div className="absolute left-4 top-4 z-[900]">
          <WeatherSummaryPanel meta={meta} />
        </div>
      )}

      {/* 右上：圖層控制 */}
      <div className="absolute right-4 top-4 z-[900] flex flex-col items-end gap-3">
        <WeatherLayerControl
          mode={mode}
          onModeChange={setMode}
          basemap={basemap}
          onBasemapChange={setBasemap}
          showCounties={showCounties}
          onToggleCounties={setShowCounties}
          showRadar={showRadar}
          onToggleRadar={setShowRadar}
          onLocate={handleLocate}
          locating={locating}
        />
        {locateMsg && !userLocation && (
          <div className="pointer-events-auto max-w-[224px] rounded-md bg-amber-500/20 px-3 py-2 text-xs text-amber-200">
            {locateMsg}
          </div>
        )}
      </div>

      {/* 右下：圖例 */}
      <div className="absolute bottom-4 right-4 z-[900]">
        <WeatherLegend mode={mode} />
      </div>

      {/* 底部中央：雷達動畫播放控制 */}
      {showRadar && radarData && (
        <div className="absolute bottom-20 left-1/2 z-[900] flex w-[min(92vw,420px)] -translate-x-1/2 items-center gap-3 rounded-lg bg-panel px-4 py-2.5 shadow-lg backdrop-blur">
          <button
            onClick={() => setRadarPlaying((p) => !p)}
            className="shrink-0 rounded-md bg-white/10 px-2.5 py-1 text-sm text-gray-100 hover:bg-white/20"
            aria-label={radarPlaying ? "暫停" : "播放"}
          >
            {radarPlaying ? "⏸" : "▶"}
          </button>
          <input
            type="range"
            min={0}
            max={radarData.frames.length - 1}
            value={radarIdx}
            onChange={(e) => {
              setRadarPlaying(false);
              setRadarIdx(Number(e.target.value));
            }}
            className="h-1 flex-1 cursor-pointer accent-sky-400"
          />
          <span className="shrink-0 font-mono text-xs tabular-nums text-gray-100">
            {new Date(radarData.frames[radarIdx].time * 1000).toLocaleTimeString(
              "zh-TW",
              { hour: "2-digit", minute: "2-digit", hour12: false }
            )}
          </span>
          <span className="shrink-0 text-[10px] text-gray-400">雷達</span>
        </div>
      )}

      {/* 左下：資料更新時間（明顯標示） */}
      {meta && (
        <div className="absolute bottom-4 left-4 z-[900] rounded-lg bg-panel px-4 py-2 text-xs text-gray-300 shadow-lg backdrop-blur">
          更新於{" "}
          <span className="font-semibold text-gray-100">
            {new Date(meta.updatedAt).toLocaleString("zh-TW", {
              hour12: false,
            })}
          </span>
          <button
            onClick={loadWeather}
            className="ml-3 rounded bg-white/10 px-2 py-0.5 text-gray-200 hover:bg-white/20"
          >
            ↻ 重新整理
          </button>
        </div>
      )}
    </main>
  );
}
