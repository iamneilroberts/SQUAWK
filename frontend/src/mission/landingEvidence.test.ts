import { describe, expect, it } from "vitest";
import { loadC172 } from "../sim/params";
import type { SimState } from "../sim/types";
import { buildSpawnState } from "../takeover/spawn";
import type { Contact } from "../data/types";
import {
  createLandingEvidenceRecorder,
  encodedEvidenceBytes,
  LANDING_EVIDENCE_MAX_BYTES,
  LANDING_EVIDENCE_MAX_SAMPLES,
} from "./landingEvidence";

const contact: Contact = {
  hex: "abc123", flight: "N123", t: "C172", lat: 30, lon: -88,
  alt_geom: 1_000, alt_baro: 1_000, gs: 70, track: 90, baro_rate: -100,
  military: false, seen_pos: 0,
};

function stateAt(start: SimState, timeS: number): SimState {
  return { ...start, timeS };
}

describe("bounded landing evidence", () => {
  it("records at 10 Hz and marks only the terminal contact sample", () => {
    const start = buildSpawnState(contact, loadC172(), { terrainHeightM: 0 }).state;
    const recorder = createLandingEvidenceRecorder(start);
    for (let tick = 1; tick <= 60; tick += 1) recorder.record(stateAt(start, tick / 60));
    const evidence = recorder.finish(stateAt(start, 1));
    expect(evidence.samples).toHaveLength(11);
    expect(evidence.samples.map((sample) => sample.timeMs)).toEqual(
      Array.from({ length: 11 }, (_, index) => index * 100),
    );
    expect(evidence.samples.filter((sample) => sample.surfaceContact)).toHaveLength(1);
    expect(evidence.samples.at(-1)?.surfaceContact).toBe(true);
  });

  it("retains only the latest 512 samples and remains below 128 KiB", () => {
    const start = buildSpawnState(contact, loadC172(), { terrainHeightM: 0 }).state;
    const recorder = createLandingEvidenceRecorder(start);
    for (let tick = 1; tick <= 60 * 70; tick += 1) recorder.record(stateAt(start, tick / 60));
    const evidence = recorder.finish(stateAt(start, 70));
    expect(evidence.samples).toHaveLength(LANDING_EVIDENCE_MAX_SAMPLES);
    expect(evidence.samples[0].timeMs).toBeGreaterThan(0);
    expect(encodedEvidenceBytes(evidence)).toBeLessThanOrEqual(LANDING_EVIDENCE_MAX_BYTES);
  });

  it("returns defensive copies after finish", () => {
    const start = buildSpawnState(contact, loadC172(), { terrainHeightM: 0 }).state;
    const recorder = createLandingEvidenceRecorder(start);
    const first = recorder.finish(start);
    first.samples[0].latDeg = 0;
    expect(recorder.finish(start).samples[0].latDeg).toBeCloseTo(30, 5);
  });

  it("normalizes westbound headings into the submitted 0–360 range", () => {
    const westbound = buildSpawnState({ ...contact, track: 270 }, loadC172(), { terrainHeightM: 0 }).state;
    expect(createLandingEvidenceRecorder(westbound).finish(westbound).samples[0].headingDeg)
      .toBeCloseTo(270, 1);
  });
});
