// 視覺化色階與尺寸對應（前後端皆可用，無副作用）。

export interface ScaleStop {
  max: number; // 小於等於此值套用此顏色（最後一段為 Infinity）
  color: string;
  label: string;
}

// 氣溫色階（°C）：藍 → 綠 → 黃 → 橘 → 紅。
export const TEMP_STOPS: ScaleStop[] = [
  { max: 5, color: "#2c7bb6", label: "< 5" },
  { max: 10, color: "#5aa2cf", label: "5–10" },
  { max: 15, color: "#abd9e9", label: "10–15" },
  { max: 20, color: "#7fcdbb", label: "15–20" },
  { max: 24, color: "#d9ef8b", label: "20–24" },
  { max: 28, color: "#fee08b", label: "24–28" },
  { max: 32, color: "#fdae61", label: "28–32" },
  { max: 36, color: "#f46d43", label: "32–36" },
  { max: Infinity, color: "#d73027", label: "≥ 36" },
];

// 風速色階（m/s），對應蒲福風級概念。
export const WIND_STOPS: ScaleStop[] = [
  { max: 2, color: "#4575b4", label: "< 2" },
  { max: 5, color: "#74add1", label: "2–5" },
  { max: 8, color: "#abd9e9", label: "5–8" },
  { max: 11, color: "#fee090", label: "8–11" },
  { max: 14, color: "#fdae61", label: "11–14" },
  { max: 17, color: "#f46d43", label: "14–17" },
  { max: Infinity, color: "#d73027", label: "≥ 17" },
];

// 雨量填色色階（mm）：無雨透明感 → 綠 → 黃 → 橘 → 紅 → 紫。
export const PRECIP_STOPS: ScaleStop[] = [
  { max: 1, color: "#c7e9e0", label: "< 1" },
  { max: 5, color: "#7fcdbb", label: "1–5" },
  { max: 10, color: "#41b6c4", label: "5–10" },
  { max: 20, color: "#1d91c0", label: "10–20" },
  { max: 40, color: "#fee08b", label: "20–40" },
  { max: 80, color: "#fdae61", label: "40–80" },
  { max: 130, color: "#f46d43", label: "80–130" },
  { max: Infinity, color: "#9e0142", label: "≥ 130" },
];

// 濕度色階（%）：乾（棕）→ 濕（藍）。
export const HUMIDITY_STOPS: ScaleStop[] = [
  { max: 40, color: "#d8b365", label: "< 40" },
  { max: 60, color: "#f6e8c3", label: "40–60" },
  { max: 75, color: "#c7eae5", label: "60–75" },
  { max: 90, color: "#5ab4ac", label: "75–90" },
  { max: Infinity, color: "#01665e", label: "≥ 90" },
];

const NO_DATA_COLOR = "#9ca3af";

function colorFromStops(value: number | null, stops: ScaleStop[]): string {
  if (value === null) return NO_DATA_COLOR;
  for (const s of stops) {
    if (value <= s.max) return s.color;
  }
  return stops[stops.length - 1].color;
}

export function temperatureColor(value: number | null): string {
  return colorFromStops(value, TEMP_STOPS);
}

export function windColor(value: number | null): string {
  return colorFromStops(value, WIND_STOPS);
}

export function humidityColor(value: number | null): string {
  return colorFromStops(value, HUMIDITY_STOPS);
}

export function precipitationColor(value: number | null): string {
  return colorFromStops(value, PRECIP_STOPS);
}

export const NODATA_COLOR = NO_DATA_COLOR;

// ── 連續漸層色階（供逐像素填色場使用，回傳 RGBA）──────────────

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

interface RampStop {
  v: number;
  c: Rgb;
}

const TEMP_RAMP: RampStop[] = [
  { v: 5, c: hexToRgb("#2c7bb6") },
  { v: 10, c: hexToRgb("#5aa2cf") },
  { v: 15, c: hexToRgb("#abd9e9") },
  { v: 20, c: hexToRgb("#7fcdbb") },
  { v: 24, c: hexToRgb("#d9ef8b") },
  { v: 28, c: hexToRgb("#fee08b") },
  { v: 32, c: hexToRgb("#fdae61") },
  { v: 36, c: hexToRgb("#f46d43") },
  { v: 40, c: hexToRgb("#d73027") },
];

const PRECIP_RAMP: RampStop[] = [
  { v: 0.5, c: hexToRgb("#c7e9e0") },
  { v: 5, c: hexToRgb("#7fcdbb") },
  { v: 10, c: hexToRgb("#41b6c4") },
  { v: 20, c: hexToRgb("#1d91c0") },
  { v: 40, c: hexToRgb("#fee08b") },
  { v: 80, c: hexToRgb("#fdae61") },
  { v: 130, c: hexToRgb("#f46d43") },
  { v: 200, c: hexToRgb("#9e0142") },
];

function rampRgb(v: number, stops: RampStop[]): Rgb {
  if (v <= stops[0].v) return stops[0].c;
  const last = stops[stops.length - 1];
  if (v >= last.v) return last.c;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (v >= a.v && v <= b.v) {
      const t = (v - a.v) / (b.v - a.v);
      return [
        Math.round(a.c[0] + (b.c[0] - a.c[0]) * t),
        Math.round(a.c[1] + (b.c[1] - a.c[1]) * t),
        Math.round(a.c[2] + (b.c[2] - a.c[2]) * t),
      ];
    }
  }
  return last.c;
}

export type Rgba = [number, number, number, number];

export function temperatureRampColor(v: number): Rgba {
  const c = rampRgb(v, TEMP_RAMP);
  return [c[0], c[1], c[2], 255];
}

/** 雨量漸層；< 0.5mm 視為無雨，回傳全透明。 */
export function precipitationRampColor(v: number): Rgba {
  if (v < 0.5) return [0, 0, 0, 0];
  const c = rampRgb(v, PRECIP_RAMP);
  return [c[0], c[1], c[2], 255];
}

/**
 * 雨量 → 圓圈半徑（像素）。用 sqrt 讓面積與雨量約略成正比，
 * 並限制最大半徑避免遮住地圖。
 */
export function precipitationRadius(mm: number | null): number {
  if (mm === null || mm <= 0) return 4;
  const r = 4 + Math.sqrt(mm) * 3.2;
  return Math.min(r, 34);
}
