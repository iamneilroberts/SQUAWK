import type { SessionProfile } from "../auth/session";
import type { AircraftClassId } from "../mission/types";
import AlternativeAirports from "./AlternativeAirports";
import type { ProvisionalBriefingState } from "./briefingState";

const CLASS_LABELS: Record<AircraftClassId, string> = {
  c172s: "GENERAL AVIATION · C172S MODEL",
  b738: "AIRLINER · B738 MODEL",
  f5e: "FIGHTER · F-5E MODEL",
};

function identity(state: Exclude<ProvisionalBriefingState, { status: "idle" }>): string {
  return state.contact.flight?.trim() || state.contact.hex.toUpperCase();
}

export default function MissionTray({
  state,
  profile,
  onClose,
  onSelectAssignment,
  onTakeControls,
}: {
  state: ProvisionalBriefingState;
  profile: SessionProfile | null;
  onClose: () => void;
  onSelectAssignment: (key: string) => void;
  onTakeControls: () => void;
}) {
  if (state.status === "idle") return null;

  return (
    <aside className="panel mission-tray" aria-labelledby="mission-tray-title" data-testid="mission-tray">
      <div className="mission-tray-heading">
        <div>
          <div className="label">Provisional mission</div>
          <h2 id="mission-tray-title">{identity(state)}</h2>
        </div>
        <button type="button" className="auth-close" aria-label="Close mission briefing" onClick={onClose}>×</button>
      </div>

      <div className="mission-disclosure">
        REAL ADS-B POSITION → SIMULATED AIRCRAFT. ROUTE IS A PREVIEW UNTIL SERVER CONFIRMATION.
      </div>

      {state.status === "loading" && (
        <div className="mission-state" role="status">ASSIGNING ELIGIBLE RUNWAY…</div>
      )}

      {state.status === "unavailable" && (
        <div className="mission-state mission-state-warn" role="status">
          <div>{state.reason}</div>
          <div className="mission-state-note">
            {state.kind === "provider-down" && "CACHED CONTACTS MAY REMAIN VISIBLE, BUT A MISSION CANNOT START WITHOUT LIVE DATA."}
            {state.kind === "stale" && "WAIT FOR A FRESH POSITION BEFORE TAKING CONTROLS."}
            {state.kind === "unsupported" && "THIS CONTACT REMAINS AVAILABLE FOR BROWSING."}
            {state.kind === "no-runway" && "NO RUNWAY PASSED THIS AIRCRAFT CLASS'S DISTANCE AND SAFETY GATES."}
            {state.kind === "data-error" && "THE VERSIONED AIRPORT SHARDS COULD NOT BE VERIFIED."}
          </div>
        </div>
      )}

      {state.status === "ready" && (
        <>
          <div className="mission-grid">
            <span>Aircraft</span><strong>{state.contact.t ?? "—"} · {state.contact.hex.toUpperCase()}</strong>
            <span>Freshness</span><strong>{state.contact.seen_pos === null ? "—" : `${state.contact.seen_pos.toFixed(0)} SEC`}</strong>
            <span>Class</span><strong>{CLASS_LABELS[state.classId]}</strong>
            <span>Destination</span><strong>{state.selected.airportIdent} · {state.selected.airportName}</strong>
            <span>Runway</span><strong>{state.selected.runwayEndIdent} · {state.selected.runwayLengthFt.toFixed(0)} × {state.selected.runwayWidthFt.toFixed(0)} FT · {state.selected.runwaySurface}</strong>
            <span>Route</span><strong>{state.selected.distanceNm.toFixed(1)} NM · {state.selected.estimatedMinutes.toFixed(0)} MIN</strong>
            <span>Target</span><strong>0–100 AFTER SAFETY GATES</strong>
            <span>Assists</span><strong>{profile?.defaultAssist.toUpperCase() ?? "FULL"}</strong>
          </div>

          <AlternativeAirports
            choices={[state.assignment.best, ...state.assignment.alternatives]}
            selected={state.selected}
            onSelect={onSelectAssignment}
          />

          <button type="button" className="control-button mission-take-controls" data-testid="mission-take-controls" onClick={onTakeControls}>
            Take controls
          </button>
          {profile === null && <div className="label mission-auth-note">SIGN-IN REQUIRED AFTER BRIEFING</div>}
        </>
      )}
    </aside>
  );
}
