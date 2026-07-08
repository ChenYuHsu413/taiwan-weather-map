// 颱風時間軸（前端）：把官方分析＋預報定位點攤平成「依時間排序的時刻軸」，
// 並提供在任意時間內插颱風狀態（位置／氣壓／風速／暴風圈）的取樣函式，
// 讓時間軸播放時颱風中心能像 Windy 一樣平滑移動，而非一格一格跳。

import type { Typhoon, TyphoonFix } from "./types";

export interface TyMoment {
  t: number; // 有效時刻（unix ms）
  lat: number;
  lng: number;
  pressure: number | null;
  maxWind: number | null;
  stormRadius: number | null; // 七級風半徑 km
  severeRadius: number | null; // 十級風半徑 km
  isForecast: boolean;
}

export interface TyTrack {
  id: string;
  name: string;
  moments: TyMoment[];
}

export interface TyTimeline {
  tracks: TyTrack[];
  tMin: number;
  tMax: number;
  tCurrent: number; // 目前中心（最新分析）時刻；播放預設落點
  ticks: number[]; // 全部 fix 時刻（去重排序），供刻度使用
}

/** 依近中心最大風速（m/s）推定強度分級（與後端一致）。 */
export function categorize(maxWind: number | null): string | null {
  if (maxWind === null) return null;
  if (maxWind < 17.2) return "熱帶性低氣壓";
  if (maxWind < 32.7) return "輕度颱風";
  if (maxWind < 51.0) return "中度颱風";
  return "強烈颱風";
}

/** fix 的有效時刻：分析點＝DateTime；預報點＝InitialTime＋tau 小時。 */
function fixTime(fix: TyphoonFix): number | null {
  if (fix.time === null) return null;
  const base = new Date(fix.time).getTime();
  if (Number.isNaN(base)) return null;
  return fix.tau !== null ? base + fix.tau * 3600_000 : base;
}

function toMoment(fix: TyphoonFix, isForecast: boolean): TyMoment | null {
  const t = fixTime(fix);
  if (t === null) return null;
  return {
    t,
    lat: fix.lat,
    lng: fix.lng,
    pressure: fix.pressure,
    maxWind: fix.maxWind,
    stormRadius: fix.stormRadius,
    severeRadius: fix.severeRadius,
    isForecast,
  };
}

/** 從颱風清單建立統一時間軸；無任何有效時刻則回傳 null。 */
export function buildTyphoonTimeline(
  typhoons: Typhoon[] | null
): TyTimeline | null {
  if (!typhoons || typhoons.length === 0) return null;

  const tracks: TyTrack[] = [];
  const currents: number[] = [];

  for (const t of typhoons) {
    const moments: TyMoment[] = [];
    for (const f of t.past) {
      const m = toMoment(f, false);
      if (m) moments.push(m);
    }
    for (const f of t.forecast) {
      const m = toMoment(f, true);
      if (m) moments.push(m);
    }
    if (moments.length === 0) continue;
    moments.sort((a, b) => a.t - b.t);
    tracks.push({ id: t.id, name: t.name, moments });

    const past = moments.filter((m) => !m.isForecast);
    if (past.length) currents.push(past[past.length - 1].t);
  }

  if (tracks.length === 0) return null;

  const tMin = Math.min(...tracks.map((tr) => tr.moments[0].t));
  const tMax = Math.max(...tracks.map((tr) => tr.moments[tr.moments.length - 1].t));
  const tCurrent = currents.length ? Math.max(...currents) : tMin;
  const ticks = Array.from(
    new Set(tracks.flatMap((tr) => tr.moments.map((m) => m.t)))
  ).sort((a, b) => a - b);

  return { tracks, tMin, tMax, tCurrent, ticks };
}

/**
 * 在時刻 t 取樣某條軌跡的颱風狀態（位置與強度線性內插）。
 * t 在軌跡範圍外則夾到端點。空軌跡回傳 null。
 */
export function sampleAt(moments: TyMoment[], t: number): TyMoment | null {
  const n = moments.length;
  if (n === 0) return null;
  if (t <= moments[0].t) return moments[0];
  if (t >= moments[n - 1].t) return moments[n - 1];

  let i = 0;
  while (i < n - 1 && moments[i + 1].t <= t) i++;
  const a = moments[i];
  const b = moments[i + 1];
  const f = (t - a.t) / (b.t - a.t);
  const lerp = (x: number | null, y: number | null): number | null =>
    x === null || y === null ? x ?? y : x + (y - x) * f;

  return {
    t,
    lat: a.lat + (b.lat - a.lat) * f,
    lng: a.lng + (b.lng - a.lng) * f,
    pressure: lerp(a.pressure, b.pressure),
    maxWind: lerp(a.maxWind, b.maxWind),
    stormRadius: lerp(a.stormRadius, b.stormRadius),
    severeRadius: lerp(a.severeRadius, b.severeRadius),
    // 恰好落在區段起點（f=0）沿用起點屬性；一旦越過即視為下一點（多為預報）。
    isForecast: f > 0 ? b.isForecast : a.isForecast,
  };
}
