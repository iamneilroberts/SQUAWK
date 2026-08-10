import type { MissionPreparationView } from "../mission/contract";
import type { RunwayAssignment } from "../mission/types";
import AlternativeAirports from "./AlternativeAirports";

function route(assignment: RunwayAssignment): string {
  return `${assignment.airportIdent} RWY ${assignment.runwayEndIdent} · ${assignment.distanceNm.toFixed(1)} NM`;
}

export default function MissionReconfirmation({
  provisional,
  preparation,
  onConfirm,
  onSelect,
}: {
  provisional: RunwayAssignment;
  preparation: MissionPreparationView;
  onConfirm: () => void;
  onSelect: (key: string) => void;
}) {
  const changed = route(provisional) !== route(preparation.selected);
  return (
    <div className="mission-reconfirm" role="alert" data-testid="mission-reconfirmation">
      <div className="label">Fresh authoritative briefing — confirm again</div>
      <div className="mission-state-note">
        {changed
          ? `${route(provisional)} → ${route(preparation.selected)}`
          : "THE SELECTED ROUTE STILL MATCHES, BUT THE ELIGIBLE ALTERNATIVE SET CHANGED."}
      </div>
      <AlternativeAirports
        choices={preparation.eligibleChoices}
        selected={preparation.selected}
        onSelect={onSelect}
      />
      <button type="button" className="control-button mission-take-controls" onClick={onConfirm}>
        Confirm fresh mission
      </button>
    </div>
  );
}
