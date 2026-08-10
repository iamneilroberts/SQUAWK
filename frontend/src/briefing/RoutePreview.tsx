import { useEffect } from "react";
import { ArcType, Cartesian2, Cartesian3, Color, LabelStyle, VerticalOrigin } from "cesium";
import type { Contact } from "../data/types";
import type { RunwayAssignment } from "../mission/types";
import { useViewer } from "../globe/viewerContext";

function contactAltitudeM(contact: Contact): number {
  const altitudeFt = contact.alt_geom ?? (typeof contact.alt_baro === "number" ? contact.alt_baro : 0);
  return altitudeFt * 0.3048;
}

export default function RoutePreview({
  contact,
  assignment,
}: {
  contact: Contact;
  assignment: RunwayAssignment;
}) {
  const bundle = useViewer();

  useEffect(() => {
    if (bundle === null || bundle.viewer.isDestroyed()) return;
    const start = Cartesian3.fromDegrees(contact.lon, contact.lat, contactAltitudeM(contact));
    const destination = Cartesian3.fromDegrees(
      assignment.assignedEnd.lonDeg,
      assignment.assignedEnd.latDeg,
      (assignment.assignedEnd.elevationFt ?? assignment.airportElevationFt ?? 0) * 0.3048,
    );
    const route = bundle.viewer.entities.add({
      polyline: {
        positions: [start, destination],
        width: 2,
        arcType: ArcType.GEODESIC,
        material: Color.CYAN.withAlpha(0.9),
      },
    });
    const runway = bundle.viewer.entities.add({
      position: destination,
      point: {
        pixelSize: 8,
        color: Color.ORANGE,
        outlineColor: Color.BLACK,
        outlineWidth: 1,
      },
      label: {
        text: `${assignment.airportIdent} · RWY ${assignment.runwayEndIdent}`,
        font: "11px monospace",
        fillColor: Color.CYAN,
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -10),
      },
    });
    return () => {
      if (bundle.viewer.isDestroyed()) return;
      bundle.viewer.entities.remove(route);
      bundle.viewer.entities.remove(runway);
    };
  }, [
    bundle,
    contact,
    assignment,
  ]);

  return null;
}
