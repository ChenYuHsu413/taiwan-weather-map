import { NextRequest, NextResponse } from "next/server";
import { getStationHistory } from "@/lib/weather-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/weather/history?stationId=466920&limit=144
// 回傳單一測站的歷史時序觀測（資料量取決於已累積的抓取次數）。
export async function GET(req: NextRequest) {
  const stationId = req.nextUrl.searchParams.get("stationId");
  if (!stationId) {
    return NextResponse.json(
      { success: false, error: "缺少 stationId 參數" },
      { status: 400 }
    );
  }
  const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? 144);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), 1000)
    : 144;

  try {
    const history = getStationHistory(stationId, limit);
    return NextResponse.json(
      { success: true, ...history, count: history.rows.length },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知錯誤";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
