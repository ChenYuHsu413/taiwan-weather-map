// 統一氣象資料型別定義。後端清洗後只以這些型別對外，前端不接觸 CWA 原始 JSON。

/** 單一測站清洗後的屬性。缺值一律為 null。 */
export interface StationProperties {
  stationId: string;
  stationName: string;
  county: string | null;
  town: string | null;
  observedAt: string | null; // ISO8601，含 +08:00
  temperature: number | null; // °C
  humidity: number | null; // %
  pressure: number | null; // hPa
  windSpeed: number | null; // m/s
  windDirection: number | null; // 度，0-360
  gustSpeed: number | null; // 最大瞬間風 m/s
  precipitation: number | null; // mm（當前時段/日累積，依資料集）
  uvi: number | null; // 紫外線指數
  weather: string | null; // 天氣現象描述
}

export interface WeatherFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number]; // [lng, lat]
  };
  properties: StationProperties;
}

export interface WeatherFeatureCollection {
  type: "FeatureCollection";
  updatedAt: string; // 觀測資料的最新時間
  source: string; // 例如 "CWA O-A0003-001"
  features: WeatherFeature[];
}

export interface SummaryExtreme {
  stationName: string;
  value: number;
}

export interface WeatherSummary {
  maxTemperature: SummaryExtreme | null;
  minTemperature: SummaryExtreme | null;
  maxPrecipitation: SummaryExtreme | null;
  maxWindSpeed: SummaryExtreme | null;
}

/** 快取內部保存的整包資料。 */
export interface CachedWeather {
  data: WeatherFeatureCollection;
  summary: WeatherSummary;
  source: string;
  updatedAt: string; // 觀測時間
  fetchedAt: string; // 後端實際抓取時間
  stationCount: number;
}

/** /api/weather/current 對外回傳格式。 */
export interface WeatherApiResponse {
  success: boolean;
  source: string;
  cached: boolean;
  stale: boolean;
  updatedAt: string;
  fetchedAt: string;
  stationCount: number;
  data: WeatherFeatureCollection;
  summary: WeatherSummary;
  error?: string;
}

export type LayerKey =
  | "temperature"
  | "precipitation"
  | "radar"
  | "wind"
  | "humidity"
  | "weather"
  | "stations"
  | "counties";
