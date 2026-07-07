// CWA 颱風路徑預報（W-C0034-005）client + 解析。僅在後端執行（會用到 API key）。
// 這是氣象署官方的颱風分析與預報路徑，非自製預測：含過去軌跡、目前中心，
// 以及未來各時距（tau）的預報位置與 70% 機率誤差圈。無颱風時回傳空陣列。

import { fetchRawDataset } from "./cwa";
import type { Typhoon, TyphoonFix } from "./types";

const DATASET = "W-C0034-005";
const TTL_SECONDS = Number(process.env.TYPHOON_CACHE_TTL_SECONDS ?? 600);
const STALE_RETRY_SECONDS = 60;

// W-C0034-005 原始結構（CWA 使用 PascalCase；欄位皆防禦性處理）。
interface RawFix {
  DateTime?: string; // 分析點時間
  InitialTime?: string; // 預報基準時間
  ForecastHour?: string | number; // 預報時距（小時）
  CoordinateLongitude?: string | number;
  CoordinateLatitude?: string | number;
  MaxWindSpeed?: string | number;
  MaxGustSpeed?: string | number;
  Pressure?: string | number;
  Radius70PercentProbability?: string | number;
  Circle15ms?: { Radius?: string | number }; // 七級風（暴風）半徑
}
interface RawCyclone {
  TyphoonName?: string;
  CwaTyphoonName?: string;
  CwaTdNo?: string | number;
  CwaTyNo?: string | number;
  AnalysisData?: { Fix?: RawFix[] };
  ForecastData?: { Fix?: RawFix[] };
}
interface RawTyphoonResponse {
  records?: { TropicalCyclones?: { TropicalCyclone?: RawCyclone[] } };
}

export interface TyphoonResult {
  typhoons: Typhoon[];
  fetchedAt: string;
  cached: boolean;
  stale: boolean;
}

interface MemoryCache {
  result: TyphoonResult;
  at: number;
}
const globalForTyphoon = globalThis as unknown as {
  __typhoonCache?: MemoryCache;
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toFix(raw: RawFix, isForecast: boolean): TyphoonFix | null {
  const lng = num(raw.CoordinateLongitude);
  const lat = num(raw.CoordinateLatitude);
  if (lng === null || lat === null) return null;
  return {
    time: (isForecast ? raw.InitialTime : raw.DateTime) ?? null,
    tau: isForecast ? num(raw.ForecastHour) : null,
    lng,
    lat,
    pressure: num(raw.Pressure),
    maxWind: num(raw.MaxWindSpeed),
    gust: num(raw.MaxGustSpeed),
    radius70: num(raw.Radius70PercentProbability),
    stormRadius: num(raw.Circle15ms?.Radius),
  };
}

/** 依近中心最大風速（m/s）推定颱風強度分級。 */
function categorize(maxWind: number | null): string | null {
  if (maxWind === null) return null;
  if (maxWind < 17.2) return "熱帶性低氣壓";
  if (maxWind < 32.7) return "輕度颱風";
  if (maxWind < 51.0) return "中度颱風";
  return "強烈颱風";
}

function parseCyclone(c: RawCyclone, index: number): Typhoon | null {
  const past = (c.AnalysisData?.Fix ?? [])
    .map((f) => toFix(f, false))
    .filter((f): f is TyphoonFix => f !== null);
  const forecast = (c.ForecastData?.Fix ?? [])
    .map((f) => toFix(f, true))
    .filter((f): f is TyphoonFix => f !== null)
    .sort((a, b) => (a.tau ?? 0) - (b.tau ?? 0));

  if (past.length === 0 && forecast.length === 0) return null;

  const current = past.length > 0 ? past[past.length - 1] : null;
  const enName = c.TyphoonName?.trim() || null;
  const name =
    c.CwaTyphoonName?.trim() ||
    enName ||
    (c.CwaTyNo ? `颱風 ${c.CwaTyNo}` : `熱帶氣旋 ${index + 1}`);

  return {
    id: String(c.CwaTyNo ?? c.CwaTdNo ?? enName ?? name),
    name,
    enName,
    category: categorize(current?.maxWind ?? forecast[0]?.maxWind ?? null),
    past,
    current,
    forecast,
  };
}

async function crawl(): Promise<Typhoon[]> {
  const json = await fetchRawDataset<RawTyphoonResponse>(DATASET);
  const list = json.records?.TropicalCyclones?.TropicalCyclone ?? [];
  return list
    .map((c, i) => parseCyclone(c, i))
    .filter((t): t is Typhoon => t !== null);
}

/**
 * 取得目前的颱風分析與預報路徑。
 * 記憶體快取新鮮 → 直接回傳；否則抓 CWA → 快取。抓取失敗改用舊快取並標示 stale。
 */
export async function getTyphoons(): Promise<TyphoonResult> {
  const cache = globalForTyphoon.__typhoonCache;
  if (cache) {
    const ttl = cache.result.stale ? STALE_RETRY_SECONDS : TTL_SECONDS;
    if ((Date.now() - cache.at) / 1000 < ttl) {
      return { ...cache.result, cached: true };
    }
  }

  try {
    const typhoons = await crawl();
    const result: TyphoonResult = {
      typhoons,
      fetchedAt: new Date().toISOString(),
      cached: false,
      stale: false,
    };
    globalForTyphoon.__typhoonCache = { result, at: Date.now() };
    return result;
  } catch (err) {
    // 抓取失敗：若有舊快取則沿用並標示 stale，否則往上拋。
    if (cache) {
      const result: TyphoonResult = { ...cache.result, cached: false, stale: true };
      globalForTyphoon.__typhoonCache = { result, at: Date.now() };
      return result;
    }
    throw err;
  }
}
