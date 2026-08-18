/*
 * Tap another aircraft in flight, get this: a compact terminal callout with what the feed said
 * about that contact, plus its range + bearing from own ship (#86). Deliberately smaller than the
 * BROWSE-side TrafficDetailCard — no adsbdb enrichment fetch, just the live-feed fields — because
 * it rides over the flying view and must not steal focus.
 *
 * Only a REAL contact is ever shown: identifiedHex is set by a pick that hit a live billboard
 * (ViewerHost + pickRouting), and the body resolves it against the live contact map, rendering
 * nothing if it has left the feed. Own-ship and the origin ghost render through separate paths and
 * are not in that map as "other aircraft" — tapping the ghost would at most show the real contact
 * the flight was seeded from, which is honest. Every field the feed omitted is an em-dash.
 *
 * Split like TrafficDetailCard: `IdentifiedContactBody` is hook-free (and holds every test);
 * the default export reads the store + HUD snapshot and gates on mode.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { Cartesian3, SceneTransforms } from "cesium";
import type { Contact } from "../data/types";
import { checkEligibility } from "../takeover/eligibility";
import { useStore } from "../state/store";
import { useViewer } from "../globe/viewerContext";
import { hudSnapshot } from "../hud/snapshot";
import { EM_DASH } from "../hud/format";
import { contactHeightM } from "../data/contactGeo";
import { mToFt } from "../sim/units";
import { bearingDeg, rangeNm } from "../dashboard/geoRange";
import {
  calloutAnchor,
  CALLOUT_PANEL_SIZE,
  CALLOUT_MARGINS_DESKTOP,
  CALLOUT_MARGINS_MOBILE,
} from "./calloutAnchor";

/** Matches the tokens.css `.identify-callout` mobile breakpoint (max-width: 1023px). */
const MOBILE_BREAKPOINT_PX = 1024;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="handoff-row">
      <span className="label">{label}</span>
      <span className="handoff-value">{value}</span>
    </div>
  );
}

const orDash = (v: string | number | null | undefined, suffix = ""): string =>
  v === null || v === undefined || v === "" ? EM_DASH : `${v}${suffix}`;

/** Placed height, feet — alt_geom only, the same rule the billboard uses (data/contactGeo). */
function altLine(c: Contact): string {
  const h = contactHeightM(c);
  return h === null ? EM_DASH : `${Math.round(mToFt(h))} FT`;
}

/**
 * In-flight TAKE CONTROLS affordance (#6). When present, the callout offers taking over the shown
 * contact; `eligible`/`reason` come from the SAME predicate the action itself checks, so the button
 * is never enabled for a contact that would be refused, and the disabled tooltip names why. A
 * two-step confirm (owner decision) guards the flight-ending swap.
 */
export type TakeoverProps = {
  eligible: boolean;
  reason: string | null;
  confirming: boolean;
  onRequest(): void;
  onConfirm(): void;
  onCancel(): void;
};

export function IdentifiedContactBody({ contact, own, onClose, style, takeover }: {
  contact: Contact;
  own: { latDeg: number; lonDeg: number } | null;
  onClose(): void;
  /** Screen position (#86 anchor-to-target); omitted in tests, which don't check layout. */
  style?: { left: string; top: string };
  /** Take-controls affordance (#6); omitted (e.g. in unit tests) renders the read-only callout. */
  takeover?: TakeoverProps;
}) {
  const callsign = contact.flight?.trim();
  const rangeStr = own === null
    ? EM_DASH
    : `${rangeNm(own.latDeg, own.lonDeg, contact.lat, contact.lon).toFixed(1)} NM`;
  const bearingStr = own === null
    ? EM_DASH
    : `${String(Math.round(bearingDeg(own.latDeg, own.lonDeg, contact.lat, contact.lon)) % 360)
        .padStart(3, "0")}°`;

  return (
    <div className="identify-callout panel" style={style}>
      <div className="label handoff-title">CONTACT</div>
      <Row label="CALLSIGN" value={orDash(callsign ? callsign : null)} />
      <Row label="HEX" value={contact.hex.toUpperCase()} />
      <Row label="TYPE" value={orDash(contact.t)} />
      <Row label="ALT" value={altLine(contact)} />
      <Row label="GND SPD" value={orDash(contact.gs === null ? null : Math.round(contact.gs), " KT")} />
      <Row label="RANGE" value={rangeStr} />
      <Row label="BEARING" value={bearingStr} />
      {takeover && (takeover.confirming ? (
        <div className="identify-takeover">
          <button type="button" className="control-button control-button-takeover" onClick={takeover.onConfirm}>
            CONFIRM
          </button>
          <button type="button" className="control-button" onClick={takeover.onCancel}>CANCEL</button>
        </div>
      ) : (
        <button
          type="button"
          className="control-button control-button-takeover"
          disabled={!takeover.eligible}
          title={takeover.eligible ? undefined : takeover.reason ?? undefined}
          onClick={takeover.onRequest}
        >
          TAKE CONTROLS
        </button>
      ))}
      <button type="button" className="control-button" onClick={onClose}>CLOSE</button>
    </div>
  );
}

export default function IdentifiedContactCallout({ onTakeControls }: {
  /** Take controls of the shown contact (#6). Omitted -> the callout stays read-only (identify). */
  onTakeControls?(contact: Contact): void;
} = {}) {
  const mode = useStore((s) => s.mode);
  const identifiedHex = useStore((s) => s.identifiedHex);
  const contact = useStore((s) => (identifiedHex === null ? undefined : s.contacts.get(identifiedHex)));
  const snapshot = useSyncExternalStore(hudSnapshot.subscribe, hudSnapshot.get, hudSnapshot.get);
  const bundle = useViewer();
  // Two-step confirm for the flight-swapping takeover (owner: select, then TAKE CONTROLS). Reset
  // whenever the identified contact changes so a stale confirm can't carry over to a new target.
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setConfirming(false), [identifiedHex]);

  // Belt-and-braces gate: the mount site already limits this to FLYING/PAUSED, but self-gating
  // keeps the component honest if it is ever mounted elsewhere.
  if (mode !== "FLYING" && mode !== "PAUSED") return null;
  // The contact left the feed (or was never known): show nothing rather than a frozen callout.
  if (identifiedHex === null || contact === undefined) return null;

  const own = snapshot === null ? null : { latDeg: snapshot.latDeg, lonDeg: snapshot.lonDeg };

  // Anchor the panel next to the tapped target (#86), reusing the exact world -> window
  // projection pattern from globe/TrafficOverlay.tsx: reject points behind the camera via the
  // dot product, then SceneTransforms for the pixel position. `contactHeightM` is the same
  // alt_geom rule the billboard/ALT row use; a contact without alt_geom is placed at the
  // ellipsoid surface (height 0) as a best-effort anchor rather than not projecting at all —
  // the panel still needs somewhere honest to point, even though ALT itself will read em-dash.
  let projected: { x: number; y: number } | null = null;
  const scene = bundle?.viewer.scene ?? null;
  if (scene !== null) {
    const heightM = contactHeightM(contact) ?? 0;
    const world = Cartesian3.fromDegrees(contact.lon, contact.lat, heightM);
    const toContact = Cartesian3.subtract(world, scene.camera.positionWC, new Cartesian3());
    if (Cartesian3.dot(toContact, scene.camera.directionWC) > 0) {
      const win = SceneTransforms.worldToWindowCoordinates(scene, world);
      projected = win ? { x: win.x, y: win.y } : null;
    }
  }
  const viewportWidthPx = scene?.canvas.clientWidth ?? window.innerWidth;
  const viewportHeightPx = scene?.canvas.clientHeight ?? window.innerHeight;
  const margins = viewportWidthPx < MOBILE_BREAKPOINT_PX ? CALLOUT_MARGINS_MOBILE : CALLOUT_MARGINS_DESKTOP;
  const { leftPx, topPx } = calloutAnchor(
    projected,
    { widthPx: viewportWidthPx, heightPx: viewportHeightPx },
    CALLOUT_PANEL_SIZE,
    margins,
  );

  // Only offer TAKE CONTROLS when a handler is wired (FlightSession passes one; tests do not). The
  // button's enabled state and its disabled tooltip come from the SAME predicate the action checks.
  let takeover: TakeoverProps | undefined;
  if (onTakeControls !== undefined) {
    const elig = checkEligibility(contact);
    takeover = {
      eligible: elig.eligible,
      reason: elig.eligible ? null : elig.reason,
      confirming,
      onRequest: () => setConfirming(true),
      onCancel: () => setConfirming(false),
      onConfirm: () => {
        setConfirming(false);
        onTakeControls(contact);
        useStore.getState().setIdentifiedHex(null);
      },
    };
  }

  return (
    <IdentifiedContactBody
      contact={contact}
      own={own}
      onClose={() => useStore.getState().setIdentifiedHex(null)}
      style={{ left: `${leftPx}px`, top: `${topPx}px` }}
      takeover={takeover}
    />
  );
}
