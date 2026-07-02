// 雷達回波圖爬蟲（後端專用，作為官方 API 的補充資料來源）。
//
// 為何用爬蟲：CWA 雷達合成圖為公開靜態 PNG，但官網會擋裸連結（缺 Referer 回 403），
// 且此授權層級的雷達 open data 資料集不可用。因此以後端帶正確 Referer 抓取公開影像，
// 並代理給前端（瀏覽器無法自帶該 Referer）。
//
// 遵守事項：只抓公開、免登入的靜態影像；帶快取（10 分鐘 TTL，對齊雷達更新頻率）；
// 帶請求頻率限制（失敗後至少間隔 60 秒才重試）；失敗時回退舊快取。

const RADAR_URL = "https://www.cwa.gov.tw/Data/radar/CV1_3600.png";
const TTL_MS = 10 * 60 * 1000; // 成功後 10 分鐘內不重抓
const MIN_RETRY_MS = 60 * 1000; // 失敗後最短重試間隔
const TIMEOUT_MS = 15000;

interface RadarCache {
  buffer: Buffer;
  contentType: string;
  fetchedAt: number; // epoch ms
}

const globalForRadar = globalThis as unknown as {
  __radarCache?: RadarCache;
  __radarLastAttempt?: number;
  __radarInflight?: Promise<RadarCache> | null;
};

export interface RadarResult {
  buffer: Buffer;
  contentType: string;
  fetchedAt: string; // ISO
  stale: boolean;
}

async function fetchRadar(): Promise<RadarCache> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(RADAR_URL, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        // CWA 擋裸連結，需帶來源頁與 UA。
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        Referer: "https://www.cwa.gov.tw/V8/C/W/OBS_Radar.html",
        Accept: "image/png,image/*,*/*",
      },
    });
    if (!res.ok) {
      throw new Error(`雷達影像 HTTP ${res.status}`);
    }
    const contentType = res.headers.get("content-type") ?? "image/png";
    if (!contentType.startsWith("image/")) {
      throw new Error("雷達回應非影像格式");
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 1000) {
      throw new Error("雷達影像大小異常");
    }
    return { buffer, contentType, fetchedAt: Date.now() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 取得雷達影像。快取新鮮則直接回傳；過期則重抓（含頻率限制與併發去重）；
 * 抓取失敗但有舊快取則回退（stale=true）。
 */
export async function getRadarImage(): Promise<RadarResult> {
  const cache = globalForRadar.__radarCache;
  const now = Date.now();

  // 快取新鮮
  if (cache && now - cache.fetchedAt < TTL_MS) {
    return toResult(cache, false);
  }

  // 頻率限制：距上次嘗試太近，且有舊快取 → 先用舊的（避免頻繁打對方）
  const lastAttempt = globalForRadar.__radarLastAttempt ?? 0;
  if (cache && now - lastAttempt < MIN_RETRY_MS) {
    return toResult(cache, true);
  }

  if (!globalForRadar.__radarInflight) {
    globalForRadar.__radarLastAttempt = now;
    globalForRadar.__radarInflight = fetchRadar().finally(() => {
      globalForRadar.__radarInflight = null;
    });
  }

  try {
    const fresh = await globalForRadar.__radarInflight;
    globalForRadar.__radarCache = fresh;
    return toResult(fresh, false);
  } catch (err) {
    if (cache) return toResult(cache, true);
    throw err instanceof Error ? err : new Error("雷達抓取失敗");
  }
}

function toResult(c: RadarCache, stale: boolean): RadarResult {
  return {
    buffer: c.buffer,
    contentType: c.contentType,
    fetchedAt: new Date(c.fetchedAt).toISOString(),
    stale,
  };
}
