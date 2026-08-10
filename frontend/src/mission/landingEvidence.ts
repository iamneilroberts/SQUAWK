import { ecefToGeodetic } from "../sim/geo";
import { hprFromQuat } from "../sim/quat";
import type { SimState } from "../sim/types";
import { msToFpm, msToKt, radToDeg } from "../sim/units";
import { normalizeHeading } from "./geo";

export const LANDING_EVIDENCE_SAMPLE_INTERVAL_MS = 100;
export const LANDING_EVIDENCE_MAX_SAMPLES = 512;
export const LANDING_EVIDENCE_MAX_BYTES = 128 * 1024;

export type LandingEvidenceSample = {
  timeMs: number;
  latDeg: number;
  lonDeg: number;
  altitudeFt: number;
  iasKt: number;
  /** Positive means descending. */
  sinkRateFpm: number;
  headingDeg: number;
  pitchDeg: number;
  bankDeg: number;
  loadFactor: number;
  gearPosition: number;
  surfaceContact: boolean;
};

export type LandingEvidence = {
  schemaVersion: 1;
  sampleIntervalMs: typeof LANDING_EVIDENCE_SAMPLE_INTERVAL_MS;
  samples: LandingEvidenceSample[];
};

function rounded(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

export function landingSampleFromState(
  state: SimState,
  surfaceContact: boolean,
): LandingEvidenceSample {
  const position = ecefToGeodetic(state.position);
  const attitude = hprFromQuat(state.attitude, state.position);
  return {
    timeMs: Math.max(0, Math.round(state.timeS * 1_000)),
    latDeg: rounded(radToDeg(position.latRad), 7),
    lonDeg: rounded(radToDeg(position.lonRad), 7),
    altitudeFt: rounded(state.altitudeM / 0.3048, 1),
    iasKt: rounded(msToKt(state.iasMs), 2),
    sinkRateFpm: rounded(-msToFpm(state.verticalSpeedMs), 1),
    headingDeg: rounded(normalizeHeading(radToDeg(attitude.headingRad)), 2),
    pitchDeg: rounded(radToDeg(attitude.pitchRad), 2),
    bankDeg: rounded(radToDeg(attitude.rollRad), 2),
    loadFactor: rounded(state.loadFactor, 3),
    gearPosition: rounded(state.gearPosition, 3),
    surfaceContact,
  };
}

function appendBounded(samples: LandingEvidenceSample[], sample: LandingEvidenceSample): void {
  samples.push(sample);
  if (samples.length > LANDING_EVIDENCE_MAX_SAMPLES) {
    samples.splice(0, samples.length - LANDING_EVIDENCE_MAX_SAMPLES);
  }
}

export function encodedEvidenceBytes(evidence: LandingEvidence): number {
  return new TextEncoder().encode(JSON.stringify(evidence)).byteLength;
}

export function createLandingEvidenceRecorder(start: SimState): {
  record(state: SimState): void;
  finish(state: SimState): LandingEvidence;
} {
  const samples: LandingEvidenceSample[] = [landingSampleFromState(start, false)];
  let nextSampleTimeS = start.timeS + LANDING_EVIDENCE_SAMPLE_INTERVAL_MS / 1_000;
  let finished = false;

  return {
    record(state) {
      if (finished || state.timeS + 1e-9 < nextSampleTimeS) return;
      appendBounded(samples, landingSampleFromState(state, false));
      // Fixed-step simulation normally lands exactly on this cadence. Advancing from the
      // previous target (rather than state.timeS) keeps a delayed render frame from drifting it.
      while (nextSampleTimeS <= state.timeS + 1e-9) {
        nextSampleTimeS += LANDING_EVIDENCE_SAMPLE_INTERVAL_MS / 1_000;
      }
    },
    finish(state) {
      if (!finished) {
        finished = true;
        const contact = landingSampleFromState(state, true);
        const last = samples.at(-1);
        if (last?.timeMs === contact.timeMs) samples[samples.length - 1] = contact;
        else appendBounded(samples, contact);
      }
      const evidence: LandingEvidence = {
        schemaVersion: 1,
        sampleIntervalMs: LANDING_EVIDENCE_SAMPLE_INTERVAL_MS,
        samples: samples.map((sample) => ({ ...sample })),
      };
      if (encodedEvidenceBytes(evidence) > LANDING_EVIDENCE_MAX_BYTES) {
        throw new RangeError("Landing evidence exceeds the encoded size limit");
      }
      return evidence;
    },
  };
}
