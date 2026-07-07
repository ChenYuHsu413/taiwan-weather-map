import { NextResponse } from "next/server";
import { getTyphoons } from "@/lib/typhoon";

// GET /api/typhoon：回傳目前的颱風分析與官方預報路徑（來源 CWA W-C0034-005）。
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export async function GET() {
  try {
    const { typhoons, fetchedAt, cached, stale } = await getTyphoons();
    return NextResponse.json(
      { success: true, count: typhoons.length, typhoons, fetchedAt, cached, stale },
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
