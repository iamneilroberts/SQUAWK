// Convert an OurAirports navaids.csv snapshot into the bundled Gulf Coast VOR-family label index.
// VOR family only (VOR / VOR-DME / VORTAC / TACAN), bounded to the Gulf Coast region so the bundle
// stays tiny. Public domain source; run via scripts/fetch-ournavaids.sh. Never fetched at runtime.
import { readFileSync, writeFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith("--")) pairs.push([arg.slice(2), all[i + 1]]);
    return pairs;
  }, []),
);

const INPUT = args.input;
const OUTPUT = args.output;
if (!INPUT || !OUTPUT) {
  console.error("usage: generate-ournavaids.mjs --input navaids.csv --output navaids-vor.json");
  process.exit(1);
}

// Gulf Coast region (generous margin around the play area) — keeps the bundle small.
const LAT_MIN = 26.5, LAT_MAX = 33.5, LON_MIN = -95.0, LON_MAX = -82.0;
const VOR_TYPES = new Set(["VOR", "VOR-DME", "VORTAC", "TACAN"]);

// Minimal quote-aware CSV row parser (names contain commas).
function parseRow(line) {
  const out = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(field); field = ""; }
    else field += c;
  }
  out.push(field);
  return out;
}

const text = readFileSync(INPUT, "utf8");
const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
const header = parseRow(lines[0]);
const col = (name) => header.indexOf(name);
const iIdent = col("ident"), iName = col("name"), iType = col("type");
const iLat = col("latitude_deg"), iLon = col("longitude_deg");
if ([iIdent, iName, iType, iLat, iLon].some((i) => i < 0)) {
  console.error("navaids.csv is missing an expected column");
  process.exit(1);
}

const navaids = [];
for (let r = 1; r < lines.length; r++) {
  const row = parseRow(lines[r]);
  const type = row[iType];
  if (!VOR_TYPES.has(type)) continue;
  const latDeg = Number(row[iLat]);
  const lonDeg = Number(row[iLon]);
  const ident = row[iIdent];
  if (!ident || !Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) continue;
  if (latDeg < LAT_MIN || latDeg > LAT_MAX || lonDeg < LON_MIN || lonDeg > LON_MAX) continue;
  navaids.push({ ident, name: row[iName] ?? "", type, latDeg, lonDeg });
}

navaids.sort((a, b) => (a.ident < b.ident ? -1 : a.ident > b.ident ? 1 : 0));
writeFileSync(OUTPUT, JSON.stringify(navaids, null, 2) + "\n");
console.error(`navaids-vor.json: ${navaids.length} VOR-family navaids in the Gulf Coast region`);
