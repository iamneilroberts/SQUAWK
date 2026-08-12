/*
 * PAPI (#23) is world furniture, not an assist: it mounts at every assist level, exactly like
 * a real airport, so players who turn assists OFF keep a realistic glide cue. Colors come from
 * pure papiColors() via CallbackProperty reading the live hudSnapshot — no per-frame entity
 * churn. A null snapshot renders DIMGRAY (unknown), never a fabricated white/red.
 */
import { useEffect } from "react";
import { CallbackProperty, Cartesian3, Color, NearFarScalar } from "cesium";
import type { LockedMissionView } from "../mission/contract";
import type { GuidancePoint } from "../mission/guidanceGeometry";
import { papiColors, papiLightPositions, papiPosition } from "../mission/papi";
import { hudSnapshot } from "../hud/snapshot";
import { mToFt } from "../sim/units";
import { useViewer } from "./viewerContext";

const PAPI_WHITE = Color.WHITE;
const PAPI_RED = Color.fromCssColorString("#ff3b30");
const PAPI_UNKNOWN = Color.DIMGRAY;

function world(point: GuidancePoint): Cartesian3 {
  return Cartesian3.fromDegrees(point.lonDeg, point.latDeg, point.altitudeFt * 0.3048);
}

export default function PapiLayer({ mission }: { mission: LockedMissionView }) {
  const bundle = useViewer();

  useEffect(() => {
    const viewer = bundle?.viewer;
    if (viewer === undefined || viewer.isDestroyed()) return;
    const base = papiPosition(mission.assignment);
    const lights = papiLightPositions(mission.assignment);
    const glideSlopeDeg = mission.missionProfile.guidance.glideSlopeDeg;
    const entities = lights.map((light, index) => viewer.entities.add({
      position: world(light),
      point: {
        pixelSize: 8,
        outlineColor: Color.BLACK.withAlpha(0.8),
        outlineWidth: 1,
        // legible from miles out without ballooning up close (near 1 nm → far 30 nm)
        scaleByDistance: new NearFarScalar(1852, 1.25, 55560, 0.6),
        color: new CallbackProperty(() => {
          const snapshot = hudSnapshot.get();
          if (snapshot === null) return PAPI_UNKNOWN;
          const colors = papiColors(
            {
              latDeg: snapshot.latDeg,
              lonDeg: snapshot.lonDeg,
              altitudeFt: mToFt(snapshot.altitudeM),
            },
            base,
            glideSlopeDeg,
          );
          return colors[index] ? PAPI_WHITE : PAPI_RED;
        }, false),
      },
    }));
    return () => {
      if (viewer.isDestroyed()) return;
      for (const entity of entities) viewer.entities.remove(entity);
    };
  }, [bundle?.viewer, mission]);

  return null;
}
