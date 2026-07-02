// Postgres 儲存層：寫入快照（供快取）+ 逐測站時序觀測（供歷史查詢）。

import { sql, db, ensureSchema } from "./db";
import type { CachedWeather } from "./types";

const OBS_COLUMNS = [
  "snapshot_id",
  "station_id",
  "station_name",
  "county",
  "town",
  "observed_at",
  "lng",
  "lat",
  "temperature",
  "humidity",
  "pressure",
  "wind_speed",
  "wind_direction",
  "gust_speed",
  "precipitation",
  "uvi",
  "weather",
] as const;

/** 寫入一次抓取結果：一筆 snapshot + 該批 observations，於單一交易內完成。 */
export async function saveSnapshot(entry: CachedWeather): Promise<void> {
  await ensureSchema();
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `INSERT INTO snapshots (fetched_at, updated_at, source, station_count, payload)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        entry.fetchedAt,
        entry.updatedAt,
        entry.source,
        entry.stationCount,
        JSON.stringify(entry),
      ]
    );
    const snapshotId = Number(rows[0].id);

    const features = entry.data.features;
    if (features.length > 0) {
      const cols = OBS_COLUMNS.length;
      const values: unknown[] = [];
      const tuples: string[] = [];
      features.forEach((f, i) => {
        const p = f.properties;
        const [lng, lat] = f.geometry.coordinates;
        const base = i * cols;
        tuples.push(
          `(${Array.from({ length: cols }, (_, k) => `$${base + k + 1}`).join(", ")})`
        );
        values.push(
          snapshotId,
          p.stationId,
          p.stationName,
          p.county,
          p.town,
          p.observedAt,
          lng,
          lat,
          p.temperature,
          p.humidity,
          p.pressure,
          p.windSpeed,
          p.windDirection,
          p.gustSpeed,
          p.precipitation,
          p.uvi,
          p.weather
        );
      });
      await client.query(
        `INSERT INTO observations (${OBS_COLUMNS.join(", ")}) VALUES ${tuples.join(", ")}`,
        values
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** 讀取最新一筆快照（供快取回讀）。無資料回 null。 */
export async function loadLatestSnapshot(): Promise<CachedWeather | null> {
  await ensureSchema();
  const { rows } = await sql<{ payload: CachedWeather | string }>`
    SELECT payload FROM snapshots ORDER BY fetched_at DESC LIMIT 1
  `;
  if (rows.length === 0) return null;
  const payload = rows[0].payload;
  // JSONB 欄位會由驅動自動 parse 成物件；字串則手動 parse 以防萬一。
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload) as CachedWeather;
    } catch {
      return null;
    }
  }
  return payload;
}

export interface StationHistoryRow {
  observedAt: string | null;
  fetchedAt: string;
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  gustSpeed: number | null;
  precipitation: number | null;
}

/** 查詢單一測站的歷史時序（最近 limit 筆，時間新到舊）。 */
export async function getStationHistory(
  stationId: string,
  limit = 144
): Promise<{
  stationId: string;
  stationName: string | null;
  rows: StationHistoryRow[];
}> {
  await ensureSchema();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 1000);
  const { rows } = await sql<StationHistoryRow & { stationName: string | null }>`
    SELECT o.station_name AS "stationName", o.observed_at AS "observedAt",
           s.fetched_at AS "fetchedAt", o.temperature, o.humidity, o.pressure,
           o.wind_speed AS "windSpeed", o.wind_direction AS "windDirection",
           o.gust_speed AS "gustSpeed", o.precipitation
    FROM observations o
    JOIN snapshots s ON s.id = o.snapshot_id
    WHERE o.station_id = ${stationId}
    ORDER BY s.fetched_at DESC
    LIMIT ${safeLimit}
  `;

  return {
    stationId,
    stationName: rows[0]?.stationName ?? null,
    rows: rows.map((r) => ({
      observedAt: r.observedAt,
      fetchedAt: r.fetchedAt,
      temperature: r.temperature,
      humidity: r.humidity,
      pressure: r.pressure,
      windSpeed: r.windSpeed,
      windDirection: r.windDirection,
      gustSpeed: r.gustSpeed,
      precipitation: r.precipitation,
    })),
  };
}
