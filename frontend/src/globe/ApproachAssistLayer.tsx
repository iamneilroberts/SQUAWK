import { useEffect } from "react";
import { Cartesian2, Cartesian3, Color, LabelStyle, PolygonHierarchy, VerticalOrigin } from "cesium";
import type { LockedMissionView } from "../mission/contract";
import { assistFeatures, type AssistMode } from "../mission/assists";
import {
  approachGuidance,
  approachSurface,
  surfaceQuads,
  type GuidancePoint,
} from "../mission/guidanceGeometry";
import { useViewer } from "./viewerContext";

function world(point: GuidancePoint): Cartesian3 {
  return Cartesian3.fromDegrees(point.lonDeg, point.latDeg, point.altitudeFt * 0.3048);
}

export default function ApproachAssistLayer({
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
    if (viewer === undefined || viewer.isDestroyed() || !features.approachCorridor) return;
    const guidance = approachGuidance(mission.assignment, mission.missionProfile.guidance);
    // The flyable surface (#24) replaces the two corridor edge polylines: one translucent
    // quad per cross-section pair, lying exactly on the slope the gates mark.
    const sections = approachSurface(mission.assignment, mission.missionProfile.guidance);
    const entities = surfaceQuads(sections).map((quad) => viewer.entities.add({
      polygon: {
        hierarchy: new PolygonHierarchy(quad.map(world)),
        perPositionHeight: true,
        material: Color.CYAN.withAlpha(0.15),
      },
    }));
    if (features.glideGates) {
      for (const gate of guidance.gates) {
        entities.push(viewer.entities.add({
          polyline: {
            positions: [world(gate.left), world(gate.right)],
            width: 1,
            material: Color.CYAN.withAlpha(0.6),
          },
        }));
      }
    }
    if (features.flareCue) {
      entities.push(viewer.entities.add({
        position: world(guidance.flare),
        point: { pixelSize: 7, color: Color.ORANGE },
        label: {
          text: `FLARE · ${mission.missionProfile.guidance.flareHeightFt} FT`,
          font: "11px monospace",
          fillColor: Color.ORANGE,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -10),
        },
      }));
    }
    return () => {
      if (viewer.isDestroyed()) return;
      for (const entity of entities) viewer.entities.remove(entity);
    };
  }, [bundle?.viewer, mission, assist]);

  return null;
}
