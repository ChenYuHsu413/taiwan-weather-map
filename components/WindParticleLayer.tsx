"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { WeatherFeature } from "@/lib/types";
import type { GfsWindGrid } from "@/lib/gfs-wind";

interface WindVector {
  lng: number;
  lat: number;
  u: number; // eastward m/s
  v: number; // northward m/s
  speed: number;
}

// /api/wind 回傳 GfsWindGrid 外加快取旗標；直接讀靜態檔時旗標為 undefined。
type WindGrid = GfsWindGrid & { stale?: boolean; fallback?: string };

// 資料代表時刻超過此時數就提示可能過時。
const STALE_WARN_HOURS = 12;

function isWindGrid(json: unknown): json is WindGrid {
  const j = json as Partial<WindGrid> | null;
  return !!j && !!j.grid && Array.isArray(j.u) && Array.isArray(j.v);
}

/** 資料代表時刻：優先用 validAt，舊版靜態檔沒有就由 run 推算。 */
function windValidTime(g: WindGrid): Date {
  if (g.validAt) return new Date(g.validAt);
  const { date, cycle, forecastHour } = g.run;
  return new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(4, 6)) - 1,
      Number(date.slice(6, 8)),
      Number(cycle) + forecastHour
    )
  );
}

/** 例：「GFS 09/03 06Z +3h」 */
function runLabel(g: WindGrid): string {
  const { date, cycle, forecastHour } = g.run;
  return `GFS ${date.slice(4, 6)}/${date.slice(6, 8)} ${cycle}Z +${forecastHour}h`;
}

function fmtLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

interface Particle {
  x: number;
  y: number;
  age: number;
  maxAge: number;
}

// 固定「密度」而非固定「數量」：粒子數依畫布面積計算，避免小螢幕（手機）
// 因同樣的粒子數擠在較小畫布而顯得過密、像暴風。以桌機觀感為基準校準。
const AREA_PER_PARTICLE = 580; // 每顆粒子分攤的畫布面積（px²）
const MIN_PARTICLES = 400;
const MAX_PARTICLES = 2400;
const MAX_AGE_MIN = 85;
const MAX_AGE_SPAN = 90;
const PX_PER_MS = 0.6;

function particleCount(width: number, height: number): number {
  const n = Math.round((width * height) / AREA_PER_PARTICLE);
  return Math.max(MIN_PARTICLES, Math.min(MAX_PARTICLES, n));
}

function stationToVector(f: WeatherFeature): WindVector | null {
  const speed = f.properties.windSpeed;
  const direction = f.properties.windDirection;
  if (speed === null || direction === null || speed <= 0) return null;

  const [lng, lat] = f.geometry.coordinates;
  // CWA windDirection is the direction wind comes from. Particle motion should
  // move toward the direction the wind is going to.
  const toRad = (((direction + 180) % 360) * Math.PI) / 180;
  return {
    lng,
    lat,
    u: speed * Math.sin(toRad),
    v: speed * Math.cos(toRad),
    speed,
  };
}

function randomParticle(width: number, height: number): Particle {
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    age: Math.floor(Math.random() * MAX_AGE_MIN),
    maxAge: MAX_AGE_MIN + Math.floor(Math.random() * MAX_AGE_SPAN),
  };
}

function interpolateWind(
  lng: number,
  lat: number,
  vectors: WindVector[]
): { u: number; v: number; speed: number } | null {
  if (vectors.length === 0) return null;

  let sumU = 0;
  let sumV = 0;
  let sumW = 0;
  for (const vec of vectors) {
    const dx = (vec.lng - lng) * Math.cos((lat * Math.PI) / 180);
    const dy = vec.lat - lat;
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-8) {
      return { u: vec.u, v: vec.v, speed: vec.speed };
    }
    const w = 1 / d2;
    sumU += vec.u * w;
    sumV += vec.v * w;
    sumW += w;
  }

  if (sumW === 0) return null;
  const u = sumU / sumW;
  const v = sumV / sumW;
  return { u, v, speed: Math.hypot(u, v) };
}

function interpolateGridWind(
  lng: number,
  lat: number,
  windGrid: WindGrid | null
): { u: number; v: number; speed: number } | null {
  if (!windGrid) return null;

  const { nx, ny, lo1, la1, la2, dx, dy } = windGrid.grid;
  if (nx < 2 || ny < 2 || windGrid.u.length !== nx * ny || windGrid.v.length !== nx * ny) {
    return null;
  }

  const x = (lng - lo1) / dx;
  const y = la1 <= la2 ? (lat - la1) / dy : (la1 - lat) / dy;
  if (x < 0 || y < 0 || x > nx - 1 || y > ny - 1) return null;

  const x0 = Math.min(nx - 1, Math.floor(x));
  const y0 = Math.min(ny - 1, Math.floor(y));
  const x1 = Math.min(nx - 1, x0 + 1);
  const y1 = Math.min(ny - 1, y0 + 1);
  const tx = x1 === x0 ? 0 : x - x0;
  const ty = y1 === y0 ? 0 : y - y0;

  const idx = (xx: number, yy: number) => yy * nx + xx;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const sample = (arr: number[]) => {
    const a = lerp(arr[idx(x0, y0)], arr[idx(x1, y0)], tx);
    const b = lerp(arr[idx(x0, y1)], arr[idx(x1, y1)], tx);
    return lerp(a, b, ty);
  };

  const u = sample(windGrid.u);
  const v = sample(windGrid.v);
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  return { u, v, speed: Math.hypot(u, v) };
}

// 全程冷色系（藍→淡青→米白），避免強風出現黃/橘的「警報感」。
// 海上風速偏高，暖色會讓海面看起來像暴風，故拿掉暖色端。
function particleColor(speed: number): string {
  if (speed < 4) return "rgba(120, 174, 226, 0.55)";
  if (speed < 8) return "rgba(150, 200, 224, 0.6)";
  if (speed < 12) return "rgba(180, 214, 220, 0.62)";
  if (speed < 16) return "rgba(198, 220, 214, 0.64)";
  return "rgba(210, 224, 208, 0.66)";
}

// 每幀位移的軟上限（px）：超過門檻的部分以開根號壓縮，讓海上強風不再拉出
// 誇張的高速長條，但仍保留方向與相對快慢。陸地低速風幾乎不受影響。
const DISP_SOFT = 2.5;

function softCompress(dx: number, dy: number): [number, number] {
  const disp = Math.hypot(dx, dy);
  if (disp <= DISP_SOFT) return [dx, dy];
  const k = (DISP_SOFT + Math.sqrt(disp - DISP_SOFT)) / disp;
  return [dx * k, dy * k];
}

function resizeCanvas(map: L.Map, canvas: HTMLCanvasElement) {
  const size = map.getSize();
  const topLeft = map.containerPointToLayerPoint([0, 0]);
  L.DomUtil.setPosition(canvas, topLeft);
  canvas.width = size.x;
  canvas.height = size.y;
  canvas.style.width = `${size.x}px`;
  canvas.style.height = `${size.y}px`;
}

export default function WindParticleLayer({
  features,
}: {
  features: WeatherFeature[];
}) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const [windGrid, setWindGrid] = useState<WindGrid | null>(null);

  const vectors = useMemo(
    () => features.map(stationToVector).filter((v): v is WindVector => v !== null),
    [features]
  );

  // 先讀 /api/wind（快取 + 自動更新）；API 整個失敗才直接讀靜態備援檔。
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<WindGrid | null> => {
      try {
        const res = await fetch("/api/wind");
        const json: unknown = res.ok ? await res.json() : null;
        if (isWindGrid(json)) return json;
      } catch {
        // fall through
      }
      try {
        const res = await fetch("/data/gfs-wind.json", { cache: "no-store" });
        const json: unknown = res.ok ? await res.json() : null;
        if (isWindGrid(json)) return { ...json, stale: true, fallback: "static" };
      } catch {
        // fall through
      }
      return null;
    };
    load().then((grid) => {
      if (!cancelled) setWindGrid(grid);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!windGrid && vectors.length < 3) return;

    const canvas = L.DomUtil.create(
      "canvas",
      "leaflet-wind-particles"
    ) as HTMLCanvasElement;
    canvas.style.position = "absolute";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "320";
    canvasRef.current = canvas;
    map.getPanes().overlayPane.appendChild(canvas);
    resizeCanvas(map, canvas);

    const resetParticles = () => {
      const count = particleCount(canvas.width, canvas.height);
      particlesRef.current = Array.from({ length: count }, () =>
        randomParticle(canvas.width, canvas.height)
      );
    };
    resetParticles();

    const handleMapChange = () => {
      resizeCanvas(map, canvas);
      resetParticles();
    };

    map.on("move zoom resize", handleMapChange);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const width = canvas.width;
      const height = canvas.height;
      const zoomScale = Math.max(0.75, Math.min(1.15, map.getZoom() / 9));

      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = "rgba(0, 0, 0, 0.86)";
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "source-over";
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";

      const particles = particlesRef.current;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (
          p.age > p.maxAge ||
          p.x < -20 ||
          p.y < -20 ||
          p.x > width + 20 ||
          p.y > height + 20
        ) {
          particles[i] = randomParticle(width, height);
          continue;
        }

        const ll = map.containerPointToLatLng([p.x, p.y]);
        const wind = windGrid
          ? interpolateGridWind(ll.lng, ll.lat, windGrid)
          : interpolateWind(ll.lng, ll.lat, vectors);
        if (!wind || wind.speed < 0.1) {
          p.age = p.maxAge + 1;
          continue;
        }

        const x0 = p.x;
        const y0 = p.y;
        const [dx, dy] = softCompress(
          wind.u * PX_PER_MS * zoomScale,
          -wind.v * PX_PER_MS * zoomScale
        );
        p.x += dx;
        p.y += dy;
        p.age += 1;

        ctx.strokeStyle = particleColor(wind.speed);
        ctx.globalAlpha = Math.max(0.22, Math.min(0.5, wind.speed / 24));
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      map.off("move zoom resize", handleMapChange);
      canvas.remove();
      canvasRef.current = null;
      particlesRef.current = [];
    };
  }, [map, vectors, windGrid]);

  if (!windGrid) return null;

  const ageHours = (Date.now() - windValidTime(windGrid).getTime()) / 3600 / 1000;
  const outdated = ageHours > STALE_WARN_HOURS;

  // 圖層角落的小標籤：資料來源 run 與更新時間。手機版避開底部控制列。
  return (
    <div className="pointer-events-none absolute bottom-[136px] left-1/2 z-[900] -translate-x-1/2 md:bottom-4">
      <div
        className={`whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] shadow backdrop-blur ${
          outdated ? "bg-amber-500/20 text-amber-200" : "bg-panel text-gray-300"
        }`}
        title={`資料時刻 ${fmtLocal(windValidTime(windGrid).toISOString())}`}
      >
        <span className="font-semibold text-gray-100">{runLabel(windGrid)}</span>
        <span className="ml-2">更新 {fmtLocal(windGrid.fetchedAt)}</span>
        {windGrid.stale && <span className="ml-2 text-amber-300">備援</span>}
        {outdated && <span className="ml-2">⚠️ 風場資料可能過時</span>}
      </div>
    </div>
  );
}
