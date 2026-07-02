import { saveCrawlerLog } from "./crawler-store";

const RADAR_URL = "https://www.cwa.gov.tw/Data/radar/CV1_3600.png";
const RADAR_REFERER = "https://www.cwa.gov.tw/V8/C/W/OBS_Radar.html";
const SOURCE_NAME = "CWA Radar Composite PNG";
const TTL_MS = 10 * 60 * 1000;
const MIN_RETRY_MS = 60 * 1000;
const TIMEOUT_MS = 15000;

interface RadarCache {
  buffer: Buffer;
  contentType: string;
  fetchedAt: number;
  httpStatus: number;
  durationMs: number;
}

const globalForRadar = globalThis as unknown as {
  __radarCache?: RadarCache;
  __radarLastAttempt?: number;
  __radarInflight?: Promise<RadarCache> | null;
};

export interface RadarResult {
  buffer: Buffer;
  contentType: string;
  fetchedAt: string;
  stale: boolean;
}

function recordCrawlerLog(input: Parameters<typeof saveCrawlerLog>[0]): void {
  try {
    saveCrawlerLog(input);
  } catch {
    // Logging is for audit/demo only; never break the image endpoint because DB
    // logging failed.
  }
}

async function fetchRadar(): Promise<RadarCache> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let httpStatus: number | null = null;
  let contentType: string | null = null;

  try {
    const res = await fetch(RADAR_URL, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        Referer: RADAR_REFERER,
        Accept: "image/png,image/*,*/*",
      },
    });
    httpStatus = res.status;
    contentType = res.headers.get("content-type") ?? "image/png";

    if (!res.ok) {
      throw new Error(`CWA radar crawler HTTP ${res.status}`);
    }
    if (!contentType.startsWith("image/")) {
      throw new Error(`CWA radar crawler returned ${contentType}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 1000) {
      throw new Error("CWA radar crawler returned an unexpectedly small image");
    }

    const durationMs = Date.now() - startedAt;
    recordCrawlerLog({
      sourceName: SOURCE_NAME,
      sourceUrl: RADAR_URL,
      status: "success",
      httpStatus,
      contentType,
      fileSize: buffer.length,
      durationMs,
    });

    return {
      buffer,
      contentType,
      fetchedAt: Date.now(),
      httpStatus,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    recordCrawlerLog({
      sourceName: SOURCE_NAME,
      sourceUrl: RADAR_URL,
      status: "failed",
      httpStatus,
      contentType,
      durationMs,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function getRadarImage(): Promise<RadarResult> {
  const cache = globalForRadar.__radarCache;
  const now = Date.now();

  if (cache && now - cache.fetchedAt < TTL_MS) {
    recordCrawlerLog({
      sourceName: SOURCE_NAME,
      sourceUrl: RADAR_URL,
      status: "cache_hit",
      httpStatus: cache.httpStatus,
      contentType: cache.contentType,
      fileSize: cache.buffer.length,
      fromCache: true,
      durationMs: 0,
    });
    return toResult(cache, false);
  }

  const lastAttempt = globalForRadar.__radarLastAttempt ?? 0;
  if (cache && now - lastAttempt < MIN_RETRY_MS) {
    recordCrawlerLog({
      sourceName: SOURCE_NAME,
      sourceUrl: RADAR_URL,
      status: "stale",
      httpStatus: cache.httpStatus,
      contentType: cache.contentType,
      fileSize: cache.buffer.length,
      fromCache: true,
      stale: true,
      durationMs: 0,
      errorMessage: "Retry skipped because the previous crawler attempt was too recent.",
    });
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
    if (cache) {
      recordCrawlerLog({
        sourceName: SOURCE_NAME,
        sourceUrl: RADAR_URL,
        status: "stale",
        httpStatus: cache.httpStatus,
        contentType: cache.contentType,
        fileSize: cache.buffer.length,
        fromCache: true,
        stale: true,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return toResult(cache, true);
    }
    throw err instanceof Error ? err : new Error("CWA radar crawler failed");
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
