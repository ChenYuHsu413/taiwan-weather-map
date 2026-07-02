"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Marker,
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
  radar: { host: string; frames: RadarFrame[]; idx: number } | null;
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
  radar,
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
      ) : mode === "temperature"
        ? <TemperatureLayer features={features} />
        : (mode === "precipitation"
            ? features.filter((f) => (f.properties.precipitation ?? 0) > 0)
            : features
          ).map((f) => (
            <StationCircle key={f.properties.stationId} f={f} mode={mode} />
          ))}

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
