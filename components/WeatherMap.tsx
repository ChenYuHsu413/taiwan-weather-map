"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Circle,
  Marker,
  Polyline,
  Popup,
  GeoJSON,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson";
import type {
  WeatherFeatureCollection,
  WeatherFeature,
  LayerKey,
  Typhoon,
  TyphoonFix,
} from "@/lib/types";
import {
  temperatureColor,
  windColor,
  humidityColor,
} from "@/lib/color-scale";
import WeatherStationPopup from "./WeatherStationPopup";
import InterpolatedField from "./InterpolatedField";
import WindParticleLayer from "./WindParticleLayer";

// 台灣本島 + 離島的初始視角範圍。
const TAIWAN_BOUNDS = L.latLngBounds([21.7, 118.0], [25.5, 122.2]);
const MAP_LIMITS = L.latLngBounds([19.5, 116.0], [27.8, 124.8]);

interface UserLoc {
  lat: number;
  lng: number;
}

export interface RadarFrame {
  time: number; // unix 秒
  path: string;
}

interface Props {
  data: WeatherFeatureCollection;
  mode: LayerKey;
  basemap: "dark" | "osm";
  showCounties: boolean;
  showWindStations: boolean;
  showTempLabels: boolean;
  radar: { host: string; frames: RadarFrame[]; idx: number } | null;
  typhoons: Typhoon[] | null;
  userLocation: UserLoc | null;
  onCountyDetected?: (county: string | null) => void;
}

const BASEMAPS = {
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: "abcd",
  },
  osm: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    subdomains: "abc",
  },
} as const;

/**
 * 雷達回波動畫：預載所有影格的 RainViewer 圖磚（標準 XYZ tiles，正確對齊），
 * 依 idx 切換 opacity 播放，切換瞬間完成（圖磚已快取）。
 */
function RadarFrames({
  host,
  frames,
  idx,
}: {
  host: string;
  frames: RadarFrame[];
  idx: number;
}) {
  return (
    <>
      {frames.map((f, i) => (
        <TileLayer
          key={f.path}
          url={`${host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`}
          opacity={i === idx ? 0.65 : 0}
          zIndex={250}
          // RainViewer 只在 z7 以下有全區覆蓋；z8+ 的外海圖磚會回傳
          // 「Zoom Level Not Supported」佔位圖。故原生只取到 z7，更高層級
          // 由 Leaflet 放大既有圖磚（略糊但連續、不破圖）。
          maxNativeZoom={7}
          maxZoom={19}
          attribution={
            i === 0
              ? '雷達 &copy; <a href="https://www.rainviewer.com/">RainViewer</a>'
              : undefined
          }
        />
      ))}
    </>
  );
}

// 颱風符號 divIcon（旋轉），中心點用。
const typhoonCenterIcon = L.divIcon({
  className: "typhoon-icon",
  html: `<div class="typhoon-eye">🌀</div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

/** 預報點的時距標籤 icon（+24h）。 */
function tauLabelIcon(tau: number): L.DivIcon {
  return L.divIcon({
    className: "typhoon-fix-icon",
    html: `<div class="typhoon-tau">+${tau}h</div>`,
    iconSize: [40, 18],
    iconAnchor: [20, 9],
  });
}

const fmtFixTime = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

/** 颱風定位點的詳情 popup 內容。 */
function TyphoonFixPopup({
  name,
  fix,
  isForecast,
}: {
  name: string;
  fix: TyphoonFix;
  isForecast: boolean;
}) {
  return (
    <div className="text-sm">
      <div className="font-bold text-white">
        🌀 {name}
        {isForecast && fix.tau !== null && (
          <span className="ml-1 text-rose-300">預報 +{fix.tau}h</span>
        )}
      </div>
      <div className="mt-0.5 text-[11px] text-gray-400">
        {isForecast ? "預報基準 " : ""}
        {fmtFixTime(fix.time)}
      </div>
      <dl className="mt-1 grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-gray-200">
        {fix.pressure !== null && (
          <>
            <dt className="text-gray-400">中心氣壓</dt>
            <dd>{fix.pressure} hPa</dd>
          </>
        )}
        {fix.maxWind !== null && (
          <>
            <dt className="text-gray-400">近中心風速</dt>
            <dd>{fix.maxWind} m/s</dd>
          </>
        )}
        {fix.gust !== null && (
          <>
            <dt className="text-gray-400">最大陣風</dt>
            <dd>{fix.gust} m/s</dd>
          </>
        )}
        {fix.radius70 !== null && (
          <>
            <dt className="text-gray-400">70% 機率半徑</dt>
            <dd>{fix.radius70} km</dd>
          </>
        )}
      </dl>
    </div>
  );
}

/**
 * 颱風圖層：過去路徑（實線）＋官方預報路徑（虛線）＋各預報點 70% 機率圈，
 * 中心以旋轉颱風符號標示。資料來自 CWA W-C0034-005。
 */
function TyphoonLayer({ typhoon }: { typhoon: Typhoon }) {
  const { past, current, forecast, name } = typhoon;

  const toLatLng = (f: TyphoonFix): L.LatLngTuple => [f.lat, f.lng];
  const pastLine = past.map(toLatLng);
  // 預報線從目前中心接續。
  const forecastLine = current
    ? [toLatLng(current), ...forecast.map(toLatLng)]
    : forecast.map(toLatLng);

  return (
    <>
      {/* 過去路徑（實線） */}
      {pastLine.length > 1 && (
        <Polyline
          positions={pastLine}
          pathOptions={{ color: "#cbd5e1", weight: 2, opacity: 0.8 }}
        />
      )}

      {/* 預報路徑（虛線） */}
      {forecastLine.length > 1 && (
        <Polyline
          positions={forecastLine}
          pathOptions={{
            color: "#f43f5e",
            weight: 2.5,
            opacity: 0.95,
            dashArray: "6 7",
          }}
        />
      )}

      {/* 過去定位點（小圓點） */}
      {past.slice(0, -1).map((f, i) => (
        <CircleMarker
          key={`past-${i}`}
          center={toLatLng(f)}
          radius={3}
          pathOptions={{
            color: "#e2e8f0",
            weight: 1,
            fillColor: "#94a3b8",
            fillOpacity: 0.9,
          }}
        >
          <Popup>
            <TyphoonFixPopup name={name} fix={f} isForecast={false} />
          </Popup>
        </CircleMarker>
      ))}

      {/* 目前暴風半徑（七級風圈） */}
      {current?.stormRadius && (
        <Circle
          center={toLatLng(current)}
          radius={current.stormRadius * 1000}
          pathOptions={{
            color: "#fbbf24",
            weight: 1,
            opacity: 0.6,
            fillColor: "#fbbf24",
            fillOpacity: 0.12,
          }}
        />
      )}

      {/* 各預報點的 70% 機率圈 + 時距標籤 */}
      {forecast.map((f, i) => (
        <Fragment key={`fc-${i}`}>
          {f.radius70 && (
            <Circle
              center={toLatLng(f)}
              radius={f.radius70 * 1000}
              pathOptions={{
                color: "#f43f5e",
                weight: 1,
                opacity: 0.5,
                dashArray: "3 5",
                fillColor: "#f43f5e",
                fillOpacity: 0.07,
              }}
            />
          )}
          {f.tau !== null && (
            <Marker position={toLatLng(f)} icon={tauLabelIcon(f.tau)}>
              <Popup>
                <TyphoonFixPopup name={name} fix={f} isForecast />
              </Popup>
            </Marker>
          )}
        </Fragment>
      ))}

      {/* 目前中心（旋轉颱風符號） */}
      {current && (
        <Marker position={toLatLng(current)} icon={typhoonCenterIcon} zIndexOffset={1000}>
          <Popup>
            <TyphoonFixPopup name={name} fix={current} isForecast={false} />
          </Popup>
        </Marker>
      )}
    </>
  );
}

/**
 * 進入颱風圖層時，暫時放寬地圖可視/拖曳範圍與最小縮放，並 fitBounds 到
 * 「台灣 + 整條颱風路徑」；離開圖層（元件卸載）時還原為台灣視野。
 * 颱風中心常在西太平洋遠處，需比預設更廣的視野才看得到完整路徑。
 */
function TyphoonView({ typhoons }: { typhoons: Typhoon[] }) {
  const map = useMap();
  useEffect(() => {
    // 聚焦「目前位置 + 預報路徑 + 台灣」；不含週前的遠洋舊軌跡（會使視野過廣）。
    const pts: L.LatLngTuple[] = [];
    for (const t of typhoons) {
      if (t.current) pts.push([t.current.lat, t.current.lng]);
      for (const f of t.forecast) pts.push([f.lat, f.lng]);
    }
    if (pts.length === 0) return;

    const bounds = L.latLngBounds(pts).extend(TAIWAN_BOUNDS);
    const prevMinZoom = map.getMinZoom();
    map.setMinZoom(3);
    // 移除台灣周邊的硬邊界，讓使用者可拖曳看到遠處颱風。
    map.setMaxBounds(null as unknown as L.LatLngBounds);
    map.fitBounds(bounds, { padding: [40, 40], animate: false });

    return () => {
      map.setMinZoom(prevMinZoom);
      map.setMaxBounds(MAP_LIMITS);
      map.fitBounds(TAIWAN_BOUNDS, { animate: false });
    };
  }, [typhoons, map]);
  return null;
}

/** 使用者定位後平滑移動到該位置。 */
function FlyToUser({ loc }: { loc: UserLoc | null }) {
  const map = useMap();
  useEffect(() => {
    if (loc) map.flyTo([loc.lat, loc.lng], 11, { duration: 1.2 });
  }, [loc, map]);
  return null;
}

function windArrowIcon(direction: number, speed: number | null): L.DivIcon {
  const value = speed ?? 0;
  const color = windColor(speed);
  const rotate = (direction + 180) % 360;
  const size = Math.max(22, Math.min(42, 22 + value * 2.4));
  const center = size / 2;
  const tipY = 3;
  const tailY = size - 4;
  const wing = Math.max(4, size * 0.17);
  const html =
    `<div class="wind-vector-label" title="${value.toFixed(1)} m/s">` +
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(${rotate}deg)">` +
    `<path d="M${center} ${tipY} L${center + wing} ${tailY} L${center} ${
      tailY - wing * 0.9
    } L${center - wing} ${tailY} Z" fill="${color}" stroke="rgba(255,255,255,0.85)" stroke-width="0.8"/>` +
    `</svg></div>`;
  return L.divIcon({
    className: "wind-arrow",
    html,
    iconSize: [size, size],
    iconAnchor: [center, center],
  });
}

export default function WeatherMap({
  data,
  mode,
  basemap,
  showCounties,
  showWindStations,
  showTempLabels,
  radar,
  typhoons,
  userLocation,
  onCountyDetected,
}: Props) {
  const [counties, setCounties] = useState<FeatureCollection | null>(null);
  const [userCounty, setUserCounty] = useState<string | null>(null);

  // 載入縣市界線 GeoJSON。
  useEffect(() => {
    let cancelled = false;
    fetch("/data/taiwan-counties.geojson")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j) setCounties(j as FeatureCollection);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // 使用者定位後，用 turf 判斷所在縣市。
  useEffect(() => {
    if (!userLocation || !counties) {
      setUserCounty(null);
      return;
    }
    const pt = turf.point([userLocation.lng, userLocation.lat]);
    let found: string | null = null;
    for (const f of counties.features) {
      const geom = f.geometry as Polygon | MultiPolygon;
      if (geom.type !== "Polygon" && geom.type !== "MultiPolygon") continue;
      if (turf.booleanPointInPolygon(pt, f as Feature<Polygon | MultiPolygon>)) {
        found = (f.properties?.COUNTYNAME as string) ?? null;
        break;
      }
    }
    setUserCounty(found);
    onCountyDetected?.(found);
  }, [userLocation, counties, onCountyDetected]);

  const features = data.features;

  return (
    <MapContainer
      bounds={TAIWAN_BOUNDS}
      maxBounds={MAP_LIMITS}
      maxBoundsViscosity={0.85}
      minZoom={7}
      maxZoom={12}
      className="h-full w-full"
      zoomControl={false}
      preferCanvas
    >
      <TileLayer
        key={basemap}
        url={BASEMAPS[basemap].url}
        attribution={`${BASEMAPS[basemap].attribution} ｜ 資料：中央氣象署`}
        subdomains={BASEMAPS[basemap].subdomains}
        maxZoom={19}
      />

      {radar && (
        <RadarFrames host={radar.host} frames={radar.frames} idx={radar.idx} />
      )}

      {typhoons && typhoons.length > 0 && <TyphoonView typhoons={typhoons} />}
      {typhoons && typhoons.map((t) => <TyphoonLayer key={t.id} typhoon={t} />)}

      {/* 填色連續場（墊在最底層，非互動）*/}
      {(mode === "temperature" || mode === "precipitation") && (
        <InterpolatedField features={features} counties={counties} kind={mode} />
      )}

      {mode === "wind" && <WindParticleLayer features={features} />}

      {showCounties && counties && (
        <CountyLayer counties={counties} highlight={userCounty} />
      )}

      {mode === "wind" ? (
        showWindStations ? (
          features.map((f) => (
            <WindStationArrow key={f.properties.stationId} f={f} />
          ))
        ) : null
      ) : mode === "temperature" ? (
        showTempLabels ? (
          <TemperatureLayer features={features} />
        ) : null
      ) : mode === "weather" ? (
        <WeatherConditionLayer features={features} />
      ) : mode === "precipitation" || mode === "radar" || mode === "typhoon" ? null : (
        features.map((f) => (
          <StationCircle key={f.properties.stationId} f={f} mode={mode} />
        ))
      )}

      {userLocation && (
        <CircleMarker
          center={[userLocation.lat, userLocation.lng]}
          radius={8}
          pathOptions={{
            color: "#fff",
            weight: 2,
            fillColor: "#10b981",
            fillOpacity: 1,
          }}
        >
          <Popup>你的位置{userCounty ? `（${userCounty}）` : ""}</Popup>
        </CircleMarker>
      )}

      <FlyToUser loc={userLocation} />
    </MapContainer>
  );
}

// 放大到此層級（含）以上顯示各測站細部溫度，否則顯示縣市平均大標籤。
const TEMP_DETAIL_ZOOM = 10;
// 縮小到此層級以下（如區域尺度）完全不顯示溫度標籤，避免擁擠。
const TEMP_LABEL_MIN_ZOOM = 7;

interface CountyTemp {
  county: string;
  temp: number;
  lng: number;
  lat: number;
  count: number;
}

/** 依縣市彙總平均氣溫與代表位置（各站座標平均）。 */
function aggregateTempByCounty(features: WeatherFeature[]): CountyTemp[] {
  const acc = new Map<
    string,
    { sumT: number; sumLng: number; sumLat: number; n: number }
  >();
  for (const f of features) {
    const t = f.properties.temperature;
    const c = f.properties.county;
    if (t === null || !c) continue;
    const [lng, lat] = f.geometry.coordinates;
    const e = acc.get(c) ?? { sumT: 0, sumLng: 0, sumLat: 0, n: 0 };
    e.sumT += t;
    e.sumLng += lng;
    e.sumLat += lat;
    e.n += 1;
    acc.set(c, e);
  }
  return Array.from(acc.entries()).map(([county, e]) => ({
    county,
    temp: e.sumT / e.n,
    lng: e.sumLng / e.n,
    lat: e.sumLat / e.n,
    count: e.n,
  }));
}

/** 縣市平均氣溫的大標籤 icon。 */
function bigTempLabelIcon(temp: number): L.DivIcon {
  const color = temperatureColor(temp);
  const html = `<div class="temp-label temp-label-big" style="background:${color}">${Math.round(
    temp
  )}°</div>`;
  return L.divIcon({
    className: "temp-label-wrap",
    html,
    iconSize: [48, 30],
    iconAnchor: [24, 15],
  });
}

function BigTempMarker({ agg }: { agg: CountyTemp }) {
  const icon = useMemo(() => bigTempLabelIcon(agg.temp), [agg.temp]);
  return (
    <Marker position={[agg.lat, agg.lng]} icon={icon}>
      <Popup>
        <div className="text-sm">
          <div className="font-bold text-white">{agg.county}</div>
          <div className="text-gray-300">
            平均氣溫 {agg.temp.toFixed(1)} °C
          </div>
          <div className="text-[11px] text-gray-400">
            {agg.count} 個測站 · 放大可看各站詳情
          </div>
        </div>
      </Popup>
    </Marker>
  );
}

/** 氣溫圖層：遠看顯示縣市平均大標籤，放大後顯示各測站溫度。 */
function TemperatureLayer({ features }: { features: WeatherFeature[] }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
  });

  const aggregates = useMemo(
    () => aggregateTempByCounty(features),
    [features]
  );

  // 縮太小時不顯示標籤（只留填色場）。
  if (zoom < TEMP_LABEL_MIN_ZOOM) return null;

  if (zoom >= TEMP_DETAIL_ZOOM) {
    return (
      <>
        {features.map((f) => (
          <TempMarker key={f.properties.stationId} f={f} />
        ))}
      </>
    );
  }
  return (
    <>
      {aggregates.map((a) => (
        <BigTempMarker key={a.county} agg={a} />
      ))}
    </>
  );
}

// ---- 天氣現象（陰晴）圖層：每縣市取多數測站的天氣，以 emoji 示意 ----

/** 將 CWA 天氣現象文字對應到 emoji。順序：雷 > 雨 > 雪 > 霧/靄 > 晴 > 多雲 > 陰。 */
function weatherEmoji(text: string | null): string {
  const w = text ?? "";
  if (/雷/.test(w)) return "⛈️";
  if (/雨/.test(w)) return "🌧️";
  if (/雪/.test(w)) return "🌨️";
  if (/霧|靄/.test(w)) return "🌫️";
  if (/晴/.test(w)) return "☀️";
  if (/多雲/.test(w)) return "⛅";
  if (/陰/.test(w)) return "☁️";
  return "🌡️";
}

interface CountyWeather {
  county: string;
  emoji: string;
  label: string; // 最多數的天氣現象文字
  lng: number;
  lat: number;
  count: number;
}

/** 取 Map 中計數最高的 key。 */
function topKey(m: Map<string, number>): string {
  let best = "";
  let n = -1;
  m.forEach((v, k) => {
    if (v > n) {
      best = k;
      n = v;
    }
  });
  return best;
}

/** 依縣市彙總代表天氣：取最常見的天氣現象文字，再由它決定 emoji（兩者保證一致）；
 *  位置取各站座標平均。 */
function aggregateWeatherByCounty(features: WeatherFeature[]): CountyWeather[] {
  const acc = new Map<
    string,
    { sumLng: number; sumLat: number; n: number; label: Map<string, number> }
  >();
  for (const f of features) {
    const w = f.properties.weather;
    const c = f.properties.county;
    if (!w || !c) continue;
    const [lng, lat] = f.geometry.coordinates;
    const e = acc.get(c) ?? { sumLng: 0, sumLat: 0, n: 0, label: new Map() };
    e.sumLng += lng;
    e.sumLat += lat;
    e.n += 1;
    e.label.set(w, (e.label.get(w) ?? 0) + 1);
    acc.set(c, e);
  }
  return Array.from(acc.entries()).map(([county, e]) => {
    const label = topKey(e.label);
    return {
      county,
      emoji: weatherEmoji(label),
      label,
      lng: e.sumLng / e.n,
      lat: e.sumLat / e.n,
      count: e.n,
    };
  });
}

/**
 * 防止徽章重疊：任兩徽章太近就沿連線對稱推開，以鬆弛法迭代至穩定。
 * 徽章「寬」約為「高」的 ~3 倍，故用橢圓間距——把經度壓縮 ASPECT 倍後做等向推擠，
 * 等效於水平所需間距大於垂直，避免寬標籤左右疊住。質心近乎重合（市被縣包住）
 * 時預設往垂直方向推。通用處理所有擁擠處，不寫死任何縣市名。
 */
function deconflictPositions<T extends { lat: number; lng: number }>(
  items: T[]
): T[] {
  const SEP = 0.13; // 壓縮空間中的最小間距（度）
  const ASPECT = 2.8; // 徽章寬高比，橫向間距需求 ≈ SEP × ASPECT
  const pts = items.map((it) => ({ item: it, lat: it.lat, sLng: it.lng / ASPECT }));
  for (let iter = 0; iter < 40; iter++) {
    let maxPush = 0;
    for (let a = 0; a < pts.length; a++) {
      for (let b = a + 1; b < pts.length; b++) {
        let dLat = pts[b].lat - pts[a].lat;
        let dLng = pts[b].sLng - pts[a].sLng;
        let dist = Math.hypot(dLat, dLng);
        if (dist >= SEP) continue;
        if (dist < 1e-6) {
          dLat = 1;
          dLng = 0;
          dist = 1;
        }
        const push = (SEP - dist) / 2;
        if (push > maxPush) maxPush = push;
        const uLat = dLat / dist;
        const uLng = dLng / dist;
        pts[a].lat -= uLat * push;
        pts[a].sLng -= uLng * push;
        pts[b].lat += uLat * push;
        pts[b].sLng += uLng * push;
      }
    }
    if (maxPush < 1e-4) break; // 已穩定
  }
  return pts.map((p) => ({ ...p.item, lat: p.lat, lng: p.sLng * ASPECT }));
}

/** 天氣示意徽章 icon（emoji + 縣市名）。 */
function weatherBadgeIcon(emoji: string, county: string): L.DivIcon {
  const html =
    `<div style="display:flex;align-items:center;gap:4px;padding:2px 7px;border-radius:9999px;` +
    `background:rgba(15,23,42,0.85);border:1px solid rgba(255,255,255,0.18);white-space:nowrap;` +
    `box-shadow:0 1px 3px rgba(0,0,0,0.45)">` +
    `<span style="font-size:16px;line-height:1">${emoji}</span>` +
    `<span style="font-size:12px;color:#e5e7eb">${county}</span></div>`;
  return L.divIcon({
    className: "wx-badge-wrap",
    html,
    iconSize: [76, 24],
    iconAnchor: [38, 12],
  });
}

function WeatherConditionMarker({ w }: { w: CountyWeather }) {
  const icon = useMemo(
    () => weatherBadgeIcon(w.emoji, w.county),
    [w.emoji, w.county]
  );
  return (
    <Marker position={[w.lat, w.lng]} icon={icon}>
      <Popup>
        <div className="text-sm">
          <div className="font-bold text-white">{w.county}</div>
          <div className="text-gray-300">
            {w.emoji} {w.label}
          </div>
          <div className="text-[11px] text-gray-400">
            {w.count} 個測站 · 多數天氣現象
          </div>
        </div>
      </Popup>
    </Marker>
  );
}

/** 天氣圖層：每縣市一個 emoji 徽章。 */
function WeatherConditionLayer({ features }: { features: WeatherFeature[] }) {
  const items = useMemo(
    () => deconflictPositions(aggregateWeatherByCounty(features)),
    [features]
  );
  return (
    <>
      {items.map((w) => (
        <WeatherConditionMarker key={w.county} w={w} />
      ))}
    </>
  );
}

/** 產生氣溫數字標籤 divIcon：底色依溫度區間，數字白字加深色外框以確保各底色皆可讀。 */
function tempLabelIcon(temp: number | null): L.DivIcon {
  const color = temperatureColor(temp);
  const text = temp === null ? "–" : `${Math.round(temp)}°`;
  const html = `<div class="temp-label" style="background:${color}">${text}</div>`;
  return L.divIcon({
    className: "temp-label-wrap",
    html,
    iconSize: [32, 18],
    iconAnchor: [16, 9],
  });
}

/** 氣溫模式：直接在地圖上顯示數字溫度，一眼可讀。 */
function TempMarker({ f }: { f: WeatherFeature }) {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  const icon = useMemo(() => tempLabelIcon(p.temperature), [p.temperature]);
  return (
    <Marker position={[lat, lng]} icon={icon}>
      <Popup>
        <WeatherStationPopup p={p} />
      </Popup>
    </Marker>
  );
}

/** 依 mode 決定圓點的顏色與半徑。 */
function StationCircle({ f, mode }: { f: WeatherFeature; mode: LayerKey }) {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;

  let color = "#38bdf8";
  let radius = 5;
  let fillOpacity = 0.85;

  if (mode === "temperature") {
    color = temperatureColor(p.temperature);
  } else if (mode === "humidity") {
    color = humidityColor(p.humidity);
  } else if (mode === "wind") {
    color = windColor(p.windSpeed);
    radius = 2.5;
    fillOpacity = 0.55;
  } else if (mode === "precipitation") {
    // 填色場已表達雨量大小，這裡只保留小點作為點擊目標。
    color = "#e0f2fe";
    radius = 2.5;
    fillOpacity = 0.9;
  } else if (mode === "stations") {
    color = "#94a3b8";
    radius = 4;
  }

  return (
    <CircleMarker
      center={[lat, lng]}
      radius={radius}
      pathOptions={{
        color: "rgba(0,0,0,0.35)",
        weight: 1,
        fillColor: color,
        fillOpacity,
      }}
    >
      <Popup>
        <WeatherStationPopup p={p} />
      </Popup>
    </CircleMarker>
  );
}

function WindStationArrow({ f }: { f: WeatherFeature }) {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  const icon = useMemo(
    () =>
      p.windDirection === null
        ? null
        : windArrowIcon(p.windDirection, p.windSpeed),
    [p.windDirection, p.windSpeed]
  );

  if (!icon) {
    return <StationCircle f={f} mode="wind" />;
  }

  return (
    <Marker position={[lat, lng]} icon={icon}>
      <Popup>
        <WeatherStationPopup p={p} />
      </Popup>
    </Marker>
  );
}

/** 縣市界線圖層：hover 高亮、點擊 zoom、使用者所在縣市持續高亮。 */
function CountyLayer({
  counties,
  highlight,
}: {
  counties: FeatureCollection;
  highlight: string | null;
}) {
  const map = useMap();
  const geoRef = useRef<L.GeoJSON | null>(null);

  const baseStyle = (name?: string): L.PathOptions => ({
    color: name && name === highlight ? "#fbbf24" : "#64748b",
    weight: name && name === highlight ? 2.5 : 1,
    fillColor: name && name === highlight ? "#fbbf24" : "#94a3b8",
    fillOpacity: name && name === highlight ? 0.25 : 0.05,
  });

  return (
    <GeoJSON
      // highlight 改變時重新套用樣式。
      key={highlight ?? "none"}
      ref={geoRef}
      data={counties}
      style={(feature) =>
        baseStyle(feature?.properties?.COUNTYNAME as string | undefined)
      }
      onEachFeature={(feature, layer) => {
        const name = feature.properties?.COUNTYNAME as string | undefined;
        layer.on({
          mouseover: (e) => {
            (e.target as L.Path).setStyle({
              weight: 2.5,
              fillOpacity: 0.2,
              color: "#38bdf8",
            });
          },
          mouseout: (e) => {
            (e.target as L.Path).setStyle(baseStyle(name));
          },
          click: (e) => {
            map.fitBounds((e.target as L.Polygon).getBounds(), {
              padding: [20, 20],
            });
          },
        });
        if (name) layer.bindTooltip(name, { sticky: true });
      }}
    />
  );
}
