import { useState } from "react";

import type { AircraftClassId } from "../mission/types";
import { FREE_FLIGHT_CLASSES } from "./freeFlight";

const CLASS_ORDER: { id: AircraftClassId; name: string; model: string }[] = [
  { id: "c172s", name: "LIGHT", model: "C172S" },
  { id: "b738", name: "AIRLINER", model: "B738" },
  { id: "f5e", name: "FIGHTER", model: "F-5E" },
  { id: "biz", name: "BUSINESS JET", model: "CITATION-CLASS" },
  { id: "tprop", name: "TURBOPROP", model: "KING AIR-CLASS" },
];

/**
 * Browse-screen entry to FREE FLIGHT (#29). Modeled on TutorialPanel: a status-chip button that
 * opens a terminal dialog. Reachable even when the feed is OFFLINE — it depends on no contacts.
 * The picker chooses class, altitude and heading; `onStart` builds the mission (where crypto is
 * available) and starts it.
 */
export default function FreeFlightPanel({
  onStart,
}: {
  onStart(classId: AircraftClassId, opts: { altitudeFt: number; headingDeg: number }): boolean;
}) {
  const [open, setOpen] = useState(false);
  const [classId, setClassId] = useState<AircraftClassId>("c172s");
  const [altitudeFt, setAltitudeFt] = useState(FREE_FLIGHT_CLASSES.c172s.defaultAltitudeFt);
  const [headingDeg, setHeadingDeg] = useState(0);

  const info = FREE_FLIGHT_CLASSES[classId];

  function pickClass(next: AircraftClassId): void {
    setClassId(next);
    setAltitudeFt(FREE_FLIGHT_CLASSES[next].defaultAltitudeFt);
  }

  function submit(): void {
    const alt = Math.min(info.maxAltitudeFt, Math.max(info.minAltitudeFt, Math.round(altitudeFt)));
    const hdg = ((Math.round(headingDeg) % 360) + 360) % 360;
    if (onStart(classId, { altitudeFt: alt, headingDeg: hdg })) setOpen(false);
  }

  return (
    <div className="tutorial-control">
      <button className="status-chip-button" type="button" onClick={() => setOpen(true)}>
        FREE FLIGHT
      </button>
      {open && (
        <div className="tutorial-backdrop">
          <section className="panel tutorial-panel freeflight-panel" role="dialog" aria-label="Free flight">
            <div className="tutorial-heading">
              <h2>FREE FLIGHT</h2>
              <button className="auth-close" type="button" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>
            <p className="tutorial-copy">
              Straight-and-level over home. No feed, account, or network — always SIM, unranked.
            </p>
            <div className="tutorial-options" role="group" aria-label="Aircraft class">
              {CLASS_ORDER.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="control-button freeflight-class"
                  aria-pressed={option.id === classId}
                  onClick={() => pickClass(option.id)}
                >
                  <span className="freeflight-class-name">{option.name}</span>
                  <span className="freeflight-class-model">{option.model}</span>
                </button>
              ))}
            </div>
            <label className="label freeflight-field" htmlFor="freeflight-altitude">
              ALTITUDE (FT) · {info.minAltitudeFt}–{info.maxAltitudeFt}
              <input
                id="freeflight-altitude"
                className="auth-input"
                type="number"
                min={info.minAltitudeFt}
                max={info.maxAltitudeFt}
                step={500}
                value={altitudeFt}
                onChange={(event) => setAltitudeFt(Number(event.target.value))}
              />
            </label>
            <label className="label freeflight-field" htmlFor="freeflight-heading">
              HEADING (° 0–359)
              <input
                id="freeflight-heading"
                className="auth-input"
                type="number"
                min={0}
                max={359}
                step={1}
                value={headingDeg}
                onChange={(event) => setHeadingDeg(Number(event.target.value))}
              />
            </label>
            <button className="control-button" type="button" onClick={submit}>
              TAKE CONTROLS
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
