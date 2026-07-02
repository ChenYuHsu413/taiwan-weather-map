import { NextResponse } from "next/server";
import { getWarnings } from "@/lib/warnings";

// GET /api/warnings：回傳目前生效中的中央氣象署天氣特報（來源為 NCDR CAP feed 爬蟲）。
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export async function GET() {
  try {
    const { warnings, fetchedAt, cached, stale } = await getWarnings();
    return NextResponse.json(
      { success: true, count: warnings.length, warnings, fetchedAt, cached, stale },
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
