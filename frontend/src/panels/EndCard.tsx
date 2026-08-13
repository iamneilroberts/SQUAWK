/*
 * End of session (parent spec §5, owner decision B-5). Not a freeze frame: the default
 * mouse controls are back on behind this card so the impact or landing site can be orbited.
 */
import type { DebriefSubmission } from "../debrief/types";
import type { FlightStats } from "../game/stats";
import { EM_DASH, formatAirtime, formatAltFt, formatG, formatIasKt } from "../hud/format";
import type { MissionVersionSet } from "../mission/contract";
import {
  LANDING_SCORE_WEIGHTS,
  type LandingScoreComponents,
} from "../mission/landingScore";

const M_PER_NM = 1852;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="handoff-row">
      <span className="label">{label}</span>
      <span className="handoff-value">{value}</span>
    </div>
  );
}

const COMPONENT_LABELS: Record<keyof LandingScoreComponents, string> = {
  verticalSpeed: "VERTICAL SPEED",
  centerline: "CENTERLINE",
  touchdownZone: "TOUCHDOWN ZONE",
  alignment: "ALIGNMENT",
  speed: "SPEED",
  bank: "BANK",
  rollout: "ROLLOUT",
};

function points(value: number): string {
  return String(Math.round(value * 1_000) / 1_000);
}

function ScoreBreakdown({ components }: { components: LandingScoreComponents }) {
  return (
    <details className="debrief-breakdown">
      <summary className="label">SCORE BREAKDOWN</summary>
      <div className="debrief-components" aria-label="Score components">
        {(Object.keys(COMPONENT_LABELS) as (keyof LandingScoreComponents)[]).map((key) => (
          <Row
            key={key}
            label={COMPONENT_LABELS[key]}
            value={`${points(components[key])} / ${LANDING_SCORE_WEIGHTS[key]}`}
          />
        ))}
      </div>
    </details>
  );
}

/*
 * Instant-flight highlight (B5 polish). A trimmed debrief leads with the outcome big, then the
 * three stats a casual pilot actually reads — how long, how far, how high. The full RESULT /
 * FLIGHT SUMMARY grid still follows below for anyone who wants the detail; this is the headline.
 */
function InstantHero({ stats }: { stats: FlightStats }) {
  return (
    <div className="debrief-hero" aria-label="Instant flight summary">
      <div className="debrief-hero-outcome">{stats.classification}</div>
      <div className="debrief-hero-stats">
        <div className="debrief-hero-stat">
          <span className="debrief-hero-value">{formatAirtime(stats.airtimeS)}</span>
          <span className="label">AIRTIME</span>
        </div>
        <div className="debrief-hero-stat">
          <span className="debrief-hero-value">
            {(stats.distanceM / M_PER_NM).toFixed(1)}<span className="debrief-hero-unit"> NM</span>
          </span>
          <span className="label">DISTANCE</span>
        </div>
        <div className="debrief-hero-stat">
          <span className="debrief-hero-value">
            {formatAltFt(stats.maxAltitudeM)}<span className="debrief-hero-unit"> FT</span>
          </span>
          <span className="label">MAX ALT</span>
        </div>
      </div>
    </div>
  );
}

function Versions({ versions }: { versions: MissionVersionSet }) {
  return (
    <details className="debrief-versions">
      <summary className="label">FROZEN VERSIONS</summary>
      <Row label="AIRPORT DATA" value={versions.airportDataset} />
      <Row label="AIRCRAFT" value={versions.aircraftProfile} />
      <Row label="MISSION" value={versions.missionProfile} />
      <Row label="ASSIGNMENT" value={versions.assignment} />
      <Row label="SCORING" value={versions.scoring} />
      <Row label="PHYSICS" value={versions.physics} />
      <Row label="ASSISTS" value={versions.assistDefinition} />
    </details>
  );
}

export default function EndCard({
  stats,
  submission,
  onRetry,
  callsign = null,
  onExit,
  onSignIn,
  onFlyAgain,
}: {
  stats: FlightStats;
  submission: DebriefSubmission;
  onRetry(): void;
  /** Set-once SIM callsign, shown on the debrief per UI-002 (identity lives off the live rail). */
  callsign?: string | null;
  onExit(): void;
  /** Opens sign-in from an instant flight's SIGN IN TO RANK action (B5); absent = no button. */
  onSignIn?(): void;
  /** Restarts a fresh instant flight from the debrief (B5 FLY AGAIN); absent = no button. */
  onFlyAgain?(): void;
}) {
  const isInstant = submission.status === "instant";
  const accepted = submission.status === "accepted" ? submission.result : null;
  const preview = submission.status === "submitting" || submission.status === "failed" ||
    submission.status === "queued" || submission.status === "tutorial" ||
    submission.status === "instant"
    ? submission.preview
    : null;
  const evaluation = accepted ?? preview?.evaluation ?? null;
  const components = accepted?.components ?? preview?.evaluation.score?.components ?? null;
  const score = accepted?.score ?? preview?.evaluation.score?.total ?? null;
  const classId = accepted?.classId ?? preview?.classId ?? null;
  const highestAssist = accepted?.highestAssist ?? preview?.highestAssist ?? null;
  const versions = accepted?.versions ?? preview?.versions ?? null;
  const authority = submission.status === "accepted"
    ? "AUTHORITATIVE — WORKER VERIFIED"
    : submission.status === "instant"
      ? "INSTANT FLIGHT — LOCAL AND UNRANKED"
    : submission.status === "tutorial"
      ? "TUTORIAL — LOCAL AND UNRANKED"
      : submission.status === "queued"
        ? "PREVIEW — QUEUED / NOT AUTHORITATIVE"
    : submission.status === "submitting"
      ? "VERIFYING AUTHORITATIVE RESULT…"
      : submission.status === "failed"
        ? "PREVIEW — NOT AUTHORITATIVE"
        : "AUTHORITATIVE RESULT UNAVAILABLE";
  const rank = accepted?.ranked === true ? "RANK ELIGIBLE" : "NOT RANKED";

  return (
    <div className="end-overlay">
      {/* Always-reachable close (#32): fixed to the screen corner so it can never be scrolled
          away, pushed off by iOS dvh, or covered by the browse chrome the way the footer was. */}
      <button
        className="end-close"
        type="button"
        onClick={onExit}
        aria-label="Close debrief and return to browse"
      >
        ✕
      </button>
      <div className="panel end-card" role="dialog" aria-label="Flight debrief">
        <div className="label handoff-title">DEBRIEF — {stats.classification}</div>
        <div className="debrief-authority" aria-live="polite">{authority}</div>
        {isInstant && <InstantHero stats={stats} />}
        {submission.status === "failed" && (
          <div className="auth-error label" role="alert">{submission.message}</div>
        )}
        {submission.status === "queued" && (
          <div className="debrief-queued label" role="status">{submission.message}</div>
        )}
        {submission.status === "unavailable" && (
          <div className="auth-error label" role="alert">{submission.message}</div>
        )}
        {/* SIM callsign (UI-002): identity lives on the debrief, not the live rail. */}
        <Row label="CALLSIGN" value={callsign ?? EM_DASH} />
        <div className="debrief-grid">
          <section aria-label="Result">
            <div className="label">RESULT</div>
            <Row label="SAFETY OUTCOME" value={evaluation?.outcome.toUpperCase() ?? "INCOMPLETE"} />
            <Row label="NAMED FAILURE" value={evaluation?.failure ?? "NONE"} />
            {score !== null && (
              <Row
                label={accepted === null ? "PREVIEW SCORE" : "AUTHORITATIVE SCORE"}
                value={points(score)}
              />
            )}
            <Row label="RANKING" value={rank} />
            {accepted !== null && <Row label="EVIDENCE" value={accepted.evidenceStatus.toUpperCase()} />}
            {classId !== null && <Row label="AIRCRAFT CLASS" value={classId.toUpperCase()} />}
            {highestAssist !== null && <Row label="HIGHEST ASSIST" value={highestAssist} />}
          </section>
          <section aria-label="Flight summary">
            <div className="label">FLIGHT SUMMARY</div>
            <Row label="AIRTIME" value={formatAirtime(stats.airtimeS)} />
            <Row label="DISTANCE" value={`${(stats.distanceM / M_PER_NM).toFixed(1)} NM`} />
            <Row label="MAX IAS" value={`${formatIasKt(stats.maxIasMs)} KT`} />
            <Row label="MAX ALT" value={`${formatAltFt(stats.maxAltitudeM)} FT`} />
            <Row label="MAX G" value={formatG(stats.maxG)} />
            <Row label="IMPACT SINK" value={`${Math.round(stats.impactSinkFpm)} FPM`} />
            <Row label="IMPACT SPEED" value={`${formatIasKt(stats.impactIasMs)} KT`} />
          </section>
        </div>
        {components !== null && <ScoreBreakdown components={components} />}
        {versions !== null && <Versions versions={versions} />}
        <div className="handoff-disclosure">DRAG TO ORBIT THE SITE</div>
        {submission.status === "failed" && submission.retryable && (
          <button className="control-button" type="button" onClick={onRetry}>
            RETRY RESULT
          </button>
        )}
        {isInstant && onFlyAgain && (
          <button className="control-button debrief-fly-again" type="button" onClick={onFlyAgain}>
            FLY AGAIN
          </button>
        )}
        {isInstant && onSignIn && (
          <button className="control-button debrief-sign-in" type="button" onClick={onSignIn}>
            SIGN IN TO RANK THIS FLIGHT
          </button>
        )}
        <div className="end-card-footer">
          <button className="control-button" onClick={onExit}>
            EXIT TO BROWSE
          </button>
        </div>
      </div>
    </div>
  );
}
