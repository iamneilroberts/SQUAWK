/*
 * Where a contact actually is, in metres — the one datum rule, in a Cesium-free module so both
 * the globe layer and the dashboard can apply it without either importing the other's world.
 *
 * Moved here from globe/contactBillboards.ts, unchanged: `dashboard/trafficProjection.ts` needs
 * the same rule, and importing it from a module that pulls in Cesium would have made the whole
 * dashboard transitively Cesium-dependent.
 */
import type { Contact } from "./types";
import { ftToM } from "../sim/units";

/**
 * Height for a contact, in metres above the ellipsoid. `alt_geom` only: it is WGS84-ellipsoidal,
 * the same datum as the terrain, so a contact placed with it sits where it actually is.
 * `alt_baro` is pressure altitude and would put aircraft at the wrong height over real relief,
 * so a contact without alt_geom is not placed in 3D at all (it still appears in the contact list,
 * with its baro altitude, honestly labelled). decisions.md B-014.
 */
export function contactHeightM(c: Contact): number | null {
  return c.alt_geom === null ? null : ftToM(c.alt_geom);
}
