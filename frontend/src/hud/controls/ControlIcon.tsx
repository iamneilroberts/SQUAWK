/*
 * The #48 control-state mini-instruments. Hook-free like AttitudeIndicator so the tests walk
 * the returned element tree without jsdom. All geometry comes from ControlIconMath; this file
 * only turns numbers into strokes. Cyan = nominal, amber = warning/active, grey = track/detent
 * — the only three stroke roles (spec visual language). fill:none throughout.
 */
import type { HudSnapshot } from "../snapshot";
import {
  throttleKnobY, throttleWarn, flapDroopEnd, trimNeedle, gearGlyph, speedbrakeOut,
} from "./ControlIconMath";

export type ControlIconKind = "throttle" | "flaps" | "trim" | "gear" | "speedbrake";

const CY = "ci-cy", AM = "ci-am", GR = "ci-gr";
const r = (n: number): number => Math.round(n * 100) / 100;

/*
 * A plain function (not a JSX component) so the returned node's `type` is the literal string
 * "svg" — the tests walk the element tree and assert on `.type` directly, which a wrapping
 * component (`<Frame>…</Frame>`, type === Frame) would defeat.
 */
function frame(children: React.ReactNode) {
  return (
    <svg viewBox="0 0 40 38" className="control-icon" role="img" aria-hidden="true">
      {children}
    </svg>
  );
}

export default function ControlIcon({
  kind, snapshot,
}: { kind: ControlIconKind; snapshot: HudSnapshot | null; size?: number }) {
  if (kind === "throttle") {
    const y = throttleKnobY(snapshot?.throttle ?? null);
    const acc = throttleWarn(snapshot?.throttle ?? null) ? AM : CY;
    return frame(
      <>
        <line className={GR} x1="20" y1="6" x2="20" y2="32" />
        <line className={GR} x1="15" y1="6" x2="20" y2="6" />
        <line className={GR} x1="15" y1="19" x2="18" y2="19" />
        <line className={GR} x1="15" y1="32" x2="20" y2="32" />
        {y !== null && <line className={acc} x1="11" y1={r(y)} x2="29" y2={r(y)} />}
        {y !== null && <rect className={acc} x="17.5" y={r(y - 2.5)} width="5" height="5" />}
      </>
    );
  }
  if (kind === "flaps") {
    // Pass the raw nullable detent through so flapDroopEnd's own known()-guard hides the droop on an
    // unknown snapshot, matching the throttle/trim/gear glyphs (they all blank their dynamic part).
    const end = flapDroopEnd(snapshot?.flapDetentIndex ?? null, snapshot?.flapDetentCount ?? null);
    return frame(
      <>
        <line className={CY} x1="7" y1="17" x2="27" y2="17" />
        <line className={GR} x1="27" y1="17" x2="38" y2="17" />
        {end && <line className={end.active ? AM : CY} x1="27" y1="17" x2={r(end.x)} y2={r(end.y)} />}
        <circle className="ci-cyf" cx="27" cy="17" r="1.3" />
      </>
    );
  }
  if (kind === "trim") {
    const n = trimNeedle(snapshot?.trim ?? null);
    return frame(
      <>
        <line className={GR} x1="20" y1="6" x2="20" y2="32" />
        <line className={GR} x1="17.5" y1="9" x2="20" y2="9" />
        <line className={GR} x1="17.5" y1="29" x2="20" y2="29" />
        <line className={CY} x1="12" y1="19" x2="16.5" y2="19" />
        <line className={CY} x1="23.5" y1="19" x2="28" y2="19" />
        {n && (
          <polygon
            className={n.neutral ? "ci-cyf" : "ci-amf"}
            points={`20,${r(n.y)} 15.5,${r(n.y - 3)} 15.5,${r(n.y + 3)}`}
          />
        )}
      </>
    );
  }
  if (kind === "gear") {
    const g = gearGlyph(snapshot?.gear ?? null, snapshot?.gearPosition ?? null);
    const acc = g?.transit ? AM : CY;
    return frame(
      <>
        <line className={GR} x1="9" y1="13" x2="31" y2="13" />
        <path className={`${GR} ci-dash`} d="M15 13 h10 v3 h-10 z" />
        {g && <line className={acc} x1="20" y1={r(g.strutTopY)} x2="20" y2={r(g.wheelY - 4)} />}
        {g && <circle className={acc} cx="20" cy={r(g.wheelY)} r="3.6" />}
      </>
    );
  }
  // speedbrake
  const out = speedbrakeOut(snapshot?.speedbrake);
  return frame(
    <>
      <path className={CY} d="M8 22 Q20 16 34 20" />
      {out ? (
        <>
          <line className={AM} x1="19" y1="18.4" x2="24" y2="9" />
          <line className={AM} x1="24" y1="9" x2="27" y2="10" />
        </>
      ) : (
        <line className={GR} x1="18" y1="18.6" x2="26" y2="17.4" />
      )}
    </>
  );
}
