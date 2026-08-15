import { useEffect } from "react";
import { Cartesian2, Cartesian3, Color, LabelStyle, PolygonHierarchy, VerticalOrigin } from "cesium";
import type { LockedMissionView } from "../mission/contract";
import { assistFeatures, type AssistMode } from "../mission/assists";
import {
  approachGuidance,
  approachRibbon,
  finalApproachFix,
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
    // Fixed-point references (flare cue, FAF) plus, at FULL assist, the curved corridor ribbon
    // (Feature 2) — a world-anchored strip along base-leg entry -> FAF -> threshold the player
    // flies onto. Both gate on the same FULL-only flags.
    if (viewer === undefined || viewer.isDestroyed() || (!features.flareCue && !features.approachCorridor)) return;
    const guidance = approachGuidance(mission.assignment, mission.missionProfile.guidance);
    const entities: ReturnType<typeof viewer.entities.add>[] = [];
    if (features.approachCorridor) {
      // The curved, tapering ribbon (Feature 2): fixed geometry from the assigned runway +
      // guidance knobs only — no live-position input, so it never swings frame to frame.
      const ribbonSections = approachRibbon(mission.assignment, mission.missionProfile.guidance);
      for (const quad of surfaceQuads(ribbonSections)) {
        entities.push(viewer.entities.add({
          polygon: {
            hierarchy: new PolygonHierarchy(quad.map(world)),
            perPositionHeight: true,
            material: Color.CYAN.withAlpha(0.18),
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
      const faf = finalApproachFix(mission.assignment, mission.missionProfile.guidance);
      entities.push(viewer.entities.add({
        position: world(faf.point),
        point: { pixelSize: 7, color: Color.ORANGE },
        label: {
          text: "FAF",
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
