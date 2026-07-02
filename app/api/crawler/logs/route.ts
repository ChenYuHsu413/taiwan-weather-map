import { NextRequest, NextResponse } from "next/server";
import { getCrawlerLogs } from "@/lib/crawler-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : 20;
    return NextResponse.json(
      {
        success: true,
        logs: getCrawlerLogs(Number.isFinite(limit) ? limit : 20),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Failed to read crawler logs",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
