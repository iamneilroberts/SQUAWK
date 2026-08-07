#!/usr/bin/env bash
#
# ONE-TIME generator for frontend/src/data/airports-world.json (spec D-7).
#
# This is NOT run at build time and NOT run in the browser. Run it by hand when you want to
# refresh the airport labels against a newer OurAirports release, then commit the JSON it
# writes. The app imports that JSON as a bundled static asset and never touches the network for
# it, so labels keep working with the backend down and OurAirports unreachable.
#
# Source: https://ourairports.com/data/ - public domain (OurAirports "no copyright" dedication).
# Attribution is still shown in the app when the labels layer is on, because credit is cheap and
# the data is someone's work.
#
# Filter: large_airport + medium_airport only. small_airport and heliport add ~60k records - a
# multi-megabyte bundle and an unreadable label soup at any useful camera height.
#
# Usage:  bash scripts/fetch-ourairports.sh
set -euo pipefail

SRC_URL="${OURAIRPORTS_URL:-https://davidmegginson.github.io/ourairports-data/airports.csv}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$REPO_ROOT/frontend/src/data/airports-world.json"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

echo "fetching $SRC_URL"
curl -fsSL "$SRC_URL" -o "$TMP"

python3 - "$TMP" "$OUT" <<'PY'
import csv, json, sys

src, out = sys.argv[1], sys.argv[2]
KEEP = {"large_airport": "large", "medium_airport": "medium"}
rows = []

with open(src, newline="", encoding="utf-8") as fh:
    for r in csv.DictReader(fh):
        size = KEEP.get(r.get("type", ""))
        if size is None:
            continue
        try:
            lat = round(float(r["latitude_deg"]), 4)
            lon = round(float(r["longitude_deg"]), 4)
        except (TypeError, ValueError, KeyError):
            continue
        ident = (r.get("ident") or "").strip()
        if not ident:
            continue
        iata = (r.get("iata_code") or "").strip() or None
        # name is dropped for medium airports to stay under the 600 KB budget (CD-009) —
        # large airports keep it since there are few of them and the identifier alone is
        # less useful for a major hub.
        name = (r.get("name") or "").strip()[:48] if size == "large" else ""
        rows.append({
            "ident": ident, "iata": iata, "name": name,
            "latDeg": lat, "lonDeg": lon, "size": size,
        })

rows.sort(key=lambda a: a["ident"])
with open(out, "w", encoding="utf-8") as fh:
    json.dump(rows, fh, separators=(",", ":"), ensure_ascii=False)
    fh.write("\n")
print(f"wrote {len(rows)} airports")
PY

ls -l "$OUT"
