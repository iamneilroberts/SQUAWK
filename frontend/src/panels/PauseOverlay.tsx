import { AssistControlBody } from "../mission/AssistControl";
import type { AssistState } from "../mission/assistState";
import { TIME_COMPRESSION_FACTORS, type TimeCompressionFactor } from "../game/timeCompression";

/*
 * Esc pauses (spec §6). It cannot be made to mean "quit": Esc always exits pointer lock and
 * Chrome rate-limits re-locking, so pause is the only honest thing it can do.
 *
 * Resuming is deliberately TWO steps, because spec §6 requires the resume gesture to be a
 * canvas click: RESUME arms it and steps the overlay out of the way, and flight only
 * continues when the player actually clicks the globe. The armed state has to say so on
 * screen, or a dismissed overlay just looks like a frozen game.
 *
 * ASSIST (owner 2026-08-15) lives here rather than as an always-on HUD chip: it was gated
 * `!narrow`, so mobile portrait flight never rendered it at all. MENU is the one control that
 * never fades and is always reachable, so its panel is the reliable place to reach ASSIST. Takes
 * the pure `AssistControlBody` (not the store-connected `AssistControl`) so this stays a plain,
 * prop-driven component like the rest of the panel — the caller (FlightSession, which already
 * reads assist from the store) supplies the state and the cycle handler. Unarmed only — the
 * armed "click the globe" prompt is a transient confirmation, not a menu.
 *
 * TIME COMPRESSION + SKIP TO FINAL (#87) live here for the same reason ASSIST does: the pause
 * menu is the one reliably reachable control surface on every platform. Both mark the flight
 * UNRANKED for a ranked mission (mission/unrankedReason.ts) — omitted unless the caller wires the
 * handler, same `prop !== undefined` gating as ASSIST, so existing callers/tests are unaffected.
 */
export default function PauseOverlay({
  armed,
  onArmResume,
  onQuit,
  assist = null,
  onCycleAssist,
  timeCompression = 1,
  onSetTimeCompression,
  skipToFinalAvailable = false,
  onSkipToFinal,
}: {
  /** True once RESUME has been pressed and we are waiting for the canvas click. */
  armed: boolean;
  onArmResume(): void;
  onQuit(): void;
  /** Null while no mission is locked (shouldn't happen while PAUSED, but keeps this safe/pure). */
  assist?: AssistState | null;
  onCycleAssist?(): void;
  /** Active factor (#87); defaults to 1x. Meaningless without onSetTimeCompression. */
  timeCompression?: TimeCompressionFactor;
  onSetTimeCompression?(factor: TimeCompressionFactor): void;
  /** True only with a real destination/approach assigned (not free flight). */
  skipToFinalAvailable?: boolean;
  onSkipToFinal?(): void;
}) {
  if (armed) {
    return (
      <div className="pause-overlay pause-overlay-armed">
        <div className="panel pause-card">
          <div className="label">CLICK THE GLOBE TO RESUME</div>
          <button className="control-button" onClick={onQuit}>
            QUIT TO BROWSE
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="pause-overlay">
      <div className="panel pause-card">
        <div className="label">PAUSED</div>
        <button className="control-button" onClick={onArmResume}>
          RESUME
        </button>
        <button className="control-button" onClick={onQuit}>
          QUIT TO BROWSE
        </button>
        {assist !== null && onCycleAssist && (
          <AssistControlBody assist={assist} onCycle={onCycleAssist} />
        )}
        {onSetTimeCompression && (
          <>
            <div className="label">TIME COMPRESSION</div>
            <div className="compression-row">
              {TIME_COMPRESSION_FACTORS.map((factor) => (
                <button
                  key={factor}
                  type="button"
                  className={
                    "control-button" + (factor === timeCompression ? " control-button-active" : "")
                  }
                  onClick={() => onSetTimeCompression(factor)}
                >
                  {factor}×
                </button>
              ))}
            </div>
            {timeCompression > 1 && (
              <div className="takeover-reason">
                LIVE TRAFFIC REAL-TIME — MARKS THIS FLIGHT UNRANKED
              </div>
            )}
          </>
        )}
        {skipToFinalAvailable && onSkipToFinal && (
          <button type="button" className="control-button" onClick={onSkipToFinal}>
            SKIP TO FINAL (UNRANKED)
          </button>
        )}
      </div>
    </div>
  );
}
