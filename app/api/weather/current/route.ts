import { NextResponse } from "next/server";
import { getCurrentWeather } from "@/lib/weather-cache";
import type { WeatherApiResponse } from "@/lib/types";

// 此路由依賴外部 API 與快取，不可被靜態化。
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const { payload, cached, stale } = await getCurrentWeather();
    const body: WeatherApiResponse = {
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
    return NextResponse.json(body, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知錯誤";
    return NextResponse.json(
      { success: false, error: message },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
