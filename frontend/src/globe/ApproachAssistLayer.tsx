import { useEffect } from "react";
import { Cartesian2, Cartesian3, Color, LabelStyle, VerticalOrigin } from "cesium";
import type { LockedMissionView } from "../mission/contract";
import { assistFeatures, type AssistMode } from "../mission/assists";
import {
  approachGuidance,
  approachRails,
  finalApproachFix,
  type GuidancePoint,
  type GuidanceSegment,
} from "../mission/guidanceGeometry";
import { useViewer } from "./viewerContext";

const RAIL_COLOR = Color.CYAN;
// Dims (rather than z-fights/flickers) the parts of a rail or gate that fall behind terrain or
// the runway itself, instead of the default of just not drawing them.
const RAIL_DEPTH_FAIL_COLOR = Color.CYAN.withAlpha(0.35);

function world(point: GuidancePoint): Cartesian3 {
  return Cartesian3.fromDegrees(point.lonDeg, point.latDeg, point.altitudeFt * 0.3048);
}

/** Midpoint of a rail cross-section pair — exact on the centerline since left/right are
 *  symmetric perpendicular offsets from it (same construction approachRails/approachRibbon use). */
function midpoint(a: GuidancePoint, b: GuidancePoint): GuidancePoint {
  return {
    latDeg: (a.latDeg + b.latDeg) / 2,
    lonDeg: (a.lonDeg + b.lonDeg) / 2,
    altitudeFt: (a.altitudeFt + b.altitudeFt) / 2,
  };
}

/** Closed 4-corner loop for one gate: a square hoop centered on the cross-section, sized to its
 *  actual (tapered) width so gates shrink toward the threshold with the rails they sit between. */
function gateHoop(section: GuidanceSegment): Cartesian3[] {
  const leftWorld = world(section.left);
  const rightWorld = world(section.right);
  const halfHeightFt = Cartesian3.distance(leftWorld, rightWorld) / 2 / 0.3048;
  const bottomLeft = world({ ...section.left, altitudeFt: section.left.altitudeFt - halfHeightFt });
  const topLeft = world({ ...section.left, altitudeFt: section.left.altitudeFt + halfHeightFt });
  const topRight = world({ ...section.right, altitudeFt: section.right.altitudeFt + halfHeightFt });
  const bottomRight = world({ ...section.right, altitudeFt: section.right.altitudeFt - halfHeightFt });
  return [bottomLeft, topLeft, topRight, bottomRight, bottomLeft];
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
    // Fixed-point references (flare cue, FAF) plus, at FULL assist, a CENTERLINE + GATES along the
    // curved corridor (base-leg entry -> FAF -> threshold, the dogleg the player turns onto) —
    // world-anchored geometry from the assigned runway + guidance knobs only, no live-position
    // input, so it never swings frame to frame. Replaces the flat translucent surface (owner
    // decision 2026-08-15): edge-on from the cockpit it read as a faint fan, unusable. The two edge
    // rails that originally bounded the corridor were dropped in favor of the gates alone (owner
    // 2026-08): with both rails visible from most viewing angles they crisscrossed into visual
    // clutter — the square gates already mark the corridor width at each cross-section, so a single
    // centerline reference (this rail's midpoint at every cross-section, still on the glide slope)
    // is enough to show the line to fly without the crossing lines. Both gate on the same FULL-only
    // flags.
    if (viewer === undefined || viewer.isDestroyed() || (!features.flareCue && !features.approachCorridor)) return;
    const guidance = mission.missionProfile.guidance;
    const entities: ReturnType<typeof viewer.entities.add>[] = [];
    if (features.approachCorridor) {
      const rails = approachRails(mission.assignment, guidance);
      const centerline = rails.leftRail.map((left, i) => midpoint(left, rails.rightRail[i]));
      entities.push(viewer.entities.add({
        polyline: {
          positions: centerline.map(world),
          width: 3,
          material: RAIL_COLOR,
          depthFailMaterial: RAIL_DEPTH_FAIL_COLOR,
        },
      }));
      for (const gate of rails.gates) {
        entities.push(viewer.entities.add({
          polyline: {
            positions: gateHoop(gate),
            width: 2,
            material: RAIL_COLOR,
            depthFailMaterial: RAIL_DEPTH_FAIL_COLOR,
          },
        }));
      }
    }
    if (features.flareCue) {
      const flare = approachGuidance(mission.assignment, guidance).flare;
      entities.push(viewer.entities.add({
        position: world(flare),
        point: { pixelSize: 7, color: Color.ORANGE },
        label: {
          text: `FLARE · ${guidance.flareHeightFt} FT`,
          font: "11px monospace",
          fillColor: Color.ORANGE,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -10),
        },
      }));
      const faf = finalApproachFix(mission.assignment, guidance);
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
