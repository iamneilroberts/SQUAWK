/*
 * On-screen touch flight controls (mobile sub-feature 2, spec §3). Rendered only on a
 * narrow/touch viewport and only while FLYING (FlightSession gates it), so desktop never mounts
 * it and the keyboard path is untouched. LORAN visual language: 1px borders, monospace, amber
 * SIM accent / cyan nominal, translucent, no radius, no shadow.
 *
 * Two seams, per spec §6:
 *  - Option B (analog): the virtual stick -> pitch/roll and the throttle slider -> throttle[0,1]
 *    write CONTINUOUS targets into the shared analog axes object (onStick/onThrottle), which the
 *    flight loop samples each tick and overrides the sprung/lever axes with. Releasing the stick
 *    stops driving those axes so the sampler's spring eases them back to centre.
 *  - Option A (synthesized key codes): every discrete/rudder button dispatches the SAME Keyboard
 *    event `code` the keyboard uses, on `window`, where createKeyboard already listens. The
 *    sampler's and loop's existing edge-detection then fires unchanged — one tap = one detent /
 *    toggle, a rudder hold = sprung yaw exactly like holding KeyA/KeyD. No new sampler code.
 *
 * All interactive surfaces use Pointer Events (not click) for latency and `touch-action: none`
 * (CSS) so the browser does not steal the drag for scroll/zoom.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { stickToAxes, sliderToThrottle, gearButtonInTransit, trimBadgeText } from "./analog";
import ControlIcon from "../hud/controls/ControlIcon";
import type { HudSnapshot } from "../hud/snapshot";

/** Radial deadzone as a fraction of the pad radius — a first guess; owner-tunable on device. */
const STICK_DEADZONE = 0.12;
/** How long a synthesized momentary tap holds its code — must span >=1 physics tick (~16.7ms). */
const TAP_HOLD_MS = 90;

function keyEvent(type: "keydown" | "keyup", code: string): void {
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
}
/** A momentary synthesized keypress: down now, up after TAP_HOLD_MS. One edge, guaranteed a tick. */
function tapKey(code: string): void {
  keyEvent("keydown", code);
  window.setTimeout(() => keyEvent("keyup", code), TAP_HOLD_MS);
}

/** Compose the touch-button className with the optional amber-state border (#48 mobile). */
function btnClass(disabled: boolean | undefined, stateAmber: boolean | undefined): string {
  let c = disabled ? "touch-btn touch-btn-ghost touch-btn-ghost-disabled" : "touch-btn touch-btn-ghost";
  if (stateAmber) c += " touch-btn-state-amber";
  return c;
}

function DiscreteButton({
  label,
  code,
  disabled,
  icon,
  badge,
  stateAmber,
}: {
  /** Text label; ignored when `icon` is present (glyph replaces the text so the button stays the same size). */
  label: string;
  code: string;
  disabled?: boolean;
  /** A control-state glyph rendered INSTEAD of the text label (#48 GEAR/BRK). */
  icon?: ReactNode;
  /** A small corner value badge overlaid on the button (#48 FLP+/TRM); no layout impact. */
  badge?: ReactNode;
  /** Amber border to signal an active/in-transit state (glyph colours itself). */
  stateAmber?: boolean;
}) {
  return (
    <button
      className={btnClass(disabled, stateAmber)}
      disabled={disabled}
      onPointerDown={(e) => {
        if (disabled) return;
        e.preventDefault();
        tapKey(code);
      }}
    >
      {icon ? <span className="touch-btn-icon">{icon}</span> : label}
      {badge != null && <span className="touch-btn-badge">{badge}</span>}
    </button>
  );
}

/** A hold-to-deflect button: synthesizes a held key (rudder/trim) for the whole press. */
function HoldButton({
  label,
  code,
  badge,
}: {
  label: string;
  code: string;
  /** Optional corner value badge (#48 TRM▲ magnitude); no layout impact. */
  badge?: ReactNode;
}) {
  const down = useRef(false);
  const release = () => {
    if (!down.current) return;
    down.current = false;
    keyEvent("keyup", code);
  };
  return (
    <button
      className="touch-btn touch-btn-ghost"
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as Element).setPointerCapture?.(e.pointerId);
        down.current = true;
        keyEvent("keydown", code);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      {label}
      {badge != null && <span className="touch-btn-badge">{badge}</span>}
    </button>
  );
}

function VirtualStick({
  onStick,
  onRelease,
}: {
  onStick(roll: number, pitch: number): void;
  onRelease(): void;
}) {
  const padRef = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const update = (clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const radius = r.width / 2;
    const dx = clientX - (r.left + radius);
    const dy = clientY - (r.top + r.height / 2);
    const { roll, pitch } = stickToAxes(dx, dy, radius, STICK_DEADZONE);
    onStick(roll, pitch);
    // Knob follows the finger but is clamped to the pad rim.
    const mag = Math.hypot(dx, dy);
    const cap = mag > radius ? radius / mag : 1;
    setKnob({ x: dx * cap, y: dy * cap });
  };

  const release = () => {
    if (!active.current) return;
    active.current = false;
    setKnob({ x: 0, y: 0 });
    onRelease();
  };

  return (
    <div
      ref={padRef}
      className="touch-stick"
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as Element).setPointerCapture?.(e.pointerId);
        active.current = true;
        update(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (!active.current) return;
        update(e.clientX, e.clientY);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <div className="touch-stick-label">STICK</div>
      <div className="touch-stick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}

/** Clamp+round a raw 0..1 throttle to a 0..100 fill percentage for the on-screen slider. */
export function throttleFillPct(throttle: number): number {
  return Math.min(100, Math.max(0, Math.round(throttle * 100)));
}

function ThrottleSlider({
  throttle,
  onThrottle,
}: {
  /** Live throttle [0,1] from the sim. The lever mirrors it whenever it is not being dragged, so it
   *  never shows a stale 0 while the aircraft spawned at cruise (or the keyboard moved the lever). */
  throttle: number;
  onThrottle(t: number): void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  const [value, setValue] = useState(throttle);

  // Follow the real throttle while the finger is off the lever; a live drag owns the value instead.
  useEffect(() => {
    if (!active.current) setValue(throttle);
  }, [throttle]);

  const update = (clientY: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const t = sliderToThrottle(clientY, r.top, r.height);
    setValue(t);
    onThrottle(t);
  };

  const pct = throttleFillPct(value);

  return (
    <div
      ref={trackRef}
      className="touch-throttle"
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as Element).setPointerCapture?.(e.pointerId);
        active.current = true;
        update(e.clientY);
      }}
      onPointerMove={(e) => {
        if (!active.current) return;
        update(e.clientY);
      }}
      onPointerUp={() => (active.current = false)}
      onPointerCancel={() => (active.current = false)}
    >
      <div className="touch-throttle-fill" style={{ height: `${pct}%` }} />
      <div className="touch-throttle-tick touch-throttle-tick-top" aria-hidden="true" />
      <div className="touch-throttle-tick touch-throttle-tick-mid" aria-hidden="true" />
      <div className="touch-throttle-tick touch-throttle-tick-bottom" aria-hidden="true" />
      <div className="touch-throttle-label">THR {pct}%</div>
    </div>
  );
}

export default function TouchControls({
  onStick,
  onStickRelease,
  onThrottle,
  throttle,
  gearFixed,
  hasSpeedbrake,
  snapshot,
}: {
  onStick(roll: number, pitch: number): void;
  onStickRelease(): void;
  onThrottle(t: number): void;
  /** Live throttle [0,1] from the sim; the lever mirrors it when not being dragged. */
  throttle: number;
  gearFixed: boolean;
  /** Class has an airbrake (speedbrakeCd0 > 0); BRK is disabled otherwise (#51). */
  hasSpeedbrake: boolean;
  /** Live HUD snapshot: feeds the GEAR/BRK glyphs and the FLP+/TRM badges (#48). Null before spawn. */
  snapshot: HudSnapshot | null;
}) {
  // If the whole overlay unmounts mid-deflection (leaving FLYING), let the stick go so a stale
  // analog target can't linger; the buttons synthesize their own keyup on release already.
  useEffect(() => () => onStickRelease(), [onStickRelease]);

  return (
    <div className="touch-controls">
      <VirtualStick onStick={onStick} onRelease={onStickRelease} />
      <ThrottleSlider throttle={throttle} onThrottle={onThrottle} />
      {/* Minimal transparent control set (owner refinement, #13): just gear, flaps and trim —
          rudder, afterburner, level-assist and pause were dropped from the mobile UI. Trim is a
          hold (a lever that ramps while held, matching Comma/Period on the keyboard). */}
      <div className="touch-buttons">
        <DiscreteButton label="CAM" code="KeyE" />
        <DiscreteButton
          label="GEAR"
          code="KeyG"
          disabled={gearFixed}
          icon={<ControlIcon kind="gear" snapshot={snapshot} />}
          stateAmber={gearButtonInTransit(snapshot?.gear ?? "fixed", snapshot?.gearPosition ?? 1)}
        />
        <DiscreteButton
          label="BRK"
          code="KeyB"
          disabled={!hasSpeedbrake}
          icon={<ControlIcon kind="speedbrake" snapshot={snapshot} />}
          stateAmber={snapshot?.speedbrake === true}
        />
        <DiscreteButton label="FLP−" code="KeyV" />
        <DiscreteButton label="FLP+" code="KeyF" badge={snapshot?.flapLabel ?? "—"} />
        <HoldButton label="TRM▼" code="Comma" />
        <HoldButton
          label="TRM▲"
          code="Period"
          badge={
            trimBadgeText(snapshot?.trim) && (
              <span className="touch-btn-badge-amber">{trimBadgeText(snapshot?.trim)}</span>
            )
          }
        />
      </div>
    </div>
  );
}
