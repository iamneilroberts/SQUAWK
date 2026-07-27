# Phase A — Scaffold + Browse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Working repo plumbing plus a minimal live ADS-B browse screen: backend proxy (normalize + failover + rate-limit), Cesium globe with live contacts, contact list, selection — and an honestly disabled TAKE CONTROLS button.

**Architecture:** FastAPI backend proxies the three readsb-schema feeds behind `/api/adsb` and adsbdb behind `/api/type/{hex}`; the React/Cesium frontend polls the backend (never upstream), renders contacts as in-place-mutated billboard primitives on a keyless top-down globe, and keeps selection in a Zustand store. No sim code in this phase.

**Tech Stack:** Vite, React 18, TypeScript, CesiumJS (keyless), Zustand, Tailwind (layout only) + hand-written tokens.css, vitest; Python 3.12, FastAPI, httpx, pytest; Docker Compose + bare-metal.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-27-adsb-game-design.md`. CLAUDE.md ground rules apply to every task.
- **No mock/sample/synthesized feed data in the UI.** Feeds down ⇒ explicit OFFLINE state. Unknown field ⇒ em-dash (—). Test fixtures must be real captured schema (copied from LORAN's fixture), never invented registrations.
- Keyless Cesium: `Ion.defaultAccessToken = null`, no ion terrain in this phase (`EllipsoidTerrainProvider` for browse; real terrain arrives in Phase C).
- Dependencies allowed in this phase: cesium, react, react-dom, zustand; dev: typescript, vite, @vitejs/plugin-react, tailwindcss, postcss, autoprefixer, vitest, @types/react, @types/react-dom; backend: fastapi, httpx, uvicorn, pytest, pytest-asyncio. **Nothing else without asking the owner.**
- No absolute paths in tracked files. The sibling LORAN clone is referenced relatively as `../adsb-viz` (read via `git show` only — NEVER edit that repo or its worktrees; one has another session's WIP).
- Units: readsb feeds are **feet and knots**; keep them as-is through the browse path (display units). `alt_baro` may be the string `"ground"`. `dbFlags & 1` = military.
- Attribution visible on the globe screen: Esri (imagery) — Cesium's credit container, plus the status bar line.
- Visual: near-black `#05070a`, amber `#ffb000` (military/warnings), cyan `#5fd7e0` (nominal), monospace, 1px borders, bracket corners, no rounded corners > 2px, no shadows.
- Commit after every green test cycle. Commit messages end with the session trailer if configured.

## File Structure

```
frontend/
  package.json  vite.config.ts  tsconfig.json  index.html
  tailwind.config.js  postcss.config.js
  scripts/copy-cesium-assets.sh          # cp from node_modules → public/cesium (gitignored)
  src/main.tsx  src/App.tsx
  src/styles/tokens.css  src/styles/index.css
  src/data/types.ts                      # Contact type — THE shared shape
  src/data/api.ts                        # fetchAdsb/fetchConfig wrappers
  src/state/store.ts (+ store.test.ts)   # Zustand: contacts, selection, feed status, polling
  src/globe/BrowseGlobe.tsx              # viewer setup, click→select
  src/globe/icons.ts (+ icons.test.ts)   # canvas chevron sprites, color/rotation helpers
  src/globe/contactBillboards.ts (+ .test.ts)  # in-place billboard sync (pure diff logic tested)
  src/panels/ContactList.tsx  src/panels/StatusBar.tsx
backend/
  requirements.txt
  app/__init__.py  app/main.py  app/config.py
  app/feeds/__init__.py  app/feeds/adsb.py  app/feeds/adsbdb.py
  tests/test_normalize.py  tests/test_api.py  tests/fixtures/  tests/conftest.py
docker-compose.yml  backend/Dockerfile  frontend/Dockerfile  frontend/nginx.conf
scripts/dev.sh                            # bare-metal: backend + frontend dev servers
```

---

### Task 1: Backend scaffold — config, app factory, /healthz, /api/config

**Files:**
- Create: `backend/requirements.txt`, `backend/app/__init__.py`, `backend/app/config.py`, `backend/app/main.py`, `backend/tests/conftest.py`, `backend/tests/test_api.py`

**Interfaces:**
- Produces: `Settings` (pydantic-free, plain `os.environ` reads with defaults matching `.env.example`: `home_lat: float`, `home_lon: float`, `feed_primary/fallback/reserve: str`, `adsbdb_base: str`, `feed_min_interval_s: float`, `host`, `port`). `create_app() -> FastAPI`. `GET /healthz -> {"ok": true}`. `GET /api/config -> {"home": {"lat": float, "lon": float}}`.

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_api.py
from fastapi.testclient import TestClient
from app.main import create_app

def test_healthz():
    client = TestClient(create_app())
    r = client.get("/healthz")
    assert r.status_code == 200 and r.json() == {"ok": True}

def test_config_serves_home(monkeypatch):
    monkeypatch.setenv("HOME_LAT", "30.6944")
    monkeypatch.setenv("HOME_LON", "-88.0399")
    client = TestClient(create_app())
    home = client.get("/api/config").json()["home"]
    assert home == {"lat": 30.6944, "lon": -88.0399}
```

`backend/tests/conftest.py`:

```python
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
```

- [ ] **Step 2: Run to verify failure** — `cd backend && python -m venv .venv && .venv/bin/pip install fastapi httpx uvicorn pytest pytest-asyncio && .venv/bin/python -m pytest tests/ -v`. Expected: ImportError/collection failure (app.main missing). Also write `requirements.txt` (those five packages, one per line, unpinned).

- [ ] **Step 3: Implement**

```python
# backend/app/config.py
import os
from dataclasses import dataclass

@dataclass(frozen=True)
class Settings:
    home_lat: float
    home_lon: float
    feed_primary: str
    feed_fallback: str
    feed_reserve: str
    adsbdb_base: str
    feed_min_interval_s: float
    host: str
    port: int

def load_settings() -> Settings:
    e = os.environ.get
    return Settings(
        home_lat=float(e("HOME_LAT", "30.6944")),
        home_lon=float(e("HOME_LON", "-88.0399")),
        feed_primary=e("FEED_PRIMARY", "https://api.airplanes.live/v2"),
        feed_fallback=e("FEED_FALLBACK", "https://api.adsb.lol/v2"),
        feed_reserve=e("FEED_RESERVE", "https://opendata.adsb.fi/api/v2"),
        adsbdb_base=e("ADSBDB_BASE", "https://api.adsbdb.com/v0"),
        feed_min_interval_s=float(e("FEED_MIN_INTERVAL_S", "1.0")),
        host=e("ADSB_GAME_HOST", "127.0.0.1"),
        port=int(e("ADSB_GAME_PORT", "8010")),
    )
```

```python
# backend/app/main.py
from fastapi import FastAPI
from .config import load_settings

def create_app() -> FastAPI:
    app = FastAPI(title="adsb-game")
    settings = load_settings()
    app.state.settings = settings

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    @app.get("/api/config")
    def config():
        return {"home": {"lat": settings.home_lat, "lon": settings.home_lon}}

    return app

app = create_app()
```

- [ ] **Step 4: Run tests, expect PASS.**
- [ ] **Step 5: Commit** — `git add backend && git commit -m "feat(backend): app factory, settings from env, /healthz and /api/config"`

---

### Task 2: Feed client + normalizer with failover (copied from LORAN, trimmed)

**Files:**
- Create: `backend/app/feeds/__init__.py` (empty), `backend/app/feeds/adsb.py`, `backend/tests/test_normalize.py`, `backend/tests/fixtures/` (copied real captures)

**Interfaces:**
- Produces: `normalize(payload: dict) -> list[dict]` — accepts either envelope (`{"ac": [...]}` airplanes.live/adsb.lol or `{"aircraft": [...]}` adsb.fi), returns contacts with keys: `hex, flight (stripped str|None), t (str|None), lat, lon, alt_geom (int|None), alt_baro (int|"ground"|None), gs (float|None), track (float|None), baro_rate (int|None), military (bool from dbFlags&1), seen_pos (float|None)`. Entries without both `lat` and `lon` are dropped.
- Produces: `async fetch_adsb(settings, lat: float, lon: float, radius_nm: int) -> dict` — tries primary → fallback → reserve at `{base}/point/{lat}/{lon}/{radius_nm}`, enforces `feed_min_interval_s` between upstream calls (module-level monotonic timestamp + `asyncio.Lock`), caches the last good result for 2 s keyed by rounded (lat, lon, radius), returns `{"contacts": [...], "source": "<feed host>", "fetched_at": <utc epoch int>}`. All three feeds failing ⇒ raises `FeedUnavailable(Exception)`.

- [ ] **Step 1: Harvest LORAN's normalizer and fixture (read-only).** Locate and copy the shared fixture of real captured feed responses, then read the reference implementation:

```bash
git -C ../adsb-viz ls-tree -r main --name-only | grep -iE 'fixture|test' | head -20
git -C ../adsb-viz show main:backend/app/feeds/adsb.py > /tmp/loran-adsb.py   # reference only
# copy the fixture JSON file(s) found above into backend/tests/fixtures/ via git show > file
```

Fixtures are real captures — do not edit their contents. Never write into `../adsb-viz`.

- [ ] **Step 2: Write failing tests** (adapt names to the actual fixture file(s) found):

```python
# backend/tests/test_normalize.py
import json, pathlib
from app.feeds.adsb import normalize

FIX = pathlib.Path(__file__).parent / "fixtures"

def load(name):
    return json.loads((FIX / name).read_text())

def test_ac_envelope_and_fields():
    out = normalize(load("airplanes_live.json"))       # {"ac": [...]}
    assert out, "fixture should yield contacts"
    c = out[0]
    for key in ("hex", "flight", "t", "lat", "lon", "alt_geom",
                "alt_baro", "gs", "track", "baro_rate", "military", "seen_pos"):
        assert key in c

def test_aircraft_envelope():
    assert normalize(load("adsb_fi.json"))             # {"aircraft": [...]}

def test_ground_string_preserved():
    out = normalize({"ac": [{"hex": "a1b2c3", "lat": 30.0, "lon": -88.0,
                             "alt_baro": "ground"}]})
    assert out[0]["alt_baro"] == "ground"

def test_military_flag():
    out = normalize({"ac": [{"hex": "ae1234", "lat": 30.0, "lon": -88.0,
                             "dbFlags": 9}]})
    assert out[0]["military"] is True

def test_positionless_dropped():
    assert normalize({"ac": [{"hex": "a1b2c3"}]}) == []
```

(The two envelope tests use fixture data; the three behavior tests use minimal hand-built payloads — acceptable in tests because they exercise schema rules documented in CLAUDE.md, not display content.)

- [ ] **Step 3: Run, expect FAIL** (module missing).
- [ ] **Step 4: Implement `backend/app/feeds/adsb.py`** using `/tmp/loran-adsb.py` as the reference: keep envelope handling, field extraction, failover order, min-interval gate, short cache; drop anything LORAN-specific beyond that (geocode, tracks, extra endpoints). Target ≤ ~150 lines, boring and legible.
- [ ] **Step 5: Run tests, expect PASS.**
- [ ] **Step 6: Commit** — `git add backend && git commit -m "feat(backend): readsb normalizer + failover feed client (adapted from LORAN)"`

---

### Task 3: `/api/adsb` and `/api/type/{hex}` endpoints

**Files:**
- Create: `backend/app/feeds/adsbdb.py`
- Modify: `backend/app/main.py` (add two routes)
- Test: `backend/tests/test_api.py` (extend)

**Interfaces:**
- Produces: `GET /api/adsb?lat=&lon=&radius_nm=` → the `fetch_adsb` dict; 502 `{"detail": "all feeds unavailable"}` when `FeedUnavailable`. `GET /api/type/{hex}` → `{"type": str|None, "manufacturer": str|None, "registration": str|None}` from adsbdb `/aircraft/{hex}`; adsbdb miss/404 ⇒ all-None values with 200 (an honest "unknown", not an error); results cached in-process 24 h (plain dict, no new deps).
- Consumes: Task 2's `fetch_adsb`, `FeedUnavailable`.

- [ ] **Step 1: Write failing tests** (monkeypatch `fetch_adsb` and the adsbdb HTTP call — unit tests never hit real feeds):

```python
# append to backend/tests/test_api.py
def test_adsb_endpoint_proxies(monkeypatch):
    from app.feeds import adsb as feeds
    async def fake_fetch(settings, lat, lon, radius_nm):
        return {"contacts": [], "source": "test", "fetched_at": 0}
    monkeypatch.setattr(feeds, "fetch_adsb", fake_fetch)
    client = TestClient(create_app())
    r = client.get("/api/adsb?lat=30.69&lon=-88.04&radius_nm=80")
    assert r.status_code == 200 and r.json()["source"] == "test"

def test_adsb_endpoint_feeds_down(monkeypatch):
    from app.feeds import adsb as feeds
    async def dead(settings, lat, lon, radius_nm):
        raise feeds.FeedUnavailable()
    monkeypatch.setattr(feeds, "fetch_adsb", dead)
    client = TestClient(create_app())
    assert client.get("/api/adsb?lat=1&lon=2&radius_nm=10").status_code == 502

def test_type_unknown_is_honest_nones(monkeypatch):
    from app.feeds import adsbdb
    async def miss(settings, hexcode):
        return None
    monkeypatch.setattr(adsbdb, "lookup", miss)
    client = TestClient(create_app())
    r = client.get("/api/type/000000")
    assert r.status_code == 200
    assert r.json() == {"type": None, "manufacturer": None, "registration": None}
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — routes in `create_app()` import the modules (`from .feeds import adsb`, `from .feeds import adsbdb`) and call `adsb.fetch_adsb` / `adsbdb.lookup` *as module attributes* so monkeypatching works. `adsbdb.lookup(settings, hexcode)` does `GET {adsbdb_base}/aircraft/{hex}`, returns the response dict or `None`, with the 24 h dict cache keyed by hex.
- [ ] **Step 4: Run all backend tests, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(backend): /api/adsb and /api/type endpoints, honest failure states"`

---

### Task 4: Frontend scaffold — Vite, Tailwind-for-layout, tokens.css, Cesium assets

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/index.html`, `frontend/tailwind.config.js`, `frontend/postcss.config.js`, `frontend/scripts/copy-cesium-assets.sh`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/styles/tokens.css`, `frontend/src/styles/index.css`, `frontend/src/vite-env.d.ts`
- Modify: `.gitignore` (add `frontend/public/cesium/`)

**Interfaces:**
- Produces: `npm run dev` (copies Cesium assets then starts Vite with `/api` proxied to `127.0.0.1:8010`), `npm run build`, `npm run test` (vitest), `npm run typecheck`. `window.CESIUM_BASE_URL = '/cesium'`. tokens.css custom properties: `--bg: #05070a; --amber: #ffb000; --cyan: #5fd7e0; --grid: #1a222c; --text: #c8d3d9;` font stack `"JetBrains Mono", "IBM Plex Mono", monospace`; utility classes `.panel` (1px border, translucent `rgba(5,7,10,0.82)` background, bracket corners via ::before/::after) and `.label` (uppercase, letterspaced 0.08em, 11px).

- [ ] **Step 1: Scaffold.** `npm create vite@latest frontend -- --template react-ts` layout by hand (files above; do not run the interactive scaffolder). Key configs:

```ts
// frontend/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: { CESIUM_BASE_URL: JSON.stringify("/cesium") },
  server: { proxy: { "/api": "http://127.0.0.1:8010" } },
});
```

```bash
# frontend/scripts/copy-cesium-assets.sh — idempotent, runs before dev/build
set -e
cd "$(dirname "$0")/.."
mkdir -p public/cesium
cp -r node_modules/cesium/Build/Cesium/{Assets,Widgets,Workers,ThirdParty} public/cesium/
```

`package.json` scripts: `"predev": "bash scripts/copy-cesium-assets.sh"`, `"prebuild"` same, `"dev": "vite"`, `"build": "tsc -b && vite build"`, `"test": "vitest run"`, `"typecheck": "tsc --noEmit"`. Cesium assets are **gitignored, not committed** (unlike LORAN — keeps the open-source repo lean; decision noted in docs/decisions.md as G-004 in Task 8).

`App.tsx` for now: full-viewport near-black div with a `.panel` placeholder reading `ADSB-GAME — PHASE A` (removed in Task 6; layout via Tailwind flex utilities only).

- [ ] **Step 2: Verify** — `cd frontend && npm install && npm run typecheck && npm run build`. Expected: clean build; `public/cesium/` populated and ignored by git (`git status` shows no cesium assets).
- [ ] **Step 3: Commit** — `git add frontend .gitignore && git commit -m "feat(frontend): Vite+React+Cesium scaffold, tokens.css, assets copied not committed"`

---

### Task 5: Contact type, API wrappers, Zustand store with polling

**Files:**
- Create: `frontend/src/data/types.ts`, `frontend/src/data/api.ts`, `frontend/src/state/store.ts`
- Test: `frontend/src/state/store.test.ts`

**Interfaces:**
- Produces:

```ts
// types.ts
export type Contact = {
  hex: string; flight: string | null; t: string | null;
  lat: number; lon: number;
  alt_geom: number | null; alt_baro: number | "ground" | null;
  gs: number | null; track: number | null; baro_rate: number | null;
  military: boolean; seen_pos: number | null;
};
export type FeedStatus = "live" | "stale" | "offline";

// api.ts
export async function fetchConfig(): Promise<{ home: { lat: number; lon: number } }>;
export async function fetchAdsb(lat: number, lon: number, radiusNm: number):
  Promise<{ contacts: Contact[]; source: string; fetched_at: number }>;
  // non-2xx ⇒ throws FeedDownError

// store.ts (zustand)
type State = {
  home: { lat: number; lon: number } | null;
  contacts: Map<string, Contact>;
  selectedHex: string | null;
  feedStatus: FeedStatus; feedSource: string | null; lastFetchAt: number | null;
  setHome(h: { lat: number; lon: number }): void;
  applyFetch(r: { contacts: Contact[]; source: string; fetched_at: number }): void;
  markFetchFailed(): void;   // OFFLINE after 3 consecutive failures, STALE before that
  select(hex: string | null): void;
};
export const useStore: UseBoundStore<StoreApi<State>>;
export function startPolling(intervalMs?: number): () => void; // default 5000, returns stop()
```

- [ ] **Step 1: Write failing store tests**

```ts
// frontend/src/state/store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./store";

const contact = (hex: string): any => ({
  hex, flight: null, t: null, lat: 30, lon: -88, alt_geom: 3500,
  alt_baro: 3400, gs: 120, track: 90, baro_rate: 0, military: false, seen_pos: 1,
});

beforeEach(() => useStore.getState().applyFetch({ contacts: [], source: "t", fetched_at: 0 }));

describe("store", () => {
  it("applyFetch replaces the contact set and goes live", () => {
    useStore.getState().applyFetch({ contacts: [contact("abc123")], source: "airplanes.live", fetched_at: 111 });
    const s = useStore.getState();
    expect(s.contacts.get("abc123")).toBeTruthy();
    expect(s.feedStatus).toBe("live");
    expect(s.feedSource).toBe("airplanes.live");
  });
  it("selection survives a refresh while the contact exists, clears when it ages out", () => {
    useStore.getState().applyFetch({ contacts: [contact("abc123")], source: "t", fetched_at: 1 });
    useStore.getState().select("abc123");
    useStore.getState().applyFetch({ contacts: [contact("abc123")], source: "t", fetched_at: 2 });
    expect(useStore.getState().selectedHex).toBe("abc123");
    useStore.getState().applyFetch({ contacts: [], source: "t", fetched_at: 3 });
    expect(useStore.getState().selectedHex).toBeNull();
  });
  it("three consecutive failures = offline, one success recovers", () => {
    const s = () => useStore.getState();
    s().markFetchFailed(); expect(s().feedStatus).toBe("stale");
    s().markFetchFailed(); s().markFetchFailed();
    expect(s().feedStatus).toBe("offline");
    s().applyFetch({ contacts: [], source: "t", fetched_at: 9 });
    expect(s().feedStatus).toBe("live");
  });
});
```

- [ ] **Step 2: Run `npm run test`, expect FAIL.** (Install nothing new — zustand and vitest came in Task 4's package.json.)
- [ ] **Step 3: Implement** `types.ts`, `api.ts` (thin `fetch` wrappers, `FeedDownError extends Error`), `store.ts`. `startPolling`: `fetchConfig` once for home, then interval: `fetchAdsb(home.lat, home.lon, 80)` → `applyFetch`, catch → `markFetchFailed`. Radius 80 nm fixed this phase.
- [ ] **Step 4: Run tests + typecheck, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(frontend): contact store, honest feed status, polling client"`

---

### Task 6: Icons + billboard sync (pure logic tested; Cesium mutation thin)

**Files:**
- Create: `frontend/src/globe/icons.ts`, `frontend/src/globe/contactBillboards.ts`
- Test: `frontend/src/globe/icons.test.ts`, `frontend/src/globe/contactBillboards.test.ts`

**Interfaces:**
- Produces: `icons.ts`: `contactColor(c: Contact): string` (military ⇒ `#ffb000`, else `#5fd7e0`), `contactRotationRad(track: number | null): number` (0 when track null; Cesium billboard `rotation` is CCW-positive while track is CW-from-north ⇒ returns `-track * π/180`), `makeChevronCanvas(colorHex: string): HTMLCanvasElement` (32×32, stroked chevron pointing up).
- Produces: `contactBillboards.ts`: `diffContacts(prev: Set<string>, next: Map<string, Contact>): { added: string[]; removed: string[]; kept: string[] }` (pure, tested) and `syncBillboards(collection: Cesium.BillboardCollection, byHex: Map<string, Billboard>, contacts: Map<string, Contact>, selectedHex: string | null): void` — mutates `position`/`rotation`/`color`/`scale` in place, add/remove only on membership change (LORAN `aircraftLayer.ts` lesson; scale 1.4 when selected). Billboard `id` = hex string (used by picking in Task 7).

- [ ] **Step 1: Write failing tests** for `contactColor`, `contactRotationRad` (track 90 ⇒ −π/2; null ⇒ 0), and `diffContacts` (added/removed/kept partition — three small cases). Canvas creation and `syncBillboards` are exercised in the browser, not unit-tested (vitest has no canvas/Cesium; do not add a mock library).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement both modules.** `syncBillboards` body: `diffContacts` → remove removed (and delete from `byHex`), add added (`collection.add({ id: hex, position, image: cached canvas per color, rotation, ... })` with the two canvases created once at module init), then for kept: set `position` (`Cartesian3.fromDegrees(lon, lat)` — browse is top-down, height 0), `rotation`, `scale`.
- [ ] **Step 4: Run tests, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(frontend): chevron icons and in-place billboard sync"`

---

### Task 7: BrowseGlobe — keyless viewer, Esri imagery, click-to-select

**Files:**
- Create: `frontend/src/globe/BrowseGlobe.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `useStore` (contacts, selectedHex, select, home), `syncBillboards`, `startPolling`.
- Produces: `<BrowseGlobe />` — full-viewport Cesium canvas. Viewer options: `{ imageryProvider: ArcGisMapServerImageryProvider (World_Imagery URL), terrainProvider: new EllipsoidTerrainProvider(), baseLayerPicker/timeline/animation/geocoder/homeButton/navigationHelpButton/sceneModePicker/fullscreenButton: false, requestRenderMode: false }` with `Ion.defaultAccessToken = null` set before construction (module top). Camera: top-down at home, `Cartesian3.fromDegrees(home.lon, home.lat, 250_000)` looking straight down. `ScreenSpaceEventHandler` LEFT_CLICK → `scene.pick` → if picked id is a known hex, `select(hex)`, else `select(null)`. Cesium's default credit container stays visible (Esri attribution).

- [ ] **Step 1: Implement** the component: one `useEffect` to construct viewer + billboard collection + click handler + `startPolling()` (cleanup destroys all three); one `useEffect` subscribing to store changes calling `syncBillboards`. Mount it in `App.tsx` (replacing the Task 4 placeholder) under a flex root that also reserves a right rail for Task 8.
- [ ] **Step 2: Verify against the real backend** (this is the phase's first live test — real feeds, real screen):

```bash
cd backend && cp ../.env.example ../.env; .venv/bin/uvicorn app.main:app --port 8010 &
cd frontend && npm run dev
```

Open the dev URL: expect satellite globe over Mobile, live chevrons moving on 5 s polls, cyan civil / amber military, click selects (scale bump). If feeds are down: no invented aircraft — empty globe is correct (status honesty lands in Task 8). `npm run typecheck` clean.
- [ ] **Step 3: Commit** — `git commit -am "feat(frontend): keyless browse globe with live contacts and picking"`

---

### Task 8: Contact list, status bar, disabled TAKE CONTROLS, decision log

**Files:**
- Create: `frontend/src/panels/ContactList.tsx`, `frontend/src/panels/StatusBar.tsx`
- Modify: `frontend/src/App.tsx`, `docs/decisions.md`

**Interfaces:**
- Consumes: `useStore`.
- Produces: right-rail `.panel` list — one row per contact sorted by callsign-then-hex: `flight ?? "—"`, `t ?? "—"`, `alt_baro === "ground" ? "GND" : alt_geom ?? alt_baro ?? "—"` (ft, right-aligned), `gs ?? "—"` (kt, right-aligned), amber row text when military, highlighted when selected, click ⇒ `select(hex)`. Selected contact footer: **TAKE CONTROLS** button, `disabled`, `title="Phase C"` — honest about not existing yet. `StatusBar` bottom strip: feed chip (`LIVE <source>` cyan / `STALE` amber / `OFFLINE` amber with "feeds unreachable" text), contact count, UTC clock, and the static line `IMAGERY © ESRI`.

- [ ] **Step 1: Implement both components + wire into App** (flex: globe flex-1, rail 320px, status bar bottom). Numeric values right-aligned against left-aligned `.label`s; em-dash for every unknown; no rounded corners; no shadows.
- [ ] **Step 2: Verify in browser** — list matches globe, selection syncs both directions, kill the backend mid-session and watch the chip walk LIVE → STALE → OFFLINE with no fake contacts lingering past the next successful fetch cycle; restart backend, watch recovery.
- [ ] **Step 3: Append to `docs/decisions.md`:** `G-004 · Cesium static assets copied at build time, not committed` — LORAN commits ~430 asset files; adsb-game copies from `node_modules` in `predev`/`prebuild` instead, keeping the public repo lean. Trade-off: `npm install` required before first run (true anyway).
- [ ] **Step 4: Run full frontend suite** — `npm run test && npm run typecheck && npm run build`. Expected: green.
- [ ] **Step 5: Commit** — `git commit -am "feat(frontend): contact list, honest feed status bar, disabled TAKE CONTROLS"`

---

### Task 9: Docker Compose + bare-metal script + run docs

**Files:**
- Create: `docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/nginx.conf`, `scripts/dev.sh`
- Modify: `README.md` (a "Running it" section)

**Interfaces:**
- Produces: `docker compose up --build` serves the app on `:8080` (nginx: static `dist` + `/api` proxied to the backend container); `bash scripts/dev.sh` runs both dev servers bare-metal.

- [ ] **Step 1: Write the four files.**

```yaml
# docker-compose.yml
services:
  backend:
    build: ./backend
    env_file: .env
    environment: { ADSB_GAME_HOST: 0.0.0.0 }
  frontend:
    build: ./frontend
    ports: ["8080:80"]
    depends_on: [backend]
```

`backend/Dockerfile`: `python:3.12-slim`, copy `requirements.txt` + `app/`, pip install, `CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010"]`. `frontend/Dockerfile`: two-stage — `node:22` build (`npm ci && npm run build`), `nginx:alpine` serving `dist/` with `nginx.conf` proxying `/api` → `http://backend:8010`. `scripts/dev.sh`: starts uvicorn (background, trap to kill) + `npm run dev`, single file, no absolute paths.
- [ ] **Step 2: Verify the container path for real** — `docker compose up --build`, open `:8080`, confirm live contacts render (the built container, not just the dev server — LORAN discipline). Then `docker compose down`.
- [ ] **Step 3: Update README "Running it"** — the compose one-liner and the bare-metal pair, each a single copy-pasteable line.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: docker compose + bare-metal dev path"`

---

### Task 10: Phase A close-out

- [ ] **Step 1: Full verification sweep** — backend `pytest` green, frontend `vitest`+`typecheck`+`build` green, compose build green, live browse screen demonstrated (screenshot for the owner).
- [ ] **Step 2: Update CLAUDE.md phase list** — mark Phase A ✅ with one line of what shipped.
- [ ] **Step 3: Commit, show the owner, STOP.** Phase B (sim core) does not start without sign-off — CLAUDE.md ground rule 5.

## Self-Review (done at write time)

- **Spec coverage:** spec §10 backend (both endpoints, honest failures) → Tasks 1–3; §3 stack/scaffold → Task 4; browse screen + selection (§5 BROWSE) → Tasks 5–8; §2 honesty seam in browse (em-dash, offline states, real-only contacts) → Tasks 5, 8; Docker+bare-metal (§3, CLAUDE.md rule 7) → Task 9; phase gate (rule 5) → Task 10. Airborne-only takeover filtering and the handoff dialog are Phase C scope (spec §5) — deliberately absent here beyond the disabled button.
- **Placeholders:** none — every code step has content or an exact source-and-adapt command.
- **Type consistency:** `Contact` (Task 5) matches normalizer output keys (Task 2); `syncBillboards`/`diffContacts` names used in Tasks 6–7 match; `fetch_adsb`/`FeedUnavailable`/`lookup` consistent across Tasks 2–3.
