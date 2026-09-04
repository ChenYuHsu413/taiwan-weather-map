// GFS 風場快取：記憶體 → Neon Postgres (gfs_wind_cache) → 重抓 NOMADS。
// 抓取失敗回舊資料並標 stale；完全沒有舊資料時，最後退回 public/data/gfs-wind.json。

import { readFile } from "node:fs/promises";
import path from "node:path";
import { sql, ensureSchema } from "./db";
import { fetchLatestGfsWind, validTime, type GfsWindGrid } from "./gfs-wind";

const TTL_SECONDS = Number(process.env.GFS_WIND_CACHE_TTL_SECONDS ?? 3 * 3600);
const STATIC_FILE = path.join(process.cwd(), "public", "data", "gfs-wind.json");

let memoryCache: GfsWindGrid | null = null;
let inflight: Promise<GfsWindGrid> | null = null;

export interface WindCacheResult {
  payload: GfsWindGrid;
  cached: boolean; // 未觸發 NOMADS 抓取
  stale: boolean; // 抓取失敗而沿用的舊資料（含靜態備援檔）
  fallback: "memory" | "db" | "nomads" | "static";
}

function isFresh(entry: GfsWindGrid): boolean {
  return (Date.now() - new Date(entry.fetchedAt).getTime()) / 1000 < TTL_SECONDS;
}

async function readDb(): Promise<GfsWindGrid | null> {
  try {
    await ensureSchema();
    const { rows } = await sql<{ payload: GfsWindGrid | string }>`
      SELECT payload FROM gfs_wind_cache ORDER BY fetched_at DESC LIMIT 1
    `;
    if (rows.length === 0) return null;
    const p = rows[0].payload;
    return typeof p === "string" ? (JSON.parse(p) as GfsWindGrid) : p;
  } catch (err) {
    console.error("[wind-cache] 讀取 gfs_wind_cache 失敗：", err);
    return null;
  }
}

async function writeDb(entry: GfsWindGrid): Promise<void> {
  try {
    await ensureSchema();
    await sql`
      INSERT INTO gfs_wind_cache (run_date, cycle, forecast_hour, fetched_at, payload)
      VALUES (${entry.run.date}, ${entry.run.cycle}, ${entry.run.forecastHour},
              ${entry.fetchedAt}, ${JSON.stringify(entry)})
    `;
    // 每筆約 200KB，只留最近 3 天避免無限成長。
    await sql`DELETE FROM gfs_wind_cache WHERE fetched_at < now() - interval '3 days'`;
  } catch (err) {
    console.error("[wind-cache] 寫入 gfs_wind_cache 失敗：", err);
  }
}

async function readStatic(): Promise<GfsWindGrid | null> {
  try {
    const json = JSON.parse(await readFile(STATIC_FILE, "utf8")) as GfsWindGrid;
    // 舊版靜態檔沒有 validAt，補算。
    if (!json.validAt && json.run) json.validAt = validTime(json.run).toISOString();
    return json;
  } catch (err) {
    console.error("[wind-cache] 讀取靜態備援檔失敗：", err);
    return null;
  }
}

/**
 * 取得風場格點。
 * @param forceRefresh 略過新鮮度檢查、直接重抓 NOMADS（排程預熱用）。
 */
export async function getWindGrid(forceRefresh = false): Promise<WindCacheResult> {
  if (!forceRefresh) {
    if (memoryCache && isFresh(memoryCache)) {
      return { payload: memoryCache, cached: true, stale: false, fallback: "memory" };
    }
    if (!memoryCache) {
      const persisted = await readDb();
      if (persisted) {
        memoryCache = persisted;
        if (isFresh(persisted)) {
          return { payload: persisted, cached: true, stale: false, fallback: "db" };
        }
      }
    }
  }

  if (!inflight) {
    inflight = fetchLatestGfsWind((m) => console.log(`[wind-cache] ${m}`)).finally(
      () => {
        inflight = null;
      }
    );
  }

  try {
    const fresh = await inflight;
    memoryCache = fresh;
    await writeDb(fresh);
    return { payload: fresh, cached: false, stale: false, fallback: "nomads" };
  } catch (err) {
    console.error("[wind-cache] NOMADS 抓取失敗：", err);
    const old = memoryCache ?? (await readDb());
    if (old) {
      memoryCache = old;
      return { payload: old, cached: true, stale: true, fallback: "db" };
    }
    const staticGrid = await readStatic();
    if (staticGrid) {
      return { payload: staticGrid, cached: true, stale: true, fallback: "static" };
    }
    throw err;
  }
}
