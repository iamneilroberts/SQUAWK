import type { PassedLandingSafety } from "./landingSafety";
import type { MissionProfile, ScoreCurvePoint } from "./types";

export const LANDING_SCORE_WEIGHTS = {
  verticalSpeed: 25,
  centerline: 20,
  touchdownZone: 20,
  alignment: 15,
  speed: 10,
  bank: 5,
  rollout: 5,
} as const;

export type LandingScoreComponents = {
  verticalSpeed: number;
  centerline: number;
  touchdownZone: number;
  alignment: number;
  speed: number;
  bank: number;
  rollout: number;
};

export type LandingScore = {
  total: number;
  components: LandingScoreComponents;
};

export function scoreCurve(value: number, curve: readonly ScoreCurvePoint[]): number {
  if (value <= curve[0].value) return curve[0].score;
  const last = curve[curve.length - 1];
  if (value >= last.value) return last.score;
  for (let index = 1; index < curve.length; index += 1) {
    const right = curve[index];
    const left = curve[index - 1];
    if (value <= right.value) {
      const ratio = (value - left.value) / (right.value - left.value);
      return left.score + (right.score - left.score) * ratio;
    }
  }
  return last.score;
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

export function scoreLanding(
  safety: PassedLandingSafety,
  profile: MissionProfile,
): LandingScore {
  const value = safety.measurements;
  const fractions = {
    verticalSpeed: scoreCurve(value.sinkRateFpm, profile.scoreCurves.verticalSpeedFpm),
    centerline: scoreCurve(value.centerlineErrorFt, profile.scoreCurves.centerlineErrorFt),
    touchdownZone: scoreCurve(value.touchdownDistanceFt, profile.scoreCurves.touchdownZoneFt),
    alignment: scoreCurve(value.headingErrorDeg, profile.scoreCurves.headingErrorDeg),
    speed: scoreCurve(value.speedErrorKt, profile.scoreCurves.speedErrorKt),
    bank: scoreCurve(value.bankDeg, profile.scoreCurves.bankDeg),
    rollout: scoreCurve(value.rolloutCrossTrackFt, profile.scoreCurves.rolloutCrossTrackFt),
  };
  const components = Object.fromEntries(
    Object.entries(fractions).map(([name, fraction]) => [
      name,
      rounded(fraction * LANDING_SCORE_WEIGHTS[name as keyof typeof LANDING_SCORE_WEIGHTS]),
    ]),
  ) as LandingScoreComponents;
  return {
    total: rounded(Math.max(0, Math.min(100, Object.values(components).reduce((a, b) => a + b, 0)))),
    components,
  };
}
