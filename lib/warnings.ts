// 中央氣象署「天氣特報」爬蟲。
// 來源：NCDR 民生示警公開資料平台的 CAP Atom feed（公開、免授權碼）。
// 這是真正的「網站爬蟲」：抓取整包 XML、自行解析、篩出氣象署示警、寫入資料庫，
// 前端再以橫幅顯示目前生效中的特報。與氣象觀測用的 CWA 官方 API 是不同來源。

import { sql, ensureSchema } from "./db";

const FEED_URL = "https://alerts.ncdr.nat.gov.tw/RssAtomFeed.ashx";
const CWA_AUTHOR = "中央氣象署";
const TIMEOUT_MS = 20000;
const TTL_SECONDS = Number(process.env.WARNINGS_CACHE_TTL_SECONDS ?? 600);

export interface Warning {
  id: string;
  event: string; // 事件類型，如「降雨」「高溫」「陸上強風」
  headline: string; // 特報全文（可直接顯示）
  effective: string | null; // ISO8601
  expires: string | null; // ISO8601
  updated: string | null; // ISO8601
  capUrl: string | null;
}

export interface WarningsResult {
  warnings: Warning[]; // 目前生效中的特報
  fetchedAt: string;
  cached: boolean;
  stale: boolean; // 爬取失敗、改用 DB 舊資料
}

interface MemoryCache {
  result: WarningsResult;
  at: number;
}
const globalForWarnings = globalThis as unknown as {
  __warningsCache?: MemoryCache;
};

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .trim();
}

function pick(block: string, re: RegExp): string | null {
  const m = block.match(re);
  return m ? m[1] : null;
}

/**
 * 解析 CAP 的在地化時間，例如「2026/7/2 下午 02:35:00」→ ISO8601（+08:00）。
 * 無法解析回 null。
 */
function parseCapTime(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(
    /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(上午|下午)?\s*(\d{1,2}):(\d{2}):(\d{2})/
  );
  if (!m) return null;
  const [, y, mo, d, ampm, hh, mm, ss] = m;
  let hour = Number(hh);
  if (ampm === "下午" && hour < 12) hour += 12;
  if (ampm === "上午" && hour === 12) hour = 0;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${y}-${p(Number(mo))}-${p(Number(d))}T${p(hour)}:${mm}:${ss}+08:00`;
}

/** 抓取整包 feed 並解析出中央氣象署的所有特報（不論是否生效）。 */
async function crawlFeed(): Promise<Warning[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(FEED_URL, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        Accept: "application/xml,text/xml,*/*",
      },
    });
    if (!res.ok) throw new Error(`NCDR feed HTTP ${res.status}`);
    const xml = await res.text();

    const warnings: Warning[] = [];
    for (const raw of xml.split("<entry>").slice(1)) {
      const block = raw.split("</entry>")[0];
      if (!block.includes(`<name>${CWA_AUTHOR}</name>`)) continue;
      const id = pick(block, /<id>([^<]*)<\/id>/);
      if (!id) continue;
      const summary = pick(block, /<summary[^>]*>([\s\S]*?)<\/summary>/);
      warnings.push({
        id,
        event: decodeEntities(pick(block, /<title>([^<]*)<\/title>/) ?? ""),
        headline: summary ? decodeEntities(summary) : "",
        effective: parseCapTime(pick(block, /<cap:effective>([^<]*)<\/cap:effective>/)),
        expires: parseCapTime(pick(block, /<cap:expires>([^<]*)<\/cap:expires>/)),
        updated: pick(block, /<updated>([^<]*)<\/updated>/),
        capUrl: pick(block, /<link[^>]*rel="alternate"[^>]*href="([^"]*)"/),
      });
    }
    return warnings;
  } finally {
    clearTimeout(timer);
  }
}

/** upsert 一批特報到資料庫（單條多列，避免逐筆來回）。 */
async function upsertWarnings(list: Warning[]): Promise<void> {
  if (list.length === 0) return;
  const fetchedAt = new Date().toISOString();
  const cols = 8; // id, event, headline, effective, expires, updated, cap_url, fetched_at
  const values: unknown[] = [];
  const tuples: string[] = [];
  list.forEach((w, i) => {
    const b = i * cols;
    tuples.push(
      `(${Array.from({ length: cols }, (_, k) => `$${b + k + 1}`).join(", ")})`
    );
    values.push(
      w.id,
      w.event,
      w.headline,
      w.effective,
      w.expires,
      w.updated,
      w.capUrl,
      fetchedAt
    );
  });
  await sql.query(
    `INSERT INTO weather_warnings
       (id, event, headline, effective, expires, updated, cap_url, fetched_at)
     VALUES ${tuples.join(", ")}
     ON CONFLICT (id) DO UPDATE SET
       event = EXCLUDED.event,
       headline = EXCLUDED.headline,
       effective = EXCLUDED.effective,
       expires = EXCLUDED.expires,
       updated = EXCLUDED.updated,
       cap_url = EXCLUDED.cap_url,
       fetched_at = EXCLUDED.fetched_at`,
    values
  );
}

/** 從資料庫讀出目前仍生效中的特報（expires 在未來），新到舊。 */
async function getActiveFromDb(): Promise<Warning[]> {
  const { rows } = await sql<{
    id: string;
    event: string | null;
    headline: string | null;
    effective: string | null;
    expires: string | null;
    updated: string | null;
    capUrl: string | null;
  }>`
    SELECT id, event, headline, effective, expires, updated, cap_url AS "capUrl"
    FROM weather_warnings
    WHERE expires IS NULL OR expires > NOW()
    ORDER BY updated DESC NULLS LAST
    LIMIT 50
  `;
  return rows.map((r) => ({
    id: r.id,
    event: r.event ?? "",
    headline: r.headline ?? "",
    effective: r.effective,
    expires: r.expires,
    updated: r.updated,
    capUrl: r.capUrl,
  }));
}

/**
 * 取得目前生效中的天氣特報。
 * 流程：記憶體快取新鮮 → 回傳；否則爬 feed → 寫 DB → 從 DB 讀生效中 → 快取回傳。
 * 爬取失敗 → 改讀 DB 舊資料並標示 stale（不讓前端整個壞掉）。
 */
export async function getWarnings(): Promise<WarningsResult> {
  const cache = globalForWarnings.__warningsCache;
  if (cache && (Date.now() - cache.at) / 1000 < TTL_SECONDS) {
    return { ...cache.result, cached: true };
  }

  await ensureSchema();
  let stale = false;
  try {
    const warnings = await crawlFeed();
    await upsertWarnings(warnings);
  } catch {
    // 爬取失敗不致命：改讀 DB 舊資料並標示 stale。
    stale = true;
  }

  const active = await getActiveFromDb();
  const result: WarningsResult = {
    warnings: active,
    fetchedAt: new Date().toISOString(),
    cached: false,
    stale,
  };
  globalForWarnings.__warningsCache = { result, at: Date.now() };
  return result;
}
