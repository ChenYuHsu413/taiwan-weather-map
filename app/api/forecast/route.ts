import { NextResponse } from "next/server";
import { getForecast } from "@/lib/forecast";

// GET /api/forecast：各縣市今明 36 小時天氣預報（CWA F-C0032-001，API+DB 快取）。
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export async function GET() {
  try {
    const { forecast, fetchedAt, cached, stale } = await getForecast();
    return NextResponse.json(
      { success: true, count: forecast.length, forecast, fetchedAt, cached, stale },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知錯誤";
    return NextResponse.json(
      { success: false, error: message },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
