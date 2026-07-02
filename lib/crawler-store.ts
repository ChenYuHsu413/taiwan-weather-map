import { getDb } from "./db";

export type CrawlerLogStatus = "success" | "failed" | "cache_hit" | "stale";

export interface CrawlerLogInput {
  sourceName: string;
  sourceUrl: string;
  status: CrawlerLogStatus;
  httpStatus?: number | null;
  contentType?: string | null;
  fileSize?: number | null;
  fromCache?: boolean;
  stale?: boolean;
  durationMs?: number | null;
  errorMessage?: string | null;
}

export interface CrawlerLogRow extends CrawlerLogInput {
  id: number;
  fetchedAt: string;
  fromCache: boolean;
  stale: boolean;
}

function ensureCrawlerLogSchema(): void {
  const db = getDb();
  db.exec(`
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
}

export function saveCrawlerLog(input: CrawlerLogInput): void {
  ensureCrawlerLogSchema();
  const db = getDb();
  db.prepare(
    `INSERT INTO crawler_logs (
       source_name, source_url, fetched_at, status, http_status, content_type,
       file_size, from_cache, stale, duration_ms, error_message
     ) VALUES (
       @sourceName, @sourceUrl, @fetchedAt, @status, @httpStatus, @contentType,
       @fileSize, @fromCache, @stale, @durationMs, @errorMessage
     )`
  ).run({
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
    fetchedAt: new Date().toISOString(),
    status: input.status,
    httpStatus: input.httpStatus ?? null,
    contentType: input.contentType ?? null,
    fileSize: input.fileSize ?? null,
    fromCache: input.fromCache ? 1 : 0,
    stale: input.stale ? 1 : 0,
    durationMs: input.durationMs ?? null,
    errorMessage: input.errorMessage ?? null,
  });
}

export function getCrawlerLogs(limit = 20): CrawlerLogRow[] {
  ensureCrawlerLogSchema();
  const db = getDb();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const rows = db
    .prepare(
      `SELECT id, source_name AS sourceName, source_url AS sourceUrl,
              fetched_at AS fetchedAt, status, http_status AS httpStatus,
              content_type AS contentType, file_size AS fileSize,
              from_cache AS fromCache, stale, duration_ms AS durationMs,
              error_message AS errorMessage
       FROM crawler_logs
       ORDER BY fetched_at DESC
       LIMIT ?`
    )
    .all(safeLimit) as (Omit<CrawlerLogRow, "fromCache" | "stale"> & {
    fromCache: 0 | 1;
    stale: 0 | 1;
  })[];

  return rows.map((row) => ({
    ...row,
    fromCache: Boolean(row.fromCache),
    stale: Boolean(row.stale),
  }));
}
