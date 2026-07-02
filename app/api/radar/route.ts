import { getRadarImage } from "@/lib/radar";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/radar → 代理回傳最新雷達回波 PNG（後端爬取 + 快取）。
export async function GET() {
  try {
    const radar = await getRadarImage();
    return new Response(new Uint8Array(radar.buffer), {
      status: 200,
      headers: {
        "Content-Type": radar.contentType,
        "Cache-Control": "no-store",
        "X-Radar-Fetched-At": radar.fetchedAt,
        "X-Radar-Stale": String(radar.stale),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知錯誤";
    return Response.json(
      { success: false, error: message },
      { status: 502 }
    );
  }
}
