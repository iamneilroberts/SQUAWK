// Rebuild the bundled airport LABEL index (frontend/src/data/airports-world.json) from an
// OurAirports airports.csv snapshot: large + medium airports only, WITH their names so the globe
// labels can read a name rather than a code. Public domain source; run via fetch-airports-world.sh.
// This is the label index only — mission data lives in the separate regional shards.
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
  console.error("usage: generate-airports-world.mjs --input airports.csv --output airports-world.json");
  process.exit(1);
}

const SIZE = new Map([["large_airport", "large"], ["medium_airport", "medium"]]);

function parseRow(line) {
  const out = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') { if (line[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
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
const iIdent = col("ident"), iType = col("type"), iName = col("name");
const iLat = col("latitude_deg"), iLon = col("longitude_deg"), iIata = col("iata_code");
if ([iIdent, iType, iName, iLat, iLon, iIata].some((i) => i < 0)) {
  console.error("airports.csv is missing an expected column");
  process.exit(1);
}

const airports = [];
for (let r = 1; r < lines.length; r++) {
  const row = parseRow(lines[r]);
  const size = SIZE.get(row[iType]);
  if (size === undefined) continue;
  const ident = row[iIdent];
  const latDeg = Number(row[iLat]);
  const lonDeg = Number(row[iLon]);
  if (!ident || !Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) continue;
  const iata = row[iIata];
  airports.push({
    ident,
    iata: iata && iata.length > 0 ? iata : null,
    name: row[iName] ?? "",
    latDeg,
    lonDeg,
    size,
  });
}

airports.sort((a, b) => (a.ident < b.ident ? -1 : a.ident > b.ident ? 1 : 0));
// Minified — this is generated data (~5k records), and the whitespace of a pretty-print would
// roughly double the bundled bytes for no benefit.
writeFileSync(OUTPUT, JSON.stringify(airports) + "\n");
console.error(`airports-world.json: ${airports.length} large+medium airports (with names)`);
