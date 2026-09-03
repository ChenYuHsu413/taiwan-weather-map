// 手動重新產生靜態備援檔 public/data/gfs-wind.json。
// 下載與解碼邏輯共用 lib/gfs-wind.ts（Node >= 22.18 可直接執行 .ts，不需額外工具）。
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchLatestGfsWind } from "../lib/gfs-wind.ts";

const OUT_FILE = path.join(process.cwd(), "public", "data", "gfs-wind.json");

const grid = await fetchLatestGfsWind((m) => console.log(m));
await mkdir(path.dirname(OUT_FILE), { recursive: true });
await writeFile(OUT_FILE, `${JSON.stringify(grid, null, 2)}\n`, "utf8");
console.log(
  `Wrote ${OUT_FILE} (${grid.grid.nx}x${grid.grid.ny}, ${grid.u.length} vectors, ` +
    `run ${grid.run.date} ${grid.run.cycle}z +${grid.run.forecastHour}h)`
);
