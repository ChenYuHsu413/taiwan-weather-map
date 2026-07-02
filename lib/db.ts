// SQLite 連線單例與 schema。僅在後端執行（route handler / server）。
// 使用 globalThis 快取連線，避免 Next.js 開發模式 HMR 造成多重連線。

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DEFAULT_DB_PATH =
  process.env.VERCEL === "1"
    ? path.join("/tmp", "weather.db")
    : path.join(process.cwd(), ".cache", "weather.db");
const DB_PATH = process.env.WEATHER_DB_PATH || DEFAULT_DB_PATH;
const DB_DIR = path.dirname(DB_PATH);

function createConnection(): Database.Database {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL"); // 併發讀寫較穩定
  db.pragma("synchronous = NORMAL");

  db.exec(`
    -- 每次成功抓取為一筆快照，payload 存已組好的對外 JSON（供快取快速回讀）。
    CREATE TABLE IF NOT EXISTS snapshots (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      fetched_at   TEXT NOT NULL,   -- 後端實際抓取時間 (ISO8601)
      updated_at   TEXT NOT NULL,   -- 觀測資料最新時間
      source       TEXT NOT NULL,
      station_count INTEGER NOT NULL,
      payload      TEXT NOT NULL    -- CachedWeather 的 JSON
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_fetched_at
      ON snapshots (fetched_at DESC);

    -- 逐測站時序觀測。每次快照 append 一批，累積成歷史。
    CREATE TABLE IF NOT EXISTS observations (
      snapshot_id    INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
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
    CREATE INDEX IF NOT EXISTS idx_obs_station_time
      ON observations (station_id, observed_at DESC);

    -- Website crawler audit trail. This is intentionally separate from the
    -- structured CWA API snapshots so the crawler + SQLite workflow is visible.
    CREATE TABLE IF NOT EXISTS crawler_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      source_name   TEXT NOT NULL,
      source_url    TEXT NOT NULL,
      fetched_at    TEXT NOT NULL,
      status        TEXT NOT NULL,
      http_status   INTEGER,
      content_type  TEXT,
      file_size     INTEGER,
      from_cache    INTEGER NOT NULL DEFAULT 0,
      stale         INTEGER NOT NULL DEFAULT 0,
      duration_ms   INTEGER,
      error_message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_crawler_logs_fetched_at
      ON crawler_logs (fetched_at DESC);
  `);

  return db;
}

const globalForDb = globalThis as unknown as {
  __weatherDb?: Database.Database;
};

export function getDb(): Database.Database {
  if (!globalForDb.__weatherDb) {
    globalForDb.__weatherDb = createConnection();
  }
  return globalForDb.__weatherDb;
}
