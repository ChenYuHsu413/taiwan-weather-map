// 將 CWA 原始資料轉換成統一 GeoJSON。
// 處理：缺值/異常值轉 null、經緯度驗證、數值轉型、測站去重、觀測時間統一。

import type {
  CwaRawResponse,
  CwaRawStation,
  CwaRawCoordinate,
} from "./cwa";
import type {
  StationProperties,
  WeatherFeature,
  WeatherFeatureCollection,
} from "./types";

// CWA 常見的缺值哨兵值。
const MISSING_SENTINELS = new Set([-99, -990, -991, -9991, -9997, -9998, -9999]);

/** 將任意值轉成有效 number，缺值/異常轉 null。 */
function toNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed === "-" || trimmed === "X") return null;
    // "T" 代表微量雨量（trace），視為 0。
    if (trimmed.toUpperCase() === "T") return 0;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return null;
    if (MISSING_SENTINELS.has(n)) return null;
    return n;
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    if (MISSING_SENTINELS.has(raw)) return null;
    return raw;
  }
  return null;
}

/** 清洗字串，空字串或缺值符號轉 null。 */
function toStr(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (t === "" || t === "-99" || t === "X") return null;
  return t;
}

/** 從 GeoInfo.Coordinates 取出 WGS84 經緯度；找不到 WGS84 則退回第一組。 */
function extractLngLat(
  coords: CwaRawCoordinate[] | undefined
): [number, number] | null {
  if (!coords || coords.length === 0) return null;
  const wgs84 =
    coords.find((c) => c.CoordinateName?.toUpperCase() === "WGS84") ?? coords[0];
  const lng = toNumber(wgs84.StationLongitude);
  const lat = toNumber(wgs84.StationLatitude);
  if (lng === null || lat === null) return null;
  // 台灣範圍粗略驗證（含離島：東沙、太平島偏南，故放寬）。
  if (lng < 116 || lng > 123.5 || lat < 20 || lat > 27) return null;
  return [lng, lat];
}

/** 統一觀測時間格式為 ISO8601（若已含時區則原樣保留）。 */
function normalizeObsTime(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (t === "") return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t; // 無法解析時保留原字串
  return t.includes("+") || t.endsWith("Z") ? t : d.toISOString();
}

function transformStation(station: CwaRawStation): WeatherFeature | null {
  const stationId = toStr(station.StationId);
  const coordinates = extractLngLat(station.GeoInfo?.Coordinates);
  // 無 ID 或無有效座標的測站直接排除。
  if (!stationId || !coordinates) return null;

  const we = station.WeatherElement ?? {};
  const geo = station.GeoInfo ?? {};

  const properties: StationProperties = {
    stationId,
    stationName: toStr(station.StationName) ?? stationId,
    county: toStr(geo.CountyName),
    town: toStr(geo.TownName),
    observedAt: normalizeObsTime(station.ObsTime?.DateTime),
    temperature: toNumber(we.AirTemperature),
    humidity: toNumber(we.RelativeHumidity),
    pressure: toNumber(we.AirPressure),
    windSpeed: toNumber(we.WindSpeed),
    windDirection: toNumber(we.WindDirection),
    gustSpeed: toNumber(we.GustInfo?.PeakGustSpeed),
    precipitation: toNumber(we.Now?.Precipitation),
    uvi: toNumber(we.UVIndex),
    weather: toStr(we.Weather),
  };

  return {
    type: "Feature",
    geometry: { type: "Point", coordinates },
    properties,
  };
}

/**
 * 將 CWA 原始回應轉為統一 GeoJSON。
 * - 去重：同一 stationId 只保留觀測時間最新者。
 * - updatedAt：取所有測站中最新的 observedAt。
 */
export function transformToGeoJSON(
  raw: CwaRawResponse,
  source: string
): WeatherFeatureCollection {
  const stations = raw.records?.Station ?? [];
  const byId = new Map<string, WeatherFeature>();

  for (const s of stations) {
    const feature = transformStation(s);
    if (!feature) continue;
    const id = feature.properties.stationId;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, feature);
      continue;
    }
    // 保留觀測時間較新者。
    const a = existing.properties.observedAt ?? "";
    const b = feature.properties.observedAt ?? "";
    if (b > a) byId.set(id, feature);
  }

  const features = Array.from(byId.values());
  const latest = features.reduce<string>((acc, f) => {
    const t = f.properties.observedAt;
    return t && t > acc ? t : acc;
  }, "");

  return {
    type: "FeatureCollection",
    updatedAt: latest || new Date().toISOString(),
    source,
    features,
  };
}
