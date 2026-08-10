import { useEffect } from "react";
import {
  ArcType,
  Cartesian2,
  Cartesian3,
  Color,
  LabelStyle,
  VerticalOrigin,
} from "cesium";
import type { LockedMissionView } from "../mission/contract";
import { assistFeatures, type AssistMode } from "../mission/assists";
import { runwayOutline } from "../mission/guidanceGeometry";
import { useViewer } from "./viewerContext";

function contactAltitudeM(mission: LockedMissionView): number {
  const contact = mission.contact;
  return (contact.alt_geom ?? (typeof contact.alt_baro === "number" ? contact.alt_baro : 0)) * 0.3048;
}

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
    const start = Cartesian3.fromDegrees(
      mission.contact.lon,
      mission.contact.lat,
      contactAltitudeM(mission),
    );
    const destination = Cartesian3.fromDegrees(
      assignment.assignedEnd.lonDeg,
      assignment.assignedEnd.latDeg,
      (assignment.assignedEnd.elevationFt ?? assignment.airportElevationFt ?? 0) * 0.3048,
    );
    const route = viewer.entities.add({
      polyline: {
        positions: [start, destination],
        width: 2,
        arcType: ArcType.GEODESIC,
        material: Color.CYAN.withAlpha(0.85),
      },
    });
    const outline = runwayOutline(assignment);
    const runway = viewer.entities.add({
      polyline: {
        positions: outline.map((point) =>
          Cartesian3.fromDegrees(point.lonDeg, point.latDeg, point.altitudeFt * 0.3048 + 2)),
        width: 3,
        material: Color.ORANGE.withAlpha(0.95),
      },
    });
    const cue = viewer.entities.add({
      position: destination,
      point: { pixelSize: 9, color: Color.ORANGE, outlineColor: Color.BLACK, outlineWidth: 1 },
      label: {
        text: `${assignment.airportIdent} · RWY ${assignment.runwayEndIdent}`,
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
      viewer.entities.remove(runway);
      viewer.entities.remove(cue);
    };
  }, [bundle?.viewer, mission, assist]);

  return null;
}
