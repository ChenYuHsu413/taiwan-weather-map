import { NextRequest, NextResponse } from "next/server";
import { getWindGrid } from "@/lib/wind-cache";

// GET /api/wind：回傳 NOAA GFS 10m 風場格點（記憶體 / Postgres 快取，過期才重抓 NOMADS）。
// ?refresh=1 強制重抓（供排程預熱），需帶 Authorization: Bearer <CRON_SECRET>。
// GRIB2 解碼需要 Node runtime；NOMADS 下載可能耗時，放寬到 60 秒。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600",
};

export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  if (refresh) {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get("authorization");
    if (!secret || auth !== `Bearer ${secret}`) {
      return NextResponse.json(
        { success: false, error: "unauthorized" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }
  }

  try {
    const { payload, cached, stale, fallback } = await getWindGrid(refresh);
    return NextResponse.json(
      { success: true, cached, stale, fallback, ...payload },
      { headers: refresh ? { "Cache-Control": "no-store" } : CACHE_HEADERS }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知錯誤";
    return NextResponse.json(
      { success: false, error: message },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
