# adsb-game

Pick a real aircraft off live ADS-B, take the controls, and fly it first-person over real
satellite imagery and real terrain — until you crash, land, or quit. The real aircraft
keeps flying on the feed as a ghost while yours diverges.

Browser-based (CesiumJS), self-hosted, single-user, MIT. Sibling of
[LORAN](https://github.com/iamneilroberts/LORAN).

**Status: design phase.** The approved spec lives at
[`docs/superpowers/specs/2026-07-27-adsb-game-design.md`](docs/superpowers/specs/2026-07-27-adsb-game-design.md);
supporting research in [`docs/research/`](docs/research/). No application code yet.

## What it will be

- **Browse** — minimal live ADS-B display around a home location (backend-proxied,
  rate-limited, honest empty states).
- **Take controls** — snapshot a real contact's position/altitude/heading/speed; its type
  maps to one of three flight-model classes (GA piston / airliner / fighter).
- **Fly** — simplified 6-DOF physics where class character emerges from parameters
  (a 737 rolls like 79 tonnes; a 172 stalls soft and mushy; the fighter has afterburner).
- **End** — terrain contact anywhere on Earth, or a building inside a ~25 km bubble,
  ends the session with a stats card. Gentle, level, slow touchdowns read LANDED.

## Attribution

Imagery © Esri World Imagery · Terrain: Re:Earth Terrain · Mapterhorn (CC BY 4.0) ·
Buildings (when active): Overture Maps / © OpenStreetMap contributors · Live traffic:
airplanes.live, adsb.lol, adsb.fi · Aircraft data: adsbdb.
