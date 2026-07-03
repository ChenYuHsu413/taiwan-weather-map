"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { WeatherFeature } from "@/lib/types";

interface WindVector {
  lng: number;
  lat: number;
  u: number; // eastward m/s
  v: number; // northward m/s
  speed: number;
}

interface WindGrid {
  source: string;
  fetchedAt: string;
  run: {
    date: string;
    cycle: string;
    forecastHour: number;
  };
  grid: {
    nx: number;
    ny: number;
    lo1: number;
    la1: number;
    lo2: number;
    la2: number;
    dx: number;
    dy: number;
  };
  u: number[];
  v: number[];
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

  useEffect(() => {
    let cancelled = false;
    fetch("/data/gfs-wind.json", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json?.grid && Array.isArray(json.u) && Array.isArray(json.v)) {
          setWindGrid(json as WindGrid);
        }
      })
      .catch(() => {
        if (!cancelled) setWindGrid(null);
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

  return null;
}
