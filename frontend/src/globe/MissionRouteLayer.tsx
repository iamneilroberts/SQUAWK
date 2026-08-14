import { useEffect } from "react";
import {
  ArcType,
  Cartesian2,
  Cartesian3,
  CallbackProperty,
  Color,
  type Entity,
  LabelStyle,
  VerticalOrigin,
} from "cesium";
import type { LockedMissionView } from "../mission/contract";
import { assistFeatures, type AssistMode } from "../mission/assists";
import { greatCircleDistanceNm } from "../mission/geo";
import { finalApproachFix, runwayOutline } from "../mission/guidanceGeometry";
import { hudSnapshot } from "../hud/snapshot";
import { routeStartPoint } from "./missionRoutePath";
import { useViewer } from "./viewerContext";
import { useStore } from "../state/store";

export default function MissionRouteLayer({
  mission,
  assist,
}: {
  mission: LockedMissionView;
  assist: AssistMode;
}) {
  const bundle = useViewer();

  useEffect(() => {
    const viewer = bundle?.viewer;
    const features = assistFeatures(assist);
    if (viewer === undefined || viewer.isDestroyed() || !features.route) return;
    const assignment = mission.assignment;
    const destination = Cartesian3.fromDegrees(
      assignment.assignedEnd.lonDeg,
      assignment.assignedEnd.latDeg,
      (assignment.assignedEnd.elevationFt ?? assignment.airportElevationFt ?? 0) * 0.3048,
    );
    const faf = finalApproachFix(assignment, mission.missionProfile.guidance).point;
    const fafCartesian = Cartesian3.fromDegrees(faf.lonDeg, faf.latDeg, faf.altitudeFt * 0.3048);
    // Sub-pixel throttle: the CallbackProperty runs every frame, but the aircraft rarely moves
    // more than ~1m frame-to-frame at sim rate — rebuilding an identical positions array each
    // frame is what caused the terrain-occlusion z-fight flicker on final.
    let lastStart: Cartesian3 | null = null;
    let lastPositions: Cartesian3[] = [];
    const route = viewer.entities.add({
      polyline: {
        // #50: start at the LIVE aircraft position so the line only ever shows the
        // remaining path — pre-spawn it falls back to the contact's real position.
        positions: new CallbackProperty(() => {
          const start = routeStartPoint(hudSnapshot.get(), mission);
          const startCartesian = Cartesian3.fromDegrees(start.lonDeg, start.latDeg, start.altitudeFt * 0.3048);
          if (lastStart && Cartesian3.distance(startCartesian, lastStart) < 1) return lastPositions;
          lastStart = startCartesian;
          lastPositions = [startCartesian, fafCartesian, destination];
          return lastPositions;
        }, false),
        width: 2,
        arcType: ArcType.GEODESIC,
        material: Color.CYAN.withAlpha(0.85),
        // Render the occluded segments (dimmer) instead of letting them flicker: without a
        // depthFailMaterial the thin line z-fights the terrain each frame (its positions rebuild
        // every frame via the CallbackProperty) and reads as a strobing line.
        depthFailMaterial: Color.CYAN.withAlpha(0.35),
        // #61: in the exterior chase view the route line trails behind the aircraft, flickers and
        // adds no value — hide it there. It stays in the cockpit view where it points to the target.
        show: new CallbackProperty(() => !useStore.getState().exterior, false),
      },
    });
    // Instant flight targets a runway-free airport point (runwayLengthFt === 0): skip the
    // degenerate outline, but still draw the route line + labeled marker so the destination reads.
    let runway: Entity | undefined;
    if (assignment.runwayLengthFt > 0) {
      const outline = runwayOutline(assignment);
      runway = viewer.entities.add({
        polyline: {
          positions: outline.map((point) =>
            Cartesian3.fromDegrees(point.lonDeg, point.latDeg, point.altitudeFt * 0.3048 + 2)),
          width: 3,
          material: Color.ORANGE.withAlpha(0.95),
          // Same terrain-occlusion flicker fix as the route line above: without a depthFailMaterial
          // the occluded segments z-fight the terrain and strobe.
          depthFailMaterial: Color.ORANGE.withAlpha(0.5),
        },
      });
    }
    // Drop the "· RWY --" when there is no assigned runway end (instant flight).
    const rwyPart = assignment.runwayEndIdent === "--" ? "" : ` · RWY ${assignment.runwayEndIdent}`;
    const cue = viewer.entities.add({
      position: destination,
      point: { pixelSize: 9, color: Color.ORANGE, outlineColor: Color.BLACK, outlineWidth: 1 },
      label: {
        // Live distance so the destination marker doubles as a range readout at any range.
        text: new CallbackProperty(() => {
          const snap = hudSnapshot.get();
          const head = `${assignment.airportIdent}${rwyPart}`;
          if (snap === null) return head;
          const distanceNm = greatCircleDistanceNm(
            snap.latDeg, snap.lonDeg,
            assignment.assignedEnd.latDeg, assignment.assignedEnd.lonDeg,
          );
          return `${head}\n${distanceNm.toFixed(1)} NM`;
        }, false),
        font: "12px monospace",
        fillColor: Color.CYAN,
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -12),
      },
    });
    return () => {
      if (viewer.isDestroyed()) return;
      viewer.entities.remove(route);
      if (runway) viewer.entities.remove(runway);
      viewer.entities.remove(cue);
    };
  }, [bundle?.viewer, mission, assist]);

  return null;
}
