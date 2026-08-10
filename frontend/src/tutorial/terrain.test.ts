import { describe, expect, it } from "vitest";

import { ftToM } from "../sim/units";
import { tutorialDefinitionForClass } from "./definitions";
import { createTutorialTerrainService } from "./terrain";

describe("tutorial terrain", () => {
  it("arms deterministic collision at the published runway elevation without a network sampler", () => {
    const assignment = tutorialDefinitionForClass("f5e").assignment;
    const terrain = createTutorialTerrainService(assignment);
    const sample = terrain.sample(0, 0, 0);
    expect(sample).toEqual({
      heightM: ftToM(assignment.assignedEnd.elevationFt ?? 0),
      verified: true,
      collisionArmed: true,
    });
    expect(terrain.unverified).toBe(false);
  });
});
