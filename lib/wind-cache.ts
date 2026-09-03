// GFS 風場快取：記憶體 → Neon Postgres (gfs_wind_cache) → 重抓 NOMADS。
// 抓取失敗回舊資料並標 stale；完全沒有舊資料時，最後退回 public/data/gfs-wind.json。

import { readFile } from "node:fs/promises";
import path from "node:path";
import { sql, db, ensureSchema } from "./db";
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
  debug: WindDebug; // 診斷資訊（路由只在 ?debug=1 時回傳）
}

export interface WindDebug {
  ttlSeconds: number;
  hadMemory: boolean;
  memoryFresh: boolean | null;
  dbRows: number | null;
  dbPayloadType: string | null;
  dbFetchedAt: string | null;
  dbFresh: boolean | null;
  dbError: string | null;
  dbInfo: Record<string, unknown> | null; // 連線到哪個資料庫、表內筆數等
  dbInfoBefore: Record<string, unknown> | null; // readDb 之前先量一次
}

/** 診斷：同一張表用不同讀法各讀一次，找出哪一種讀不到。 */
async function readVariants(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const run = async (name: string, fn: () => Promise<unknown>) => {
    try {
      out[name] = await fn();
    } catch (err) {
      out[name] = `ERR ${err instanceof Error ? err.message : String(err)}`;
    }
  };
  await ensureSchema();
  await run("count", async () => (await sql`SELECT count(*)::int AS n FROM gfs_wind_cache`).rows[0]?.n);
  await run("smallCols", async () =>
    (await sql`SELECT id, fetched_at FROM gfs_wind_cache ORDER BY fetched_at DESC LIMIT 1`).rows[0] ?? null
  );
  await run("payloadLen", async () =>
    (await sql`SELECT id, length(payload::text) AS len FROM gfs_wind_cache ORDER BY fetched_at DESC LIMIT 1`).rows[0] ?? null
  );
  await run("payloadRows_sql", async () => {
    const { rows } = await sql`SELECT payload FROM gfs_wind_cache ORDER BY fetched_at DESC LIMIT 1`;
    return { n: rows.length, type: typeof rows[0]?.payload, fetchedAt: (rows[0]?.payload as { fetchedAt?: string } | undefined)?.fetchedAt ?? null };
  });
  await run("payloadRows_byId", async () => {
    const { rows } = await sql`SELECT payload FROM gfs_wind_cache ORDER BY id DESC LIMIT 1`;
    return { n: rows.length, fetchedAt: (rows[0]?.payload as { fetchedAt?: string } | undefined)?.fetchedAt ?? null };
  });
  await run("payloadRows_client", async () => {
    const client = await db.connect();
    try {
      const { rows } = await client.query("SELECT payload FROM gfs_wind_cache ORDER BY fetched_at DESC LIMIT 1");
      return { n: rows.length, fetchedAt: (rows[0]?.payload as { fetchedAt?: string } | undefined)?.fetchedAt ?? null };
    } finally {
      client.release();
    }
  });
  await run("snapshotRows_sql", async () => {
    const { rows } = await sql`SELECT payload FROM snapshots ORDER BY fetched_at DESC LIMIT 1`;
    return { n: rows.length, fetchedAt: (rows[0]?.payload as { fetchedAt?: string } | undefined)?.fetchedAt ?? null };
  });
  return out;
}

/** 診斷：目前連線落在哪個資料庫、表內有幾筆。 */
async function dbInfo(): Promise<Record<string, unknown>> {
  const url = process.env.POSTGRES_URL ?? process.env.DATABASE_URL ?? "";
  let host: string | null = null;
  try {
    host = new URL(url).host;
  } catch {
    host = null;
  }
  try {
    await ensureSchema();
    const { rows } = await sql<Record<string, unknown>>`
      SELECT current_database() AS db, current_schema() AS schema, current_user AS usr,
             inet_server_addr()::text AS server,
             pg_is_in_recovery() AS in_recovery, pg_backend_pid() AS pid,
             pg_postmaster_start_time()::text AS pg_started, now()::text AS db_now,
             txid_current_snapshot()::text AS txid_snapshot,
             (SELECT count(*) FROM gfs_wind_cache) AS wind_rows,
             (SELECT max(fetched_at) FROM gfs_wind_cache) AS wind_latest,
             (SELECT count(*) FROM snapshots) AS snapshot_rows,
             (SELECT string_agg(table_schema || '.' || table_name, ',') FROM information_schema.tables
               WHERE table_name = 'gfs_wind_cache') AS wind_tables
    `;
    return { host, ...rows[0] };
  } catch (err) {
    return { host, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}

function isFresh(entry: GfsWindGrid): boolean {
  return (Date.now() - new Date(entry.fetchedAt).getTime()) / 1000 < TTL_SECONDS;
}

async function readDb(dbg?: WindDebug): Promise<GfsWindGrid | null> {
  try {
    await ensureSchema();
    const { rows } = await sql<{ payload: GfsWindGrid | string }>`
      SELECT payload FROM gfs_wind_cache ORDER BY fetched_at DESC LIMIT 1
    `;
    if (dbg) dbg.dbRows = rows.length;
    if (rows.length === 0) return null;
    const p = rows[0].payload;
    if (dbg) dbg.dbPayloadType = typeof p;
    const grid = typeof p === "string" ? (JSON.parse(p) as GfsWindGrid) : p;
    if (dbg) {
      dbg.dbFetchedAt = grid?.fetchedAt ?? null;
      dbg.dbFresh = grid ? isFresh(grid) : null;
    }
    return grid;
  } catch (err) {
    console.error("[wind-cache] 讀取 gfs_wind_cache 失敗：", err);
    if (dbg) dbg.dbError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
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
  const debug: WindDebug = {
    ttlSeconds: TTL_SECONDS,
    hadMemory: memoryCache !== null,
    memoryFresh: memoryCache ? isFresh(memoryCache) : null,
    dbRows: null,
    dbPayloadType: null,
    dbFetchedAt: null,
    dbFresh: null,
    dbError: null,
    dbInfo: null,
    dbInfoBefore: null,
  };

  if (!forceRefresh) {
    if (memoryCache && isFresh(memoryCache)) {
      return { payload: memoryCache, cached: true, stale: false, fallback: "memory", debug };
    }
    if (!memoryCache) {
      debug.dbInfoBefore = await dbInfo();
      const persisted = await readDb(debug);
      debug.dbInfo = { ...(await dbInfo()), variants: await readVariants() };
      if (persisted) {
        memoryCache = persisted;
        if (isFresh(persisted)) {
          return { payload: persisted, cached: true, stale: false, fallback: "db", debug };
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
    if (!debug.dbInfo) debug.dbInfo = await dbInfo();
    return { payload: fresh, cached: false, stale: false, fallback: "nomads", debug };
  } catch (err) {
    console.error("[wind-cache] NOMADS 抓取失敗：", err);
    const old = memoryCache ?? (await readDb());
    if (old) {
      memoryCache = old;
      return { payload: old, cached: true, stale: true, fallback: "db", debug };
    }
    const staticGrid = await readStatic();
    if (staticGrid) {
      return { payload: staticGrid, cached: true, stale: true, fallback: "static", debug };
    }
    throw err;
  }
}
