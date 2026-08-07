/*
 * The ONLY Cesium in the windscreen-tag feature: build a world -> window projection out of
 * SceneTransforms, hand it to the pure `projectTraffic`, and render the result as DOM.
 *
 * Two things Cesium has to answer that arithmetic cannot:
 *  - is the contact IN FRONT of the camera? `worldToWindowCoordinates` will happily project a
 *    point behind the eye onto the screen, so the adapter takes the dot product of
 *    (contact - camera position) with the camera direction first and rejects anything behind.
 *  - what are the canvas's CSS pixel dimensions right now? `clientWidth`/`clientHeight`, read
 *    per update rather than cached, so a window resize needs no listener.
 *
 * Cadence: this recomputes when the ~10 Hz snapshot changes identity or the contact map changes
 * (~0.2 Hz), NOT per rendered frame. Tags therefore lag a fast camera slew by up to 100 ms,
 * which is the documented cost of not putting a per-frame React update in the render loop.
 *
 * Known limitation, recorded in decisions.md CD-007: there is no terrain occlusion test, so a
 * contact behind a ridge inside 40 NM still gets a tag.
 */
import { useSyncExternalStore } from "react";
import { Cartesian3, SceneTransforms } from "cesium";
import { useStore } from "../state/store";
import { useViewer } from "./viewerContext";
import { hudSnapshot } from "../hud/snapshot";
import { projectTraffic, type ProjectFn } from "../dashboard/trafficProjection";
import TrafficTags from "../dashboard/TrafficTags";

export default function TrafficOverlay({ onSelect }: { onSelect(hex: string): void }) {
  const bundle = useViewer();
  const contacts = useStore((s) => s.contacts);
  const origin = useStore((s) => s.origin);
  const snapshot = useSyncExternalStore(hudSnapshot.subscribe, hudSnapshot.get, hudSnapshot.get);

  if (!bundle || snapshot === null) return null;
  const scene = bundle.viewer.scene;
  const canvas = scene.canvas;

  const project: ProjectFn = (lonDeg, latDeg, heightM) => {
    const world = Cartesian3.fromDegrees(lonDeg, latDeg, heightM);
    const toContact = Cartesian3.subtract(world, scene.camera.positionWC, new Cartesian3());
    if (Cartesian3.dot(toContact, scene.camera.directionWC) <= 0) return null; // behind the eye
    const win = SceneTransforms.worldToWindowCoordinates(scene, world);
    return win ? { x: win.x, y: win.y } : null;
  };

  const tags = projectTraffic({
    contacts,
    own: { latDeg: snapshot.latDeg, lonDeg: snapshot.lonDeg },
    project,
    viewport: { widthPx: canvas.clientWidth, heightPx: canvas.clientHeight },
    ghostHex: origin?.hex ?? null,
  });

  return (
    <div className="traffic-overlay">
      <TrafficTags tags={tags} onSelect={onSelect} />
    </div>
  );
}
