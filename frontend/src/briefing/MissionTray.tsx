import type { SessionProfile } from "../auth/session";
import type { AircraftClassId } from "../mission/types";
import AlternativeAirports from "./AlternativeAirports";
import MissionReconfirmation from "./MissionReconfirmation";
import type {
  MissionCommitState,
  ProvisionalBriefingState,
} from "./briefingState";
import { assistModeFromPreference } from "../mission/assists";

const CLASS_LABELS: Record<AircraftClassId, string> = {
  c172s: "GENERAL AVIATION · C172S MODEL",
  b738: "AIRLINER · B738 MODEL",
  f5e: "FIGHTER · F-5E MODEL",
  biz: "BUSINESS JET · CITATION-CLASS MODEL",
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
  commitState,
  onConfirmMission,
  onSelectReconfirmed,
}: {
  state: ProvisionalBriefingState;
  profile: SessionProfile | null;
  onClose: () => void;
  onSelectAssignment: (key: string) => void;
  onTakeControls: () => void;
  commitState: MissionCommitState;
  onConfirmMission: () => void;
  onSelectReconfirmed: (key: string) => void;
}) {
  if (state.status === "idle") return null;

  const preparation = commitState.status === "reconfirm" || commitState.status === "locking"
    ? commitState.preparation
    : commitState.status === "error"
      ? commitState.retry?.preparation ?? null
      : null;
  const authoritative = commitState.status === "locked"
    ? {
        contact: commitState.mission.contact,
        classId: commitState.mission.classId,
        selected: commitState.mission.assignment,
      }
    : preparation === null
      ? null
      : {
          contact: preparation.contact,
          classId: preparation.classId,
          selected: preparation.selected,
        };
  const closeDisabled = commitState.status === "locking" ||
    commitState.status === "locked" ||
    (commitState.status === "error" && commitState.retry !== undefined);

  return (
    <aside className="panel mission-tray" aria-labelledby="mission-tray-title" data-testid="mission-tray">
      <div className="mission-tray-heading">
        <div>
          <div className="label">
            {commitState.status === "locked"
              ? "Locked mission"
              : authoritative === null
                ? "Provisional mission"
                : "Authoritative mission"}
          </div>
          <h2 id="mission-tray-title">
            {authoritative === null
              ? identity(state)
              : authoritative.contact.flight?.trim() || authoritative.contact.hex.toUpperCase()}
          </h2>
        </div>
        <button type="button" className="auth-close" aria-label="Close mission briefing" onClick={onClose} disabled={closeDisabled}>×</button>
      </div>

      <div className="mission-disclosure">
        REAL ADS-B POSITION → SIMULATED AIRCRAFT · ROUTE PREVIEW UNTIL SERVER CONFIRMS.
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
            <span>Aircraft</span><strong>{(authoritative?.contact ?? state.contact).t ?? "—"} · {(authoritative?.contact ?? state.contact).hex.toUpperCase()}</strong>
            <span>Freshness</span><strong>{(authoritative?.contact ?? state.contact).seen_pos === null ? "—" : `${((authoritative?.contact ?? state.contact).seen_pos ?? 0).toFixed(0)} SEC`}</strong>
            <span>Class</span><strong>{CLASS_LABELS[authoritative?.classId ?? state.classId]}</strong>
            <span>Destination</span><strong>{(authoritative?.selected ?? state.selected).airportIdent} · {(authoritative?.selected ?? state.selected).airportName}</strong>
            <span>Runway</span><strong>{(authoritative?.selected ?? state.selected).runwayEndIdent} · {(authoritative?.selected ?? state.selected).runwayLengthFt.toFixed(0)} × {(authoritative?.selected ?? state.selected).runwayWidthFt.toFixed(0)} FT · {(authoritative?.selected ?? state.selected).runwaySurface}</strong>
            <span>Route</span><strong>{(authoritative?.selected ?? state.selected).distanceNm.toFixed(1)} NM · {(authoritative?.selected ?? state.selected).estimatedMinutes.toFixed(0)} MIN</strong>
            <span>Target</span><strong>0–100 AFTER SAFETY GATES</strong>
            <span>Assists</span><strong>{profile === null ? "FULL" : assistModeFromPreference(profile.defaultAssist)}</strong>
          </div>

          {/* TAKE CONTROLS sits directly under the grid, ABOVE the eligible-airports list, so the
              primary action is always on-screen without scrolling; the (optional) alternatives list
              below can scroll harmlessly (owner 2026-08-13). */}
          <button
            type="button"
            className="control-button mission-take-controls"
            data-testid="mission-take-controls"
            onClick={onTakeControls}
            disabled={commitState.status === "preparing" || commitState.status === "locking" || commitState.status === "locked" || commitState.status === "reconfirm"}
          >
            {commitState.status === "preparing"
              ? "Checking fresh traffic…"
              : commitState.status === "locking"
                ? "Locking mission…"
              : commitState.status === "locked"
                  ? "Mission locked"
                  : commitState.status === "error" && commitState.retry !== undefined
                    ? "Retry mission lock"
                  : "Take controls"}
          </button>

          {(commitState.status === "idle" ||
            (commitState.status === "error" && commitState.retry === undefined)) && (
            <AlternativeAirports
              choices={[state.assignment.best, ...state.assignment.alternatives]}
              selected={state.selected}
              onSelect={onSelectAssignment}
            />
          )}

          {commitState.status === "reconfirm" && (
            <MissionReconfirmation
              provisional={commitState.provisional}
              preparation={commitState.preparation}
              onConfirm={onConfirmMission}
              onSelect={onSelectReconfirmed}
            />
          )}

          {commitState.status === "error" && (
            <div className="mission-state mission-state-warn" role="alert">
              {commitState.message}
            </div>
          )}

          {commitState.status === "locked" && (
            <div className="mission-state" role="status">
              MISSION LOCKED · {commitState.mission.assignment.airportIdent} RWY {commitState.mission.assignment.runwayEndIdent}
              <div className="mission-state-note">SIMULATOR HANDOFF CONTINUES IN TASK 10.</div>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
