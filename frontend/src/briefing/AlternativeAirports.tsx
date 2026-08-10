import type { RunwayAssignment } from "../mission/types";
import { assignmentKey } from "./briefingState";

export default function AlternativeAirports({
  choices,
  selected,
  onSelect,
  disabled = false,
}: {
  choices: readonly RunwayAssignment[];
  selected: RunwayAssignment;
  onSelect: (key: string) => void;
  disabled?: boolean;
}) {
  if (choices.length <= 1) return null;
  const selectedKey = assignmentKey(selected);

  return (
    <div className="mission-alternatives">
      <div className="label mission-section-label">Eligible airports</div>
      <div className="mission-alternative-list" role="list">
        {choices.map((choice) => {
          const key = assignmentKey(choice);
          const active = key === selectedKey;
          return (
            <button
              key={key}
              type="button"
              className={`mission-alternative${active ? " mission-alternative-active" : ""}`}
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onSelect(key)}
            >
              <span>{choice.airportIdent} · RWY {choice.runwayEndIdent}</span>
              <span>{choice.estimatedMinutes.toFixed(0)} MIN · {choice.distanceNm.toFixed(0)} NM</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
