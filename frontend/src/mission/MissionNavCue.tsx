import { useSyncExternalStore } from "react";
import { hudSnapshot } from "../hud/snapshot";
import type { LockedMissionView } from "./contract";
import { assistFeatures, missionNavigationCue, type AssistMode } from "./assists";

export default function MissionNavCue({
  mission,
  assist,
}: {
  mission: LockedMissionView;
  assist: AssistMode;
}) {
  const snapshot = useSyncExternalStore(hudSnapshot.subscribe, hudSnapshot.get, hudSnapshot.get);
  if (snapshot === null || !assistFeatures(assist).destinationCue) return null;
  const cue = missionNavigationCue(snapshot, mission.assignment);
  return (
    <div className="mission-nav-cue" aria-label="Assigned destination guidance">
      <span>{mission.assignment.airportIdent} · RWY {mission.assignment.runwayEndIdent}</span>
      <strong>{cue.bearingDeg.toFixed(0).padStart(3, "0")}°</strong>
      <strong>{cue.distanceNm.toFixed(1)} NM</strong>
    </div>
  );
}
