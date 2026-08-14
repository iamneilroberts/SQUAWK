/*
 * The approach flight director (#22): a translucent GREEN lead aircraft that flies the correct
 * glide slope a fixed distance ahead of the player, as a fly-through guide. It is NOT the "ghost"
 * (globe/ghost.ts) — that name is the REAL ADS-B aircraft after takeover, dimmed cyan. This is
 * synthetic guidance (green), unmistakable from both the player's amber SIM aircraft and the cyan
 * ghost, and it is a UI aid, never a live contact.
 *
 * Rendering reuses the low-poly primitive (createAircraftModel) with DIRECTOR_MODEL_STYLE. Position
 * is recomputed every render frame from hudSnapshot via scene.preRender — the PapiLayer per-frame
 * idiom — so the guide tracks own-ship's distance-to-threshold smoothly with zero React churn. The
 * model persists across effect re-runs in a ref (the ContactLayer pattern) and is destroyed only on
 * unmount; gating simply hides it.
 *
 * Cesium/3D is not unit-testable here (needs a browser): the pure geometry it drives
 * (positionAlongApproach + directorDistanceNm) is tested in guidanceGeometry.test.ts, but whether
 * the green guide reads correctly on the glide slope must be eyeballed in the running app.
 */
import { useEffect, useRef } from "react";
import type { LockedMissionView } from "../mission/contract";
import { assistFeatures, missionNavigationCue, type AssistMode } from "../mission/assists";
import { directorDistanceNm, positionAlongApproach } from "../mission/guidanceGeometry";
import { projectToRunwayFrame } from "../mission/runwayGeometry";
import { hudSnapshot } from "../hud/snapshot";
import { geodeticToEcef } from "../sim/geo";
import { quatFromHpr } from "../sim/quat";
import { degToRad } from "../sim/units";
import { createAircraftModel, DIRECTOR_MODEL_STYLE, type AircraftModel } from "./aircraftModel";
import { useViewer } from "./viewerContext";

const FEET_TO_M = 0.3048;

export default function DirectorLayer({
  mission,
  assist,
  instantFlight,
}: {
  mission: LockedMissionView;
  assist: AssistMode;
  instantFlight: boolean;
}) {
  const bundle = useViewer();
  const modelRef = useRef<AircraftModel | null>(null);

  useEffect(() => {
    const viewer = bundle?.viewer;
    if (viewer === undefined || viewer.isDestroyed()) return;

    // The director is a FULL-assist landing aid, gated exactly like the glide gates; it never shows
    // on instant flight (an airport point with no runway geometry — same reason the approach aids
    // are off there). When gated off, hide any existing model but keep it for a later re-enable.
    const gatedOn = !instantFlight && assistFeatures(assist).glideGates;
    if (!gatedOn) {
      modelRef.current?.setVisible(false);
      return;
    }

    const assignment = mission.assignment;
    const guidance = mission.missionProfile.guidance;
    if (modelRef.current === null) {
      modelRef.current = createAircraftModel(viewer, mission.classId, DIRECTOR_MODEL_STYLE);
    }
    const model = modelRef.current;

    const onPreRender = () => {
      const snapshot = hudSnapshot.get();
      if (snapshot === null) {
        model.setVisible(false);
        return;
      }
      const own = { latDeg: snapshot.latDeg, lonDeg: snapshot.lonDeg };
      // Only lead the player while on the approach side and within the guidance length; past the
      // threshold (along-track >= 0) or beyond the far end there is no approach to fly.
      const past = projectToRunwayFrame(assignment, own).alongTrackFt >= 0;
      const cue = missionNavigationCue(own, assignment);
      if (past || cue.distanceNm > guidance.approachLengthNm) {
        model.setVisible(false);
        return;
      }
      const distanceNm = directorDistanceNm(cue.distanceNm, guidance.approachLengthNm);
      const { point, approachHeadingDeg } = positionAlongApproach(assignment, guidance, distanceNm);
      const positionEcef = geodeticToEcef(
        degToRad(point.latDeg),
        degToRad(point.lonDeg),
        point.altitudeFt * FEET_TO_M,
      );
      // Level on the approach heading — the guide flies the centerline, no faked pitch/roll.
      const attitude = quatFromHpr(positionEcef, degToRad(approachHeadingDeg), 0, 0);
      model.update(positionEcef, attitude);
      model.setVisible(true);
    };

    viewer.scene.preRender.addEventListener(onPreRender);
    return () => {
      if (viewer.isDestroyed()) return;
      viewer.scene.preRender.removeEventListener(onPreRender);
      model.setVisible(false);
    };
  }, [bundle?.viewer, mission, assist, instantFlight]);

  // Destroy the director model only when the layer unmounts (viewer teardown), like the ghost model.
  useEffect(() => {
    return () => {
      modelRef.current?.destroy();
      modelRef.current = null;
    };
  }, []);

  return null;
}
