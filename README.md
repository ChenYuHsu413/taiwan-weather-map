# 台灣即時氣象視覺化地圖

類 Windy 風格的台灣即時氣象地圖，資料來源為**中央氣象署開放資料平台 API**。後端負責抓取、清洗、快取並轉成乾淨 GeoJSON；前端用 Leaflet 呈現測站、氣溫色階、雨量圓圈、風向箭頭與縣市界線。

## 技術棧

Next.js 14 (App Router) · TypeScript · Tailwind CSS · Leaflet / React Leaflet · turf.js

## 快速開始

```bash
# 1. 安裝依賴
npm install

# 2. 設定環境變數：複製範例並填入你的 CWA 授權碼
copy .env.local.example .env.local   # Windows
# cp .env.local.example .env.local   # macOS/Linux

# 3. 編輯 .env.local，填入 CWA_API_KEY

# 4. 啟動開發伺服器
npm run dev
# 開啟 http://localhost:3000
```

生產環境：`npm run build` 後 `npm run start`。

## 環境變數（`.env.local`）

| 變數 | 說明 | 預設 |
| --- | --- | --- |
| `CWA_API_KEY` | 中央氣象署授權碼（**必填**）。於 https://opendata.cwa.gov.tw/ 註冊後取得 | — |
| `CWA_PRIMARY_DATASET` | 主要資料集 | `O-A0003-001` |
| `CWA_FALLBACK_DATASET` | 備援資料集 | `O-A0001-001` |
| `WEATHER_CACHE_TTL_SECONDS` | 快取存活秒數 | `600`（10 分鐘） |

> API key 只在後端使用，不會傳到前端。`.env.local` 已被 `.gitignore` 排除。

## 架構

```
app/
  page.tsx                       首頁（狀態管理、定位、版面）
  api/weather/current/route.ts   GET：回傳 GeoJSON + summary
  api/weather/history/route.ts   GET：單一測站歷史時序（?stationId=&limit=）
  api/radar/route.ts             GET：代理回傳最新雷達回波 PNG（後端爬蟲）
lib/
  cwa.ts               CWA API client（timeout、錯誤處理、primary/fallback）
  weather-transform.ts 原始 JSON → 統一 GeoJSON（缺值轉 null、去重、座標驗證）
  weather-summary.ts   全台摘要統計
  weather-cache.ts     10 分鐘快取（記憶體 + SQLite + stale 回退）
  weather-store.ts     SQLite 儲存：寫快照 + 逐站時序、讀最新、查歷史
  db.ts                SQLite 連線單例 + schema
  radar.ts             CWA 雷達圖爬蟲（帶 Referer/UA、快取、頻率限制、stale 回退）
  color-scale.ts       氣溫/風速/濕度/雨量色階
  types.ts             TypeScript 型別
components/
  WeatherMap.tsx           Leaflet 地圖（底圖切換、markers、風向箭頭、縣市界線、定位、雷達疊圖）
  InterpolatedField.tsx    逐像素 IDW 內插填色場（氣溫/雨量，類 Windy 平滑漸層，裁切到陸地）
  WeatherLayerControl.tsx  圖層切換 + 雷達/縣市開關 + 定位按鈕
  WeatherSummaryPanel.tsx  左上摘要面板
  WeatherStationPopup.tsx  測站 popup 內容
  WeatherLegend.tsx        圖例
public/data/taiwan-counties.geojson  縣市界線（見下方來源）
```

## 資料流與快取

1. 前端呼叫 `GET /api/weather/current`。
2. 後端檢查快取：**未超過 10 分鐘 → 直接回傳快取**（記憶體優先，其次 SQLite 最新快照）。
3. 超過或無快取 → 呼叫 CWA `O-A0003-001`。若失敗或有效測站 < 30 筆 → fallback 到 `O-A0001-001`。
4. 清洗 → 轉 GeoJSON → 寫入 SQLite（一筆快照 + 逐站時序觀測）→ 回傳。
5. 外部 API 失敗但有舊快取 → 回傳舊快取並標示 `stale: true`（前端顯示「舊快取」提示）。

快取採 in-flight 去重，避免多個請求同時打 CWA。DB 檔位於 `.cache/weather.db`（已 gitignore）。

## 資料來源與爬蟲

- **主要來源（官方 API）**：所有測站資料來自 CWA 開放資料 API（`O-A0003-001` / `O-A0001-001`）。
- **雷達動畫（地圖圖層）**：使用 [RainViewer](https://www.rainviewer.com/) 免費雷達圖磚（標準 XYZ tiles）。圖磚與底圖同為 Web Mercator，**天生正確對齊**。前端向 `api.rainviewer.com` 取過去約 2 小時的影格清單（每 10 分一格），預載各影格 `TileLayer` 並依索引切換 opacity 播放（切換瞬間完成、無閃爍）；底部控制列可播放/暫停與拖曳時間軸。
- **CWA 雷達爬蟲（補充 endpoint）**：[lib/radar.ts](lib/radar.ts) + `GET /api/radar`。CWA 雷達合成圖為公開靜態 PNG，但官網擋裸連結（缺 `Referer` 回 403），故後端帶正確 `Referer` 抓取公開影像並代理。**只抓公開/免登入影像**，含 10 分鐘快取、失敗後 60 秒最短重試、stale 回退。此為爬蟲示範與備援；未用於地圖疊圖，因為 CWA 預算圖的投影/地理範圍無公開文件（此授權層級也無雷達 open data 權限），`imageOverlay` 無法精準對齊。

## 縣市 GeoJSON 來源

已放置於 `public/data/taiwan-counties.geojson`（來源：[g0v/twgeojson](https://github.com/g0v/twgeojson)，`twCounty2010.geo.json`，經 mapshaper 簡化至 ~400KB，屬性欄位 `COUNTYNAME`）。若要更新，下載後放到同一路徑即可。

## 已完成項目

- [x] `/api/weather/current` 取得 CWA 資料（primary + fallback）
- [x] 後端 10 分鐘快取（記憶體 + SQLite）+ stale 舊資料回退
- [x] 原始資料清洗轉 GeoJSON（缺值 `-99`/`""`/`T` 處理、去重、座標驗證）
- [x] SQLite 時序儲存：每次抓取 append 逐站觀測 → 累積歷史（`/api/weather/history`）
- [x] Leaflet 地圖含台灣本島與離島初始視角
- [x] 測站 marker + 點擊 popup（完整欄位，深色主題）
- [x] 氣溫：逐像素 IDW 平滑填色場（填滿本島、山區內插補值）+ 分級數字標籤（縮太小時自動隱藏、放大看各站、中間看縣市均溫）
- [x] 雨量：逐像素 IDW 平滑填色（類 Windy，只填有雨陸地）+ 測站點僅在有雨時顯示 + 色帶圖例
- [x] 風向箭頭（依 windDirection 旋轉、依 windSpeed 上色）
- [x] 濕度色階圖層
- [x] 底圖切換：深色 ↔ OpenStreetMap 街道圖
- [x] 縣市界線 + hover 高亮 + 點擊 zoom
- [x] 雷達回波動畫（RainViewer 圖磚，過去約 2 小時每 10 分一格；預設暫停於最新影格，可播放/暫停/拖曳時間軸；原生只取到 z7 再放大，避免外海「Zoom Level Not Supported」破圖）+ CWA 雷達爬蟲 endpoint
- [x] 使用者定位（Geolocation）+ turf 判斷所在縣市並高亮
- [x] 摘要面板（最高/最低溫、最大雨量、最大風速、測站數、更新時間、資料來源、是否快取）
- [x] loading / API 錯誤 / 定位失敗的友善提示
- [x] 深色 dashboard 風格、響應式

## 尚未完成 / 後續可擴充

- [ ] 颱風路徑、天氣警特報、預報圖層（架構已模組化，新增 `lib/` client + API route 即可）
- [ ] 更接近 Windy 的粒子風場動畫（第一版刻意不做）
- [ ] 手機版面板收合最佳化（目前可用，但小螢幕面板較擠）
- [ ] 測站搜尋 / 篩選
- [ ] 單元測試（transform 邏輯已用臨時腳本驗證通過，尚未納入正式 test suite）

## 重要備註：CWA 欄位對應

`lib/cwa.ts` 與 `lib/weather-transform.ts` 依照 **CWA 新版（2023 後）測站 API 結構**（`records.Station[]`、`WeatherElement.AirTemperature` 等）撰寫，並已用合成資料驗證清洗邏輯。若實際 API 回傳欄位名稱有出入，**只需調整 `lib/weather-transform.ts` 的欄位取值**，其餘各層不受影響。
