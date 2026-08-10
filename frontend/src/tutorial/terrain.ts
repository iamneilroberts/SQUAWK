import type { RunwayAssignment } from "../mission/types";
import { ftToM } from "../sim/units";
import { createTerrainService, type TerrainService } from "../world/terrain";

/**
 * Tutorials use a disclosed flat runway-elevation plane. This is deterministic, works offline,
 * and is never used by live missions, whose collision service still requires sampled terrain.
 */
export function createTutorialTerrainService(assignment: RunwayAssignment): TerrainService {
  const elevationFt = assignment.assignedEnd.elevationFt ?? assignment.airportElevationFt ?? 0;
  const elevationM = ftToM(elevationFt);
  return createTerrainService(() => elevationM, { spawnGraceS: 0 });
}
