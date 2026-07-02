// SQLite 儲存層：寫入快照（供快取）+ 逐測站時序觀測（供歷史查詢）。

import { getDb } from "./db";
import type { CachedWeather } from "./types";

/** 寫入一次抓取結果：一筆 snapshot + 該批 observations，於單一交易內完成。 */
export function saveSnapshot(entry: CachedWeather): void {
  const db = getDb();

  const insertSnapshot = db.prepare(
    `INSERT INTO snapshots (fetched_at, updated_at, source, station_count, payload)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertObs = db.prepare(
    `INSERT INTO observations (
       snapshot_id, station_id, station_name, county, town, observed_at,
       lng, lat, temperature, humidity, pressure, wind_speed, wind_direction,
       gust_speed, precipitation, uvi, weather
     ) VALUES (
       @snapshot_id, @station_id, @station_name, @county, @town, @observed_at,
       @lng, @lat, @temperature, @humidity, @pressure, @wind_speed, @wind_direction,
       @gust_speed, @precipitation, @uvi, @weather
     )`
  );

  const tx = db.transaction((e: CachedWeather) => {
    const info = insertSnapshot.run(
      e.fetchedAt,
      e.updatedAt,
      e.source,
      e.stationCount,
      JSON.stringify(e)
    );
    const snapshotId = Number(info.lastInsertRowid);
    for (const f of e.data.features) {
      const p = f.properties;
      const [lng, lat] = f.geometry.coordinates;
      insertObs.run({
        snapshot_id: snapshotId,
        station_id: p.stationId,
        station_name: p.stationName,
        county: p.county,
        town: p.town,
        observed_at: p.observedAt,
        lng,
        lat,
        temperature: p.temperature,
        humidity: p.humidity,
        pressure: p.pressure,
        wind_speed: p.windSpeed,
        wind_direction: p.windDirection,
        gust_speed: p.gustSpeed,
        precipitation: p.precipitation,
        uvi: p.uvi,
        weather: p.weather,
      });
    }
  });

  tx(entry);
}

/** 讀取最新一筆快照（供快取回讀）。無資料回 null。 */
export function loadLatestSnapshot(): CachedWeather | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT payload FROM snapshots ORDER BY fetched_at DESC LIMIT 1`)
    .get() as { payload: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as CachedWeather;
  } catch {
    return null;
  }
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
export function getStationHistory(
  stationId: string,
  limit = 144
): { stationId: string; stationName: string | null; rows: StationHistoryRow[] } {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT o.station_name AS stationName, o.observed_at AS observedAt,
              s.fetched_at AS fetchedAt, o.temperature, o.humidity, o.pressure,
              o.wind_speed AS windSpeed, o.wind_direction AS windDirection,
              o.gust_speed AS gustSpeed, o.precipitation
       FROM observations o
       JOIN snapshots s ON s.id = o.snapshot_id
       WHERE o.station_id = ?
       ORDER BY s.fetched_at DESC
       LIMIT ?`
    )
    .all(stationId, limit) as (StationHistoryRow & { stationName: string | null })[];

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
