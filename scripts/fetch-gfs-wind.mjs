import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BBOX = {
  leftlon: 110,
  rightlon: 132,
  bottomlat: 12,
  toplat: 34,
};

const OUT_FILE = path.join(process.cwd(), "public", "data", "gfs-wind.json");
const FORECAST_HOUR = "000";
const CYCLES = ["18", "12", "06", "00"];

function pad2(value) {
  return String(value).padStart(2, "0");
}

function ymd(date) {
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(
    date.getUTCDate()
  )}`;
}

function candidates() {
  const now = new Date();
  const out = [];
  for (let dayOffset = 0; dayOffset < 3; dayOffset++) {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    d.setUTCDate(d.getUTCDate() - dayOffset);
    const date = ymd(d);
    for (const cycle of CYCLES) {
      if (dayOffset === 0 && Number(cycle) > now.getUTCHours()) continue;
      out.push({ date, cycle });
    }
  }
  return out;
}

function gfsUrl({ date, cycle }) {
  const params = new URLSearchParams({
    dir: `/gfs.${date}/${cycle}/atmos`,
    file: `gfs.t${cycle}z.pgrb2.0p25.f${FORECAST_HOUR}`,
    lev_10_m_above_ground: "on",
    var_UGRD: "on",
    var_VGRD: "on",
    subregion: "",
    leftlon: String(BBOX.leftlon),
    rightlon: String(BBOX.rightlon),
    toplat: String(BBOX.toplat),
    bottomlat: String(BBOX.bottomlat),
  });
  return `https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl?${params}`;
}

function readUint64(view, offset) {
  const hi = view.getUint32(offset);
  const lo = view.getUint32(offset + 4);
  return hi * 2 ** 32 + lo;
}

function readGribCoord(view, offset) {
  return view.getInt32(offset) / 1e6;
}

class BitReader {
  constructor(bytes, offset) {
    this.bytes = bytes;
    this.bit = offset * 8;
  }

  read(width) {
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

function unpackSimplePacking(view, section, pointCount, rep) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const reader = new BitReader(bytes, section.offset + 5);
  const binaryScale = 2 ** rep.binaryScaleFactor;
  const decimalScale = 10 ** rep.decimalScaleFactor;
  const out = new Array(pointCount);

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

function parseGrib(buffer) {
  const view = new DataView(buffer);
  const messages = [];
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
    const msg = {};

    while (sectionOffset < end - 4) {
      const length = view.getUint32(sectionOffset);
      const number = view.getUint8(sectionOffset + 4);
      const section = { offset: sectionOffset, length };

      if (number === 3) {
        const base = sectionOffset + 5;
        const template = view.getUint16(base + 7);
        if (template !== 0) {
          throw new Error(`Unsupported grid template ${template}`);
        }
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
        if (template !== 0) {
          throw new Error(`Unsupported product template ${template}`);
        }
        msg.parameterCategory = view.getUint8(base + 4);
        msg.parameterNumber = view.getUint8(base + 5);
        msg.forecastTime = view.getUint32(base + 18);
        msg.surfaceType = view.getUint8(base + 22);
        msg.surfaceValue = view.getUint32(base + 24);
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

  if (messages.length === 0) {
    throw new Error("No GRIB2 messages found");
  }
  return messages;
}

async function downloadLatest() {
  for (const candidate of candidates()) {
    const url = gfsUrl(candidate);
    process.stdout.write(`Trying NOAA GFS ${candidate.date} ${candidate.cycle}z... `);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.log(`${res.status}`);
        continue;
      }
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength < 1000) {
        console.log(`too small (${buffer.byteLength} bytes)`);
        continue;
      }
      console.log(`${buffer.byteLength} bytes`);
      return { ...candidate, url, buffer };
    } catch (err) {
      console.log(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error("Unable to download a recent NOAA GFS wind subset");
}

function buildGrid({ date, cycle, url, buffer }) {
  const messages = parseGrib(buffer);
  const uMsg = messages.find((m) => m.parameterCategory === 2 && m.parameterNumber === 2);
  const vMsg = messages.find((m) => m.parameterCategory === 2 && m.parameterNumber === 3);

  if (!uMsg || !vMsg) {
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
    run: {
      date,
      cycle,
      forecastHour: Number(FORECAST_HOUR),
    },
    bbox: BBOX,
    grid,
    u: uMsg.data.map((v) => Number(v.toFixed(3))),
    v: vMsg.data.map((v) => Number(v.toFixed(3))),
  };
}

const latest = await downloadLatest();
const grid = buildGrid(latest);
await mkdir(path.dirname(OUT_FILE), { recursive: true });
await writeFile(OUT_FILE, `${JSON.stringify(grid, null, 2)}\n`, "utf8");
console.log(
  `Wrote ${OUT_FILE} (${grid.grid.nx}x${grid.grid.ny}, ${grid.u.length} vectors)`
);
