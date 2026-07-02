"use client";

import { useMemo } from "react";
import { ImageOverlay } from "react-leaflet";
import * as turf from "@turf/turf";
import type { FeatureCollection, Position } from "geojson";
import type { WeatherFeature } from "@/lib/types";
import {
  temperatureRampColor,
  precipitationRampColor,
  type Rgba,
} from "@/lib/color-scale";

type FieldKind = "temperature" | "precipitation";

// 畫布最長邊像素數；影像會被瀏覽器平滑放大。
const MAX_DIM = 420;

// Web Mercator 緯度轉換：ImageOverlay 依 Mercator 像素間距拉伸影像，
// 故畫布的 Y 必須用 Mercator，而非線性緯度，才能與 Leaflet 對齊。
const mercY = (latDeg: number) =>
  Math.log(Math.tan(Math.PI / 4 + (latDeg * Math.PI) / 360));
const invMercY = (y: number) =>
  ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;

interface Overlay {
  url: string;
  bounds: [[number, number], [number, number]];
}

function drawLandPath(
  ctx: CanvasRenderingContext2D,
  counties: FeatureCollection,
  minX: number,
  wDeg: number,
  W: number,
  yTop: number,
  yBot: number,
  H: number
) {
  const toX = (lng: number) => ((lng - minX) / wDeg) * W;
  const toY = (lat: number) => ((yTop - mercY(lat)) / (yTop - yBot)) * H;
  for (const f of counties.features) {
    const g = f.geometry;
    const polys: Position[][][] =
      g.type === "Polygon"
        ? [g.coordinates]
        : g.type === "MultiPolygon"
        ? g.coordinates
        : [];
    for (const poly of polys) {
      for (const ring of poly) {
        ring.forEach(([lng, lat], i) => {
          const x = toX(lng);
          const y = toY(lat);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
    }
  }
}

/**
 * 逐像素 IDW 內插測站數值成連續場，畫成點陣圖並裁切到台灣陸地，
 * 以 ImageOverlay 疊在地圖上，呈現接近 Windy 的平滑填色。
 * 中央山脈等測站稀疏處由內插自動補值，不留破洞。
 */
export default function InterpolatedField({
  features,
  counties,
  kind,
}: {
  features: WeatherFeature[];
  counties: FeatureCollection | null;
  kind: FieldKind;
}) {
  const overlay = useMemo<Overlay | null>(() => {
    if (!counties || typeof document === "undefined") return null;
    const metric = kind;
    const lng: number[] = [];
    const lat: number[] = [];
    const val: number[] = [];
    for (const f of features) {
      const v = f.properties[metric];
      if (v === null) continue;
      lng.push(f.geometry.coordinates[0]);
      lat.push(f.geometry.coordinates[1]);
      val.push(v);
    }
    if (val.length < 3) return null;

    const [minX, minY, maxX, maxY] = turf.bbox(counties);
    const wDeg = maxX - minX;
    // Mercator Y 範圍（yTop = 北 = 較大值）。
    const yTop = mercY(maxY);
    const yBot = mercY(minY);
    const mercSpan = yTop - yBot;
    const wRad = (wDeg * Math.PI) / 180;
    // 依 Mercator 長寬比決定畫布尺寸，避免影像被非等向拉伸。
    const scale = MAX_DIM / Math.max(wRad, mercSpan);
    const W = Math.max(1, Math.round(wRad * scale));
    const H = Math.max(1, Math.round(mercSpan * scale));

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const img = ctx.createImageData(W, H);
    const data = img.data;
    const colorFn: (v: number) => Rgba =
      kind === "temperature" ? temperatureRampColor : precipitationRampColor;
    const n = val.length;

    for (let py = 0; py < H; py++) {
      const plat = invMercY(yTop - ((py + 0.5) / H) * mercSpan);
      for (let px = 0; px < W; px++) {
        const plng = minX + ((px + 0.5) / W) * wDeg;
        let num = 0;
        let den = 0;
        let exact = -1;
        for (let i = 0; i < n; i++) {
          const dx = lng[i] - plng;
          const dy = lat[i] - plat;
          const d2 = dx * dx + dy * dy;
          if (d2 < 1e-9) {
            exact = i;
            break;
          }
          const w = 1 / d2; // IDW 冪次 2：權重 = 1/距離平方
          num += w * val[i];
          den += w;
        }
        const value = exact >= 0 ? val[exact] : num / den;
        const [r, g, b, a] = colorFn(value);
        const idx = (py * W + px) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);

    // 裁切到陸地：只保留落在縣市多邊形內的像素。
    ctx.globalCompositeOperation = "destination-in";
    ctx.beginPath();
    drawLandPath(ctx, counties, minX, wDeg, W, yTop, yBot, H);
    ctx.fill();

    return {
      url: canvas.toDataURL(),
      bounds: [
        [minY, minX],
        [maxY, maxX],
      ],
    };
  }, [features, counties, kind]);

  if (!overlay) return null;

  return (
    <ImageOverlay
      key={kind}
      url={overlay.url}
      bounds={overlay.bounds}
      opacity={kind === "temperature" ? 0.75 : 0.7}
    />
  );
}
