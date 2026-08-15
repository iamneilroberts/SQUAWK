import { useEffect } from "react";
import { Cartesian2, Cartesian3, Color, LabelStyle, VerticalOrigin } from "cesium";
import type { LockedMissionView } from "../mission/contract";
import { assistFeatures, type AssistMode } from "../mission/assists";
import { approachGuidance, finalApproachFix, type GuidancePoint } from "../mission/guidanceGeometry";
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
    // The approach flight director (#22) is the primary landing-guidance visual now: the
    // translucent corridor surface + glide gates (#24) that used to draw the glide-slope line
    // are retired in favor of the green lead aircraft flying it. This layer keeps only the
    // fixed-point references (flare cue, FAF) that a moving guide doesn't replace.
    if (viewer === undefined || viewer.isDestroyed() || !features.flareCue) return;
    const guidance = approachGuidance(mission.assignment, mission.missionProfile.guidance);
    const entities = [viewer.entities.add({
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
    })];
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
    return () => {
      if (viewer.isDestroyed()) return;
      for (const entity of entities) viewer.entities.remove(entity);
    };
  }, [bundle?.viewer, mission, assist]);

  return null;
}
