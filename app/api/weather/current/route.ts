import { NextResponse } from "next/server";
import { getCurrentWeather } from "@/lib/weather-cache";
import { loadLatestSnapshot } from "@/lib/weather-store";
import { CWA_UNAVAILABLE_MESSAGE } from "@/lib/cwa";
import type { CachedWeather, WeatherApiResponse } from "@/lib/types";

// 此路由依賴外部 API 與快取，不可被靜態化。
export const dynamic = "force-dynamic";
export const revalidate = 0;
// loadLatestSnapshot 用的 sql 走 Neon HTTP 介面，會被 Next.js 的 fetch 快取攔截，
// 讓冷實例讀到過期回應（DB 有新快照卻讀成沒有）。關閉才能真正回讀最新快照。
export const fetchCache = "force-no-store";

function toBody(
  payload: CachedWeather,
  cached: boolean,
  stale: boolean
): WeatherApiResponse {
  return {
    success: true,
    source: payload.source,
    cached,
    stale,
    updatedAt: payload.updatedAt,
    fetchedAt: payload.fetchedAt,
    stationCount: payload.stationCount,
    data: payload.data,
    summary: payload.summary,
  };
}

export async function GET() {
  try {
    const { payload, cached, stale } = await getCurrentWeather();
    return NextResponse.json(toBody(payload, cached, stale), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[api/weather/current] 取得氣象資料失敗：", err);

    // 抓取失敗時，先嘗試回讀資料庫最後一筆快照，有就以 stale 舊資料回 200。
    try {
      const snapshot = await loadLatestSnapshot();
      if (snapshot) {
        return NextResponse.json(toBody(snapshot, true, true), {
          headers: { "Cache-Control": "no-store" },
        });
      }
    } catch (dbErr) {
      console.error("[api/weather/current] 回讀舊快照失敗：", dbErr);
    }

    const message =
      err instanceof Error && err.message ? err.message : CWA_UNAVAILABLE_MESSAGE;
    return NextResponse.json(
      { success: false, error: message },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
