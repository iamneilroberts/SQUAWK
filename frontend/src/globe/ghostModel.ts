/*
 * The live-feed ghost's low-poly model (issue #15). The ghost is the REAL aircraft, still on the
 * feed after takeover (ghost.ts). It already shows a dimmed chevron + honest staleness label; this
 * adds the same per-class solid low-poly model the player flies, in the distinct NON-SIM cyan styling
 * (GHOST_MODEL_STYLE) so the real aircraft can never be mistaken for the player's amber SIM one.
 *
 * Orientation is taken from the real ADS-B TRACK, held level (no pitch/roll) — ADS-B carries no
 * attitude, so none is invented. Position is the live geodetic position; it updates at the feed
 * cadence (~1 Hz), not per frame, which is why this is a plain sync called from ContactLayer's
 * store effect rather than a render-loop hook.
 */
import { type Viewer } from "cesium";
import type { Contact } from "../data/types";
import { contactHeightM } from "../data/contactGeo";
import { geodeticToEcef } from "../sim/geo";
import { quatFromHpr } from "../sim/quat";
import { degToRad } from "../sim/units";
import { resolveClass } from "../takeover/eligibility";
import { createAircraftModel, GHOST_MODEL_STYLE, type AircraftModel } from "./aircraftModel";

export type GhostModelRef = { model: AircraftModel | null; classId: string | null };

/**
 * Create, move, re-class or remove the single ghost model. Rebuilt only when the class changes
 * (it never does mid-session — the class is resolved from the takeover's origin snapshot). Removed
 * whenever there is no origin or the ghost has no plottable position (off-feed / no altitude).
 */
export function syncGhostModel(
  viewer: Viewer,
  ref: GhostModelRef,
  origin: { hex: string; snapshot: Contact } | null,
  ghost: Contact | undefined,
): void {
  const height = ghost ? contactHeightM(ghost) : null;
  if (!origin || !ghost || height === null) {
    if (ref.model) {
      ref.model.destroy();
      ref.model = null;
      ref.classId = null;
    }
    return;
  }

  // The ghost flies the class resolved from the takeover snapshot — the same one the player took.
  const resolution = resolveClass(origin.snapshot);
  if (!resolution.supported) {
    ref.model?.destroy();
    ref.model = null;
    ref.classId = null;
    return;
  }
  const classId = resolution.classId;
  if (ref.model === null || ref.classId !== classId) {
    ref.model?.destroy();
    ref.model = createAircraftModel(viewer, classId, GHOST_MODEL_STYLE);
    ref.classId = classId;
  }

  const position = geodeticToEcef(degToRad(ghost.lat), degToRad(ghost.lon), height);
  const attitude = quatFromHpr(position, degToRad(ghost.track ?? 0), 0, 0);
  ref.model.update(position, attitude);
  ref.model.setVisible(true);
}
