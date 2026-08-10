import { useState } from "react";

import type { AircraftClassId } from "../mission/types";
import { TUTORIAL_DEFINITIONS } from "./definitions";
import type { TutorialProgress } from "./progress";

export default function TutorialPanel({
  progress,
  onStart,
}: {
  progress: TutorialProgress;
  onStart(classId: AircraftClassId): void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tutorial-control">
      <button className="status-chip-button" type="button" onClick={() => setOpen(true)}>
        TRAINING
      </button>
      {open && (
        <div className="tutorial-backdrop">
          <section className="panel tutorial-panel" role="dialog" aria-label="Landing tutorials">
            <div className="tutorial-heading">
              <h2>LANDING TRAINING</h2>
              <button className="auth-close" type="button" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>
            <p className="tutorial-copy">
              Fixed, repeatable approaches. No live ADS-B traffic, account, or network is required.
              Tutorial results are always local and unranked.
            </p>
            <div className="tutorial-options">
              {TUTORIAL_DEFINITIONS.map((definition) => {
                const complete = progress.completedClasses.includes(definition.classId);
                return (
                  <button
                    className="control-button tutorial-option"
                    type="button"
                    key={definition.id}
                    onClick={() => onStart(definition.classId)}
                  >
                    <span>{definition.label}</span>
                    <span>{definition.assignment.airportIdent} RWY {definition.assignment.runwayEndIdent}</span>
                    <span>{complete ? "COMPLETE" : "START"}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
