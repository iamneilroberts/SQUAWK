/*
 * Bottom status strip: honest feed health (LIVE/STALE/OFFLINE), live contact count, a UTC
 * clock, and the static Esri attribution line. The clock ticks on a plain 1s interval,
 * cleaned up on unmount — no fancier scheduling needed for a display-only readout.
 */
import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import type { FeedStatus, ShipFeedStatus } from "../data/types";
import { attributionFor, type BasemapKind } from "../globe/mapSources";

export function formatUtcClock(now: Date): string {
  return now.toISOString().slice(11, 19) + "Z";
}

export function feedChipLabel(status: FeedStatus, source: string | null): string {
  if (status === "live") return `LIVE ${source ?? "—"}`;
  return status.toUpperCase();
}

// Independent of feedChipLabel/the ADS-B chip: the AIS feed can be down while aircraft
// stay LIVE, and vice versa — each chip reads only its own feed's status.
export function aisChipLabel(status: ShipFeedStatus, source: string | null): string {
  if (status === "live") return `AIS LIVE ${source ?? "—"}`;
  // "nodata": socket connected, but no messages recently (aisstream's keepalive
  // masks an upstream outage) — degraded, not confidently live, not offline.
  if (status === "nodata") return `AIS NO DATA ${source ?? "—"}`;
  return `AIS ${status.toUpperCase()}`;
}

/**
 * Honest terrain-tier readout (spec's degrade-honestly rule): cyan for a real terrain source
 * (Re:Earth or the ion fallback), amber for the flat-ellipsoid warning. Null (not yet attached)
 * reads as nominal so the chip doesn't flash amber before the first attachTerrain resolves.
 */
export function terrainChipClass(note: string | null): string {
  return note !== null && note.includes("UNAVAILABLE") ? "status-chip-warn" : "status-chip-live";
}

const RADIUS_PRESETS_NM = [40, 80, 150, 250];

/** Cycles the feed-radius preset ladder; an unrecognized current value resets to the first preset. */
export function nextRadius(current: number): number {
  const i = RADIUS_PRESETS_NM.indexOf(current);
  return RADIUS_PRESETS_NM[(i + 1) % RADIUS_PRESETS_NM.length];
}

export function radiusChipLabel(n: number): string {
  return `RADIUS ${n} NM`;
}

export function basemapChipLabel(k: BasemapKind): string {
  return `MAP ${k}`;
}

/** Two basemaps, so the chip is a straight toggle rather than the radius chip's ladder. */
export function nextBasemap(k: BasemapKind): BasemapKind {
  return k === "SAT" ? "CHART" : "SAT";
}

export function labelsChipLabel(on: boolean): string {
  return on ? "LABELS ON" : "LABELS OFF";
}

/** Other-aircraft (#85) visibility chip — mirrors labelsChipLabel's on/off shape. */
export function aircraftChipLabel(on: boolean): string {
  return on ? "AIRCRAFT" : "AIRCRAFT HIDDEN";
}

/** Mobile contacts drawer toggle label — the live count in brackets (spec §2.1, `CONTACTS [n]`). */
export function contactsChipLabel(count: number): string {
  return `CONTACTS [${count}]`;
}

/**
 * Which StatusBar regions render (#13 immersive mode). In immersive/fullscreen flight the bar
 * collapses to the two things the honesty + attribution rules forbid dropping — the honest
 * feed-status chip (which also names the live traffic source) and the imagery/terrain attribution
 * line — and hides the browse chrome (contacts, radius, basemap, labels, clock, terrain-tier
 * chip). Normal mode (desktop, browse, non-immersive mobile flight) shows everything, exactly as
 * before, so desktop is unchanged. feedStatus and attribution are NEVER conditional on
 * `decluttered` — that would violate the same honesty/attribution rules (CLAUDE.md, immersive.ts);
 * `decluttered` only ever affects the tiny API debug chip, which is dev-facing chrome, not a
 * required disclosure.
 */
export function statusBarRegions(immersive: boolean, decluttered: boolean = false): {
  feedStatus: boolean;
  attribution: boolean;
  browseControls: boolean;
  clock: boolean;
  /** Portrait declutter (#89 follow-up): the cache-age/system-mode debug chip is secondary
   *  chrome, so it hides while decluttered — only while immersive, so desktop/browse keep it. */
  apiDebug: boolean;
} {
  return {
    feedStatus: true,
    attribution: true,
    browseControls: !immersive,
    clock: !immersive,
    apiDebug: !(immersive && decluttered),
  };
}

type StatusBarProps = {
  /** Bridged down from App.tsx, which gets it from ViewerHost — not zustand (see App.tsx). */
  terrainNote: string | null;
  /**
   * When present (narrow browse only), the CONTACTS readout becomes the drawer toggle. When
   * absent (desktop, or any non-browse mode) the readout stays the plain count span it always
   * was — so desktop renders exactly as before.
   */
  contactsChip?: { open: boolean; onToggle: () => void };
  /**
   * True in mobile immersive/fullscreen flight: the bar collapses to feed-status + attribution
   * (see statusBarRegions). Absent/false everywhere else, so desktop and browse are unchanged.
   */
  immersive?: boolean;
  /**
   * True while the video-player auto-hide has faded the informational chrome (immersive + idle).
   * The bar transitions to opacity 0 but stays in the DOM and reappears on tap — attribution is
   * faded, never removed (CLAUDE.md data-sources legal safeguard).
   */
  faded?: boolean;
  /** Manual declutter (#57/#89): hides the secondary API debug chip while immersive. Never
   *  affects feedStatus/attribution — see statusBarRegions. */
  decluttered?: boolean;
};

export default function StatusBar(
  { terrainNote, contactsChip, immersive = false, faded = false, decluttered = false }: StatusBarProps,
) {
  const feedStatus = useStore((s) => s.feedStatus);
  const feedSource = useStore((s) => s.feedSource);
  const shipFeedStatus = useStore((s) => s.shipFeedStatus);
  const shipSource = useStore((s) => s.shipSource);
  const tutorial = useStore((s) => s.tutorial);
  const contactCount = useStore((s) => s.contacts.size);
  const cacheAgeSeconds = useStore((s) => s.cacheAgeSeconds);
  const systemMode = useStore((s) => s.systemMode);
  const radiusNm = useStore((s) => s.radiusNm);
  const setRadiusNm = useStore((s) => s.setRadiusNm);
  const basemap = useStore((s) => s.basemap);
  const setBasemap = useStore((s) => s.setBasemap);
  const labelsOn = useStore((s) => s.labelsOn);
  const setLabelsOn = useStore((s) => s.setLabelsOn);
  const showOtherAircraft = useStore((s) => s.showOtherAircraft);
  const setShowOtherAircraft = useStore((s) => s.setShowOtherAircraft);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const chipClass = feedStatus === "live" ? "status-chip-live" : "status-chip-warn";
  const aisChipClass = shipFeedStatus === "live" ? "status-chip-live" : "status-chip-warn";
  const regions = statusBarRegions(immersive, decluttered);
  const className =
    "status-bar" +
    (immersive ? " status-bar-immersive" : "") +
    (faded ? " status-bar-faded" : "");

  return (
    <div className={className}>
      <span className={tutorial === null ? chipClass : "status-chip-live"}>
        {tutorial === null ? feedChipLabel(feedStatus, feedSource) : "TUTORIAL · NO LIVE TRAFFIC"}
      </span>
      {tutorial === null && feedStatus === "offline" && (
        <span className="status-chip-warn">FEEDS UNREACHABLE</span>
      )}
      {/* Ships (AIS) get their own honest status chip, independent of the aircraft feed above:
          either can be LIVE while the other is OFFLINE/NO DATA. Hidden in tutorial/free-flight
          alongside the aircraft chip, which those modes replace with the NO-LIVE-TRAFFIC notice. */}
      {tutorial === null && (
        <span className={aisChipClass}>{aisChipLabel(shipFeedStatus, shipSource)}</span>
      )}
      {/* Tiny API debug chip (owner 2026-08-12): cache age + non-NORMAL capacity mode, so
          "is it me or the feed?" is answerable at a glance. Honest: no age = em-dash. Hidden
          while decluttered+immersive (#89 follow-up) — dev-facing chrome, not a required
          disclosure like feedStatus/attribution above. */}
      {regions.apiDebug && tutorial === null && (
        <span className={systemMode === "NORMAL" ? "status-chip-live" : "status-chip-warn"}>
          {`API ${cacheAgeSeconds === null ? "—" : `${Math.round(cacheAgeSeconds)}S`}${
            systemMode === "NORMAL" ? "" : ` · ${systemMode.replace("_", "-")}`
          }`}
        </span>
      )}
      {regions.browseControls && terrainNote !== null && (
        <span className={terrainChipClass(terrainNote)}>{terrainNote}</span>
      )}
      {regions.browseControls && (
        <>
          {contactsChip ? (
            <button
              type="button"
              className={contactsChip.open ? "status-chip-button status-chip-button-active" : "status-chip-button"}
              aria-expanded={contactsChip.open}
              onClick={contactsChip.onToggle}
            >
              {contactsChipLabel(contactCount)}
            </button>
          ) : (
            <span>CONTACTS {contactCount}</span>
          )}
          <button
            type="button"
            className="status-chip-button"
            onClick={() => setRadiusNm(nextRadius(radiusNm))}
          >
            {radiusChipLabel(radiusNm)}
          </button>
          <button type="button" className="status-chip-button"
            onClick={() => setBasemap(nextBasemap(basemap))}>
            {basemapChipLabel(basemap)}
          </button>
          <button
            type="button"
            className={labelsOn ? "status-chip-button status-chip-button-active" : "status-chip-button"}
            onClick={() => setLabelsOn(!labelsOn)}
          >
            {labelsChipLabel(labelsOn)}
          </button>
          <button
            type="button"
            className={showOtherAircraft ? "status-chip-button status-chip-button-active" : "status-chip-button"}
            onClick={() => setShowOtherAircraft(!showOtherAircraft)}
          >
            {aircraftChipLabel(showOtherAircraft)}
          </button>
        </>
      )}
      {regions.clock && <span>{formatUtcClock(now)}</span>}
      <span className="flex-1" />
      {/* AIS attribution shown only while the ship feed is active (CLAUDE.md: attribution when
          active) — a required disclosure, so never gated by immersive/declutter. */}
      {tutorial === null && shipFeedStatus !== "offline" && (
        <span className="status-attribution">AIS · aisstream.io</span>
      )}
      {/* #81: in mobile flight the attribution goes compact so it fits over the touch controls. */}
      <span className="status-attribution">{attributionFor({ basemap, labelsOn, terrainNote, compact: immersive })}</span>
    </div>
  );
}
