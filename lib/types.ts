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
  | "typhoon"
  | "wind"
  | "humidity"
  | "weather"
  | "stations"
  | "counties";

// ---- 颱風路徑（CWA W-C0034-005）----

/** 單一颱風定位點（分析或預報）。缺值一律為 null。 */
export interface TyphoonFix {
  time: string | null; // ISO8601
  tau: number | null; // 預報時距（小時）；分析點為 null
  lng: number;
  lat: number;
  pressure: number | null; // hPa
  maxWind: number | null; // 近中心最大風速 m/s
  gust: number | null; // 最大陣風 m/s
  radius70: number | null; // 70% 機率半徑（預報誤差圈）km
  stormRadius: number | null; // 七級風（≥15m/s，暴風）半徑 km — Circle15ms
  severeRadius: number | null; // 十級風（≥25m/s，強烈暴風）半徑 km — Circle25ms
  moveDir: string | null; // 移動方位（W/WNW…16 方位）
  moveSpeed: number | null; // 移動速度 km/h
}

export interface Typhoon {
  id: string;
  name: string; // 中文名（無則英文或編號）
  enName: string | null;
  category: string | null; // 強度分級（由近中心最大風速推得）
  past: TyphoonFix[]; // 分析路徑，時間舊到新（含目前位置為最後一點）
  current: TyphoonFix | null; // 目前中心（分析最後一點）
  forecast: TyphoonFix[]; // 預報路徑，依 tau 升冪
}

export interface TyphoonApiResponse {
  success: boolean;
  count: number;
  typhoons: Typhoon[];
  fetchedAt: string;
  cached: boolean;
  stale: boolean;
  error?: string;
}
