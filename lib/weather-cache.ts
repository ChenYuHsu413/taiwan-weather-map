// 按需快取層：記憶體優先，並持久化到 Neon Postgres（跨 serverless 實例共享，
// 冷啟動或換執行個體後仍能回讀最新/舊資料）。
// 同時處理「同一時間多個請求只打一次 CWA」的併發去重，以及抓取失敗時回退舊資料。

import type { CachedWeather } from "./types";
import { fetchDataset, CwaError } from "./cwa";
import { transformToGeoJSON } from "./weather-transform";
import { buildSummary } from "./weather-summary";
import { saveSnapshot, loadLatestSnapshot } from "./weather-store";

const TTL_SECONDS = Number(process.env.WEATHER_CACHE_TTL_SECONDS ?? 600);
const PRIMARY = process.env.CWA_PRIMARY_DATASET ?? "O-A0003-001";
const FALLBACK = process.env.CWA_FALLBACK_DATASET ?? "O-A0001-001";
// 資料缺失嚴重的門檻：有效測站數低於此值就嘗試 fallback。
const MIN_STATIONS = 30;

let memoryCache: CachedWeather | null = null;
let inflight: Promise<CachedWeather> | null = null;

export interface CacheResult {
  payload: CachedWeather;
  cached: boolean; // 是否來自快取（未觸發外部抓取）
  stale: boolean; // 是否為過期但因抓取失敗而沿用的舊資料
}

function ageSeconds(fetchedAt: string): number {
  return (Date.now() - new Date(fetchedAt).getTime()) / 1000;
}

function isFresh(entry: CachedWeather): boolean {
  return ageSeconds(entry.fetchedAt) < TTL_SECONDS;
}

async function readPersistentCache(): Promise<CachedWeather | null> {
  try {
    return await loadLatestSnapshot();
  } catch {
    return null;
  }
}

async function writePersistentCache(entry: CachedWeather): Promise<void> {
  try {
    await saveSnapshot(entry);
  } catch {
    // 寫入 DB 失敗不致命，記憶體快取仍可運作。
  }
}

/** 實際向 CWA 抓取並清洗：先試 primary，資料不足或失敗再試 fallback。 */
async function fetchFresh(): Promise<CachedWeather> {
  const datasets: { id: string; label: string }[] = [
    { id: PRIMARY, label: `CWA ${PRIMARY}` },
    { id: FALLBACK, label: `CWA ${FALLBACK}` },
  ];

  let lastError: unknown = null;

  for (const ds of datasets) {
    try {
      const raw = await fetchDataset(ds.id);
      const geojson = transformToGeoJSON(raw, ds.label);
      if (geojson.features.length < MIN_STATIONS && ds.id === PRIMARY) {
        // primary 資料缺失嚴重，改試 fallback。
        lastError = new CwaError(
          `primary 有效測站僅 ${geojson.features.length} 筆，嘗試 fallback`,
          ds.id
        );
        continue;
      }
      const summary = buildSummary(geojson);
      return {
        data: geojson,
        summary,
        source: ds.label,
        updatedAt: geojson.updatedAt,
        fetchedAt: new Date().toISOString(),
        stationCount: geojson.features.length,
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError ?? new Error("CWA 資料抓取失敗");
}

/**
 * 取得當前氣象資料。
 * 流程：記憶體/DB 快取新鮮 → 直接回傳；過期或無 → 抓取新資料；
 * 抓取失敗但有舊快取 → 回傳舊快取並標示 stale（避免 502）。
 */
export async function getCurrentWeather(): Promise<CacheResult> {
  // 1. 記憶體快取新鮮，直接回傳。
  if (memoryCache && isFresh(memoryCache)) {
    return { payload: memoryCache, cached: true, stale: false };
  }

  // 2. 記憶體沒有時，載入持久化快取（伺服器剛重啟／換實例的情況）。
  if (!memoryCache) {
    const persisted = await readPersistentCache();
    if (persisted) {
      memoryCache = persisted;
      if (isFresh(persisted)) {
        return { payload: persisted, cached: true, stale: false };
      }
    }
  }

  // 3. 需要抓新資料。以 inflight 併發去重，避免多請求同時打 CWA。
  if (!inflight) {
    inflight = fetchFresh().finally(() => {
      inflight = null;
    });
  }

  try {
    const fresh = await inflight;
    memoryCache = fresh;
    await writePersistentCache(fresh);
    return { payload: fresh, cached: false, stale: false };
  } catch (err) {
    // 4. 抓取失敗：若有舊快取，回傳 stale 舊資料。
    if (memoryCache) {
      return { payload: memoryCache, cached: true, stale: true };
    }
    throw err;
  }
}
