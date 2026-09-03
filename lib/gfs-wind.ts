// NOAA GFS 10m 風場：NOMADS 下載 + GRIB2 (simple packing) 解碼。
// 純函式、不碰資料庫；同時供 /api/wind（Node runtime）與 scripts/fetch-gfs-wind.mjs 使用。
// 此檔刻意不 import 任何模組（含 "@/" 別名），讓 Node 以 type-stripping 直接執行。

export interface GfsRun {
  date: string; // YYYYMMDD（UTC）
  cycle: string; // "00" | "06" | "12" | "18"
  forecastHour: number; // 0, 3, 6 …
}

export interface GfsGridMeta {
  pointCount: number;
  nx: number;
  ny: number;
  lo1: number;
  la1: number;
  lo2: number;
  la2: number;
  dx: number;
  dy: number;
  scanMode: number;
}

export interface GfsWindGrid {
  source: string;
  sourceUrl: string;
  fetchedAt: string; // 後端實際下載時間（ISO）
  validAt: string; // 資料代表時刻 = cycle 起報時間 + forecastHour（ISO）
  run: GfsRun;
  bbox: { leftlon: number; rightlon: number; bottomlat: number; toplat: number };
  grid: GfsGridMeta;
  u: number[];
  v: number[];
}

export const GFS_BBOX = { leftlon: 110, rightlon: 132, bottomlat: 12, toplat: 34 };

// NOMADS 通常在起報後 3.5～5 小時才發布；未滿此時數的 cycle 直接略過不浪費請求。
const MIN_CYCLE_AGE_HOURS = 3;
// 只用 3 小時一格的預報時距，最多退到 +12h（再往後就該用下一個 cycle 了）。
const FORECAST_STEP_HOURS = 3;
const MAX_FORECAST_HOUR = 12;
const MAX_ATTEMPTS = 4;
const FETCH_TIMEOUT_MS = 25000;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function pad3(value: number): string {
  return String(value).padStart(3, "0");
}

/** 由 run 推回起報時刻（UTC）。 */
export function cycleStart(run: Pick<GfsRun, "date" | "cycle">): Date {
  return new Date(
    Date.UTC(
      Number(run.date.slice(0, 4)),
      Number(run.date.slice(4, 6)) - 1,
      Number(run.date.slice(6, 8)),
      Number(run.cycle)
    )
  );
}

/** 資料代表時刻 = 起報時刻 + forecastHour。 */
export function validTime(run: GfsRun): Date {
  return new Date(cycleStart(run).getTime() + run.forecastHour * 3600 * 1000);
}

/**
 * 依「現在」挑選候選 (date, cycle, forecastHour)，新到舊排序。
 * 每個 cycle 取離現在最近的 3 小時預報時距，讓資料時刻盡量貼近現在；
 * 最新 cycle 若尚未發布（下載失敗），呼叫端會自然退到下一個候選。
 */
export function candidateRuns(now: Date = new Date()): GfsRun[] {
  const out: GfsRun[] = [];
  const nowMs = now.getTime();
  const sixHoursMs = 6 * 3600 * 1000;
  const latestCycleMs = Math.floor(nowMs / sixHoursMs) * sixHoursMs;

  for (let i = 0; out.length < MAX_ATTEMPTS && i < 12; i++) {
    const start = new Date(latestCycleMs - i * sixHoursMs);
    const ageHours = (nowMs - start.getTime()) / 3600 / 1000;
    if (ageHours < MIN_CYCLE_AGE_HOURS) continue;

    const rawHour = Math.round(ageHours / FORECAST_STEP_HOURS) * FORECAST_STEP_HOURS;
    const forecastHour = Math.max(0, Math.min(MAX_FORECAST_HOUR, rawHour));
    out.push({
      date: `${start.getUTCFullYear()}${pad2(start.getUTCMonth() + 1)}${pad2(
        start.getUTCDate()
      )}`,
      cycle: pad2(start.getUTCHours()),
      forecastHour,
    });
  }
  return out;
}

export function gfsUrl(run: GfsRun): string {
  const params = new URLSearchParams({
    dir: `/gfs.${run.date}/${run.cycle}/atmos`,
    file: `gfs.t${run.cycle}z.pgrb2.0p25.f${pad3(run.forecastHour)}`,
    lev_10_m_above_ground: "on",
    var_UGRD: "on",
    var_VGRD: "on",
    subregion: "",
    leftlon: String(GFS_BBOX.leftlon),
    rightlon: String(GFS_BBOX.rightlon),
    toplat: String(GFS_BBOX.toplat),
    bottomlat: String(GFS_BBOX.bottomlat),
  });
  return `https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl?${params}`;
}

// ---- GRIB2 解碼（只支援 grid template 0 / product template 0 / simple packing）----

interface GribRepresentation {
  pointCount: number;
  referenceValue: number;
  binaryScaleFactor: number;
  decimalScaleFactor: number;
  numberOfBits: number;
}

interface GribMessage {
  grid?: GfsGridMeta;
  representation?: GribRepresentation;
  dataSection?: { offset: number; length: number };
  parameterCategory?: number;
  parameterNumber?: number;
  forecastTime?: number;
  data: number[];
}

function readUint64(view: DataView, offset: number): number {
  return view.getUint32(offset) * 2 ** 32 + view.getUint32(offset + 4);
}

function readGribCoord(view: DataView, offset: number): number {
  return view.getInt32(offset) / 1e6;
}

class BitReader {
  private readonly bytes: Uint8Array;
  private bit: number;

  constructor(bytes: Uint8Array, offset: number) {
    this.bytes = bytes;
    this.bit = offset * 8;
  }

  read(width: number): number {
    let value = 0;
    for (let i = 0; i < width; i++) {
      const byte = this.bytes[this.bit >> 3];
      const shift = 7 - (this.bit & 7);
      value = (value << 1) | ((byte >> shift) & 1);
      this.bit += 1;
    }
    return value;
  }
}

function unpackSimplePacking(
  view: DataView,
  section: { offset: number },
  pointCount: number,
  rep: GribRepresentation
): number[] {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const reader = new BitReader(bytes, section.offset + 5);
  const binaryScale = 2 ** rep.binaryScaleFactor;
  const decimalScale = 10 ** rep.decimalScaleFactor;
  const out = new Array<number>(pointCount);

  if (rep.numberOfBits === 0) {
    out.fill(rep.referenceValue / decimalScale);
    return out;
  }
  for (let i = 0; i < pointCount; i++) {
    const packed = reader.read(rep.numberOfBits);
    out[i] = (rep.referenceValue + packed * binaryScale) / decimalScale;
  }
  return out;
}

export function parseGrib(buffer: ArrayBuffer): GribMessage[] {
  const view = new DataView(buffer);
  const messages: GribMessage[] = [];
  let offset = 0;

  while (offset <= view.byteLength - 16) {
    if (
      view.getUint8(offset) !== 0x47 ||
      view.getUint8(offset + 1) !== 0x52 ||
      view.getUint8(offset + 2) !== 0x49 ||
      view.getUint8(offset + 3) !== 0x42
    ) {
      offset += 1;
      continue;
    }

    const messageLength = readUint64(view, offset + 8);
    const end = offset + messageLength;
    let sectionOffset = offset + 16;
    const msg: GribMessage = { data: [] };

    while (sectionOffset < end - 4) {
      const length = view.getUint32(sectionOffset);
      const number = view.getUint8(sectionOffset + 4);
      const section = { offset: sectionOffset, length };

      if (number === 3) {
        const base = sectionOffset + 5;
        const template = view.getUint16(base + 7);
        if (template !== 0) throw new Error(`Unsupported grid template ${template}`);
        const gridBase = base + 9;
        msg.grid = {
          pointCount: view.getUint32(base + 1),
          nx: view.getUint32(gridBase + 16),
          ny: view.getUint32(gridBase + 20),
          lo1: readGribCoord(view, gridBase + 36),
          la1: readGribCoord(view, gridBase + 32),
          lo2: readGribCoord(view, gridBase + 45),
          la2: readGribCoord(view, gridBase + 41),
          dx: view.getUint32(gridBase + 49) / 1e6,
          dy: view.getUint32(gridBase + 53) / 1e6,
          scanMode: view.getUint8(gridBase + 57),
        };
      } else if (number === 4) {
        const base = sectionOffset + 5;
        const template = view.getUint16(base + 2);
        if (template !== 0) throw new Error(`Unsupported product template ${template}`);
        msg.parameterCategory = view.getUint8(base + 4);
        msg.parameterNumber = view.getUint8(base + 5);
        msg.forecastTime = view.getUint32(base + 18);
      } else if (number === 5) {
        const base = sectionOffset + 5;
        const template = view.getUint16(base + 4);
        if (template !== 0) {
          throw new Error(`Unsupported data representation template ${template}`);
        }
        msg.representation = {
          pointCount: view.getUint32(base),
          referenceValue: view.getFloat32(base + 6),
          binaryScaleFactor: view.getInt16(base + 10),
          decimalScaleFactor: view.getInt16(base + 12),
          numberOfBits: view.getUint8(base + 14),
        };
      } else if (number === 7) {
        msg.dataSection = section;
      }
      sectionOffset += length;
    }

    if (!msg.grid || !msg.representation || !msg.dataSection) {
      throw new Error("GRIB message missing required grid, representation, or data section");
    }
    msg.data = unpackSimplePacking(
      view,
      msg.dataSection,
      msg.representation.pointCount,
      msg.representation
    );
    messages.push(msg);
    offset = end;
  }

  if (messages.length === 0) throw new Error("No GRIB2 messages found");
  return messages;
}

async function download(url: string): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    // NOMADS 對不存在的檔案有時回 200 + 短 HTML 錯誤頁。
    if (buffer.byteLength < 1000) throw new Error(`too small (${buffer.byteLength} bytes)`);
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

export function buildGrid(run: GfsRun, url: string, buffer: ArrayBuffer): GfsWindGrid {
  const messages = parseGrib(buffer);
  const uMsg = messages.find((m) => m.parameterCategory === 2 && m.parameterNumber === 2);
  const vMsg = messages.find((m) => m.parameterCategory === 2 && m.parameterNumber === 3);
  if (!uMsg?.grid || !vMsg?.grid) {
    throw new Error("NOAA response did not include both UGRD and VGRD");
  }
  const grid = uMsg.grid;
  if (
    grid.nx !== vMsg.grid.nx ||
    grid.ny !== vMsg.grid.ny ||
    grid.lo1 !== vMsg.grid.lo1 ||
    grid.la1 !== vMsg.grid.la1
  ) {
    throw new Error("UGRD and VGRD grids do not match");
  }

  return {
    source: "NOAA GFS 0.25 degree via NOMADS filter_gfs_0p25",
    sourceUrl: url,
    fetchedAt: new Date().toISOString(),
    validAt: validTime(run).toISOString(),
    run,
    bbox: GFS_BBOX,
    grid,
    u: uMsg.data.map((v) => Number(v.toFixed(3))),
    v: vMsg.data.map((v) => Number(v.toFixed(3))),
  };
}

/**
 * 依序嘗試候選 run，下載並解碼第一個成功的。
 * @param log 可選的進度輸出（CLI 用）。
 */
export async function fetchLatestGfsWind(
  log: (msg: string) => void = () => {}
): Promise<GfsWindGrid> {
  const errors: string[] = [];
  for (const run of candidateRuns()) {
    const url = gfsUrl(run);
    const label = `${run.date} ${run.cycle}z f${pad3(run.forecastHour)}`;
    try {
      const buffer = await download(url);
      log(`GFS ${label}: ${buffer.byteLength} bytes`);
      return buildGrid(run, url, buffer);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log(`GFS ${label}: ${reason}`);
      errors.push(`${label}: ${reason}`);
    }
  }
  throw new Error(`Unable to download a recent NOAA GFS wind subset (${errors.join("; ")})`);
}
