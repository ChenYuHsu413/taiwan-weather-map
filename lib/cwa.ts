// CWA 開放資料 API client（僅在後端執行）。
// 讀取環境變數 CWA_API_KEY，支援 primary/fallback 資料集、timeout 與錯誤處理。
// 絕不在前端 import 此檔（會洩漏 API key）。

const CWA_BASE = "https://opendata.cwa.gov.tw/api/v1/rest/datastore";
const DEFAULT_TIMEOUT_MS = 15000;

/** CWA 新版測站資料的原始結構（O-A0003-001 與 O-A0001-001 皆使用）。
 *  欄位皆標為 optional / unknown，交由 transform 層防禦性處理。 */
export interface CwaRawCoordinate {
  CoordinateName?: string; // "WGS84" | "TWD97"
  StationLongitude?: number | string;
  StationLatitude?: number | string;
}

export interface CwaRawGeoInfo {
  Coordinates?: CwaRawCoordinate[];
  CountyName?: string;
  TownName?: string;
  StationAltitude?: string | number;
}

export interface CwaRawWeatherElement {
  Weather?: string;
  Now?: { Precipitation?: number | string };
  WindDirection?: number | string;
  WindSpeed?: number | string;
  AirTemperature?: number | string;
  RelativeHumidity?: number | string;
  AirPressure?: number | string;
  UVIndex?: number | string;
  GustInfo?: {
    PeakGustSpeed?: number | string;
    Occurred_at?: { WindDirection?: number | string; DateTime?: string };
  };
}

export interface CwaRawStation {
  StationName?: string;
  StationId?: string;
  ObsTime?: { DateTime?: string };
  GeoInfo?: CwaRawGeoInfo;
  WeatherElement?: CwaRawWeatherElement;
}

export interface CwaRawResponse {
  success?: string | boolean;
  records?: {
    Station?: CwaRawStation[];
  };
}

export class CwaError extends Error {
  constructor(message: string, readonly dataset: string) {
    super(message);
    this.name = "CwaError";
  }
}

function getApiKey(): string {
  const key = process.env.CWA_API_KEY;
  if (!key) {
    throw new Error(
      "缺少 CWA_API_KEY 環境變數，請在 .env.local 設定中央氣象署授權碼。"
    );
  }
  return key;
}

/**
 * 向 CWA 抓取指定資料集的原始 JSON（不做資料結構檢查）。
 * 供結構各異的資料集共用（測站、颱風路徑…），由呼叫端自行驗證內容。
 * @throws CwaError 當 HTTP 失敗、timeout 或回應標示 success=false 時。
 */
export async function fetchRawDataset<T = unknown>(
  dataset: string,
  params: Record<string, string> = {}
): Promise<T> {
  const apiKey = getApiKey();
  const qs = new URLSearchParams({
    Authorization: apiKey,
    format: "JSON",
    ...params,
  });
  const url = `${CWA_BASE}/${dataset}?${qs.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new CwaError(
        `CWA API HTTP ${res.status} ${res.statusText}`,
        dataset
      );
    }

    const json = (await res.json()) as { success?: string | boolean } & T;
    if (json.success === "false" || json.success === false) {
      throw new CwaError("CWA API 回應 success=false（授權碼或參數可能錯誤）", dataset);
    }
    return json;
  } catch (err) {
    if (err instanceof CwaError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new CwaError(`CWA API 逾時（>${DEFAULT_TIMEOUT_MS}ms）`, dataset);
    }
    throw new CwaError(
      `CWA API 請求失敗：${err instanceof Error ? err.message : String(err)}`,
      dataset
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 向 CWA 抓取指定測站資料集的原始 JSON。
 * @throws CwaError 當 HTTP 失敗、timeout、success=false 或無測站資料時。
 */
export async function fetchDataset(dataset: string): Promise<CwaRawResponse> {
  const json = await fetchRawDataset<CwaRawResponse>(dataset);
  if (!json.records?.Station || json.records.Station.length === 0) {
    throw new CwaError("CWA API 回應無測站資料", dataset);
  }
  return json;
}
