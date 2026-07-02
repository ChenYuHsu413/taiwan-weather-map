import { sql, ensureSchema } from "./db";

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

export async function saveCrawlerLog(input: CrawlerLogInput): Promise<void> {
  await ensureSchema();
  await sql`
    INSERT INTO crawler_logs (
      source_name, source_url, fetched_at, status, http_status, content_type,
      file_size, from_cache, stale, duration_ms, error_message
    ) VALUES (
      ${input.sourceName}, ${input.sourceUrl}, ${new Date().toISOString()},
      ${input.status}, ${input.httpStatus ?? null}, ${input.contentType ?? null},
      ${input.fileSize ?? null}, ${input.fromCache ?? false}, ${input.stale ?? false},
      ${input.durationMs ?? null}, ${input.errorMessage ?? null}
    )
  `;
}

export async function getCrawlerLogs(limit = 20): Promise<CrawlerLogRow[]> {
  await ensureSchema();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const { rows } = await sql<CrawlerLogRow>`
    SELECT id, source_name AS "sourceName", source_url AS "sourceUrl",
           fetched_at AS "fetchedAt", status, http_status AS "httpStatus",
           content_type AS "contentType", file_size AS "fileSize",
           from_cache AS "fromCache", stale, duration_ms AS "durationMs",
           error_message AS "errorMessage"
    FROM crawler_logs
    ORDER BY fetched_at DESC
    LIMIT ${safeLimit}
  `;
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    fromCache: Boolean(row.fromCache),
    stale: Boolean(row.stale),
  }));
}
