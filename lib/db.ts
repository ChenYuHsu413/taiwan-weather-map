// Postgres 連線與 schema（Vercel Neon）。僅在後端執行（route handler / server）。
// 使用 @vercel/postgres 的連線池：serverless 友善，讀取連線字串於 POSTGRES_URL。
// schema 以 ensureSchema() 建立，並用 globalThis 快取「已建立」狀態避免每次請求重跑。

import { sql, db } from "@vercel/postgres";

export { sql, db };

// Vercel 的 Neon 原生整合可能只提供 DATABASE_URL；@vercel/postgres 預設讀
// POSTGRES_URL。在此對齊，兩種變數名都能運作。@vercel/postgres 首次查詢才建立
// 連線池（lazy），因此在模組載入時設定即可，早於任何查詢。
if (!process.env.POSTGRES_URL && process.env.DATABASE_URL) {
  process.env.POSTGRES_URL = process.env.DATABASE_URL;
}

const globalForDb = globalThis as unknown as {
  __schemaReady?: Promise<void>;
};

/** 確保資料表存在。只在每個實例執行一次（以 Promise 記憶）。 */
export function ensureSchema(): Promise<void> {
  if (!globalForDb.__schemaReady) {
    globalForDb.__schemaReady = createSchema().catch((err) => {
      // 建表失敗時清除記憶，讓下次請求重試。
      globalForDb.__schemaReady = undefined;
      throw err;
    });
  }
  return globalForDb.__schemaReady;
}

async function createSchema(): Promise<void> {
  // 每次成功抓取為一筆快照，payload 存已組好的對外 JSON（供快取快速回讀）。
  await sql`
    CREATE TABLE IF NOT EXISTS snapshots (
      id            BIGSERIAL PRIMARY KEY,
      fetched_at    TIMESTAMPTZ NOT NULL,   -- 後端實際抓取時間
      updated_at    TIMESTAMPTZ NOT NULL,   -- 觀測資料最新時間
      source        TEXT NOT NULL,
      station_count INTEGER NOT NULL,
      payload       JSONB NOT NULL          -- CachedWeather 的 JSON
    );
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_snapshots_fetched_at
      ON snapshots (fetched_at DESC);
  `;

  // 逐測站時序觀測。每次快照 append 一批，累積成歷史。
  await sql`
    CREATE TABLE IF NOT EXISTS observations (
      snapshot_id    BIGINT NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
      station_id     TEXT NOT NULL,
      station_name   TEXT,
      county         TEXT,
      town           TEXT,
      observed_at    TEXT,
      lng            REAL,
      lat            REAL,
      temperature    REAL,
      humidity       REAL,
      pressure       REAL,
      wind_speed     REAL,
      wind_direction REAL,
      gust_speed     REAL,
      precipitation  REAL,
      uvi            REAL,
      weather        TEXT
    );
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_obs_station_time
      ON observations (station_id, observed_at DESC);
  `;

  // 爬蟲稽核紀錄，刻意與結構化的 CWA 快照分開，讓 crawler + DB 流程可見。
  await sql`
    CREATE TABLE IF NOT EXISTS crawler_logs (
      id            BIGSERIAL PRIMARY KEY,
      source_name   TEXT NOT NULL,
      source_url    TEXT NOT NULL,
      fetched_at    TIMESTAMPTZ NOT NULL,
      status        TEXT NOT NULL,
      http_status   INTEGER,
      content_type  TEXT,
      file_size     INTEGER,
      from_cache    BOOLEAN NOT NULL DEFAULT FALSE,
      stale         BOOLEAN NOT NULL DEFAULT FALSE,
      duration_ms   INTEGER,
      error_message TEXT
    );
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_crawler_logs_fetched_at
      ON crawler_logs (fetched_at DESC);
  `;
}
