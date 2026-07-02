// 各縣市今明 36 小時天氣預報（CWA 開放資料 F-C0032-001）。
// 與觀測資料相同的 API+DB 模式：抓 API → 解析 → upsert 進 DB → 讀回；記憶體快取 3 小時。

import { sql, ensureSchema } from "./db";

const CWA_BASE = "https://opendata.cwa.gov.tw/api/v1/rest/datastore";
const DATASET = "F-C0032-001";
const TTL_SECONDS = Number(process.env.FORECAST_CACHE_TTL_SECONDS ?? 3 * 3600);
const TIMEOUT_MS = 15000;

export interface ForecastPeriod {
  start: string | null;
  end: string | null;
  wx: string | null; // 天氣現象描述，如「多雲時陰短暫雨」
  pop: number | null; // 降雨機率 %
  minT: number | null; // 最低溫 °C
  maxT: number | null; // 最高溫 °C
  ci: string | null; // 舒適度描述
}

export interface CountyForecast {
  county: string;
  periods: ForecastPeriod[];
}

export interface ForecastResult {
  forecast: CountyForecast[];
  fetchedAt: string;
  cached: boolean;
  stale: boolean;
}

const globalForForecast = globalThis as unknown as {
  __forecastCache?: { result: ForecastResult; at: number };
};

// ---- CWA F-C0032-001 原始結構（欄位皆防禦性處理）----
interface CwaTime {
  startTime?: string;
  endTime?: string;
  parameter?: { parameterName?: string; parameterValue?: string };
}
interface CwaElement {
  elementName?: string;
  time?: CwaTime[];
}
interface CwaLocation {
  locationName?: string;
  weatherElement?: CwaElement[];
}
interface CwaForecastResponse {
  records?: { location?: CwaLocation[] };
}

function num(s: string | undefined | null): number | null {
  if (s == null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 抓取並解析 F-C0032-001 為逐縣市預報。 */
async function crawlForecast(): Promise<CountyForecast[]> {
  const key = process.env.CWA_API_KEY;
  if (!key) throw new Error("缺少 CWA_API_KEY 環境變數");
  const url = `${CWA_BASE}/${DATASET}?Authorization=${encodeURIComponent(
    key
  )}&format=JSON`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`CWA F-C0032-001 HTTP ${res.status}`);
    const json = (await res.json()) as CwaForecastResponse;
    const locations = json.records?.location ?? [];
    if (locations.length === 0) throw new Error("F-C0032-001 無縣市預報資料");

    return locations
      .map((loc): CountyForecast | null => {
        const county = loc.locationName;
        if (!county) return null;
        const el = (name: string) =>
          loc.weatherElement?.find((e) => e.elementName === name)?.time ?? [];
        const wx = el("Wx");
        const pop = el("PoP");
        const minT = el("MinT");
        const maxT = el("MaxT");
        const ci = el("CI");
        const periods: ForecastPeriod[] = wx.map((t, i) => ({
          start: t.startTime ?? null,
          end: t.endTime ?? null,
          wx: t.parameter?.parameterName ?? null,
          pop: num(pop[i]?.parameter?.parameterName),
          minT: num(minT[i]?.parameter?.parameterName),
          maxT: num(maxT[i]?.parameter?.parameterName),
          ci: ci[i]?.parameter?.parameterName ?? null,
        }));
        return { county, periods };
      })
      .filter((f): f is CountyForecast => f !== null);
  } finally {
    clearTimeout(timer);
  }
}

/** upsert 逐縣市預報到資料庫（單條多列）。 */
async function upsertForecast(list: CountyForecast[]): Promise<void> {
  if (list.length === 0) return;
  const updatedAt = new Date().toISOString();
  const cols = 3; // county, periods, updated_at
  const values: unknown[] = [];
  const tuples: string[] = [];
  list.forEach((f, i) => {
    const b = i * cols;
    tuples.push(`($${b + 1}, $${b + 2}, $${b + 3})`);
    values.push(f.county, JSON.stringify(f.periods), updatedAt);
  });
  await sql.query(
    `INSERT INTO county_forecast (county, periods, updated_at)
     VALUES ${tuples.join(", ")}
     ON CONFLICT (county) DO UPDATE SET
       periods = EXCLUDED.periods,
       updated_at = EXCLUDED.updated_at`,
    values
  );
}

async function readForecastFromDb(): Promise<CountyForecast[]> {
  const { rows } = await sql<{ county: string; periods: ForecastPeriod[] | string }>`
    SELECT county, periods FROM county_forecast ORDER BY county
  `;
  return rows.map((r) => ({
    county: r.county,
    periods:
      typeof r.periods === "string"
        ? (JSON.parse(r.periods) as ForecastPeriod[])
        : r.periods,
  }));
}

/**
 * 取得各縣市預報。記憶體快取 3 小時；過期則爬 API → 寫 DB → 讀回。
 * 爬取失敗改讀 DB 舊資料並標示 stale。
 */
export async function getForecast(): Promise<ForecastResult> {
  const cache = globalForForecast.__forecastCache;
  if (cache && (Date.now() - cache.at) / 1000 < TTL_SECONDS) {
    return { ...cache.result, cached: true };
  }

  await ensureSchema();
  let stale = false;
  try {
    const parsed = await crawlForecast();
    await upsertForecast(parsed);
  } catch {
    stale = true;
  }

  const forecast = await readForecastFromDb();
  const result: ForecastResult = {
    forecast,
    fetchedAt: new Date().toISOString(),
    cached: false,
    stale,
  };
  globalForForecast.__forecastCache = { result, at: Date.now() };
  return result;
}
