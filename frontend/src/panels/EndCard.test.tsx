import { describe, it, expect } from "vitest";
import EndCard from "./EndCard";
import type { FlightStats } from "../game/stats";
import { ktToMs, ftToM } from "../sim/units";
import type { DebriefSubmission } from "../debrief/types";

function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const c of node) collectText(c, out); return out; }
  const type = (node as { type?: unknown }).type;
  const props = (node as { props?: unknown }).props;
  // Local function components (Row) must be invoked or their text is invisible here.
  if (typeof type === "function") return collectText((type as (p: unknown) => unknown)(props), out);
  const withChildren = props as { children?: unknown } | undefined;
  if (withChildren && "children" in withChildren) collectText(withChildren.children, out);
  return out;
}

const stats = (o: Partial<FlightStats> = {}): FlightStats => ({
  airtimeS: 185,
  distanceM: 12_500,
  maxIasMs: ktToMs(141),
  maxAltitudeM: ftToM(5200),
  maxG: 2.4,
  impactSinkFpm: 940,
  impactIasMs: ktToMs(72),
  classification: "CRASHED",
  ...o,
});

const versions = {
  airportDataset: "oa-test-v1",
  aircraftProfile: "c172-v1",
  missionProfile: "c172-mission-v1",
  assignment: "assignment-v1",
  scoring: "scoring-v1",
  physics: "physics-v1",
  assistDefinition: "assist-v1",
};

const accepted: DebriefSubmission = {
  status: "accepted",
  result: {
    schemaVersion: 2,
    missionId: "33333333-3333-4333-8333-333333333333",
    outcome: "landed",
    failure: null,
    score: 91.25,
    components: {
      verticalSpeed: 24,
      centerline: 18,
      touchdownZone: 17,
      alignment: 14,
      speed: 9,
      bank: 4.5,
      rollout: 4.75,
    },
    measurements: null,
    highestAssist: "NAV",
    evidenceStatus: "verified",
    ranked: true,
    classId: "c172s",
    versions,
    completedAt: 1_700_000_000_000,
  },
};

const render = (
  s: FlightStats,
  submission: DebriefSubmission = accepted,
) => collectText(EndCard({
  stats: s,
  submission,
  onRetry: () => {},
  onExit: () => {},
})).join(" ");

describe("EndCard", () => {
  it("leads with the classification", () => {
    expect(render(stats({ classification: "CRASHED" }))).toContain("CRASHED");
    expect(render(stats({ classification: "LANDED" }))).toContain("LANDED");
  });
  it("shows every stat the spec asks for", () => {
    const text = render(stats());
    expect(text).toContain("03:05"); // airtime
    expect(text).toContain("141"); // max IAS
    expect(text).toContain("5200"); // max altitude
    expect(text).toContain("+2.4"); // max g
    expect(text).toContain("940"); // impact sink
    expect(text).toContain("72"); // impact speed
  });
  it("shows distance flown in nautical miles", () => {
    const text = render(stats({ distanceM: 18_520 })); // exactly 10 nm
    expect(text).toContain("10.0");
    expect(text).toContain("NM");
  });
  it("offers the way back to BROWSE", () => {
    expect(render(stats())).toContain("EXIT TO BROWSE");
  });
  it("shows the authoritative score, rank eligibility, partition, and all seven components", () => {
    const text = render(stats({ classification: "LANDED" }));
    expect(text).toContain("AUTHORITATIVE");
    expect(text).toContain("91.25");
    expect(text).toContain("RANK ELIGIBLE");
    expect(text).toContain("C172S");
    expect(text).toContain("NAV");
    for (const label of [
      "VERTICAL SPEED",
      "CENTERLINE",
      "TOUCHDOWN ZONE",
      "ALIGNMENT",
      "SPEED",
      "BANK",
      "ROLLOUT",
    ]) expect(text).toContain(label);
  });
  it("shows every frozen version without substituting client preview authority", () => {
    const text = render(stats());
    for (const version of Object.values(versions)) expect(text).toContain(version);
  });
  it("names a stable safety failure and refuses a score or ranking", () => {
    const failed: DebriefSubmission = {
      status: "accepted",
      result: {
        ...accepted.result,
        outcome: "crashed",
        failure: "SINK_RATE_EXCEEDED",
        score: null,
        components: null,
        ranked: false,
      },
    };
    const text = render(stats(), failed);
    expect(text).toContain("SINK_RATE_EXCEEDED");
    expect(text).toContain("NOT RANKED");
    expect(text).not.toContain("91.25");
  });
  it("keeps a failed submission honest and offers an in-session retry", () => {
    const text = render(stats(), {
      status: "failed",
      preview: {
        classId: "c172s",
        versions,
        highestAssist: "OFF",
        evaluation: {
          outcome: "landed",
          failure: null,
          measurements: null as never,
          score: { total: 88, components: accepted.result.components! },
        },
      },
      message: "RESULT SUBMISSION FAILED",
      retryable: true,
    });
    expect(text).toContain("RESULT SUBMISSION FAILED");
    expect(text).toContain("PREVIEW — NOT AUTHORITATIVE");
    expect(text).toContain("NOT RANKED");
    expect(text).toContain("RETRY RESULT");
  });
  it("labels a durable offline result as queued and still non-authoritative", () => {
    const preview = {
      classId: "c172s" as const,
      versions,
      highestAssist: "OFF" as const,
      evaluation: {
        outcome: "landed" as const,
        failure: null,
        measurements: null as never,
        score: { total: 88, components: accepted.result.components! },
      },
    };
    const text = render(stats(), { status: "queued", preview, message: "RESULT SAVED FOR RETRY" });
    expect(text).toContain("QUEUED / NOT AUTHORITATIVE");
    expect(text).toContain("RESULT SAVED FOR RETRY");
    expect(text).toContain("NOT RANKED");
  });
  it("labels tutorial grading as local and unranked", () => {
    const text = render(stats(), {
      status: "tutorial",
      preview: {
        classId: "f5e",
        versions,
        highestAssist: "FULL",
        evaluation: {
          outcome: "landed",
          failure: null,
          measurements: null as never,
          score: { total: 90, components: accepted.result.components! },
        },
      },
    });
    expect(text).toContain("TUTORIAL — LOCAL AND UNRANKED");
    expect(text).toContain("NOT RANKED");
    expect(text).not.toContain("AUTHORITATIVE — WORKER VERIFIED");
  });
  it("scores an instant flight locally, keeps it unranked, and offers SIGN IN TO RANK", () => {
    const submission: DebriefSubmission = {
      status: "instant",
      preview: {
        classId: "b738",
        versions,
        highestAssist: "OFF",
        evaluation: {
          outcome: "landed",
          failure: null,
          measurements: null as never,
          score: { total: 84, components: accepted.result.components! },
        },
      },
    };
    const text = collectText(EndCard({
      stats: stats({ classification: "LANDED" }),
      submission,
      onRetry: () => {},
      onExit: () => {},
      onSignIn: () => {},
    })).join(" ");
    expect(text).toContain("INSTANT FLIGHT — LOCAL AND UNRANKED");
    expect(text).toContain("84"); // local preview score is shown
    expect(text).toContain("NOT RANKED");
    expect(text).toContain("SIGN IN TO RANK THIS FLIGHT");
    expect(text).not.toContain("AUTHORITATIVE — WORKER VERIFIED");
  });
  it("omits the SIGN IN TO RANK action when no sign-in handler is provided", () => {
    const submission: DebriefSubmission = {
      status: "instant",
      preview: {
        classId: "b738",
        versions,
        highestAssist: "OFF",
        evaluation: {
          outcome: "landed",
          failure: null,
          measurements: null as never,
          score: { total: 84, components: accepted.result.components! },
        },
      },
    };
    const text = render(stats(), submission);
    expect(text).not.toContain("SIGN IN TO RANK");
  });
  it("does not invent a debrief when landing evidence is unavailable", () => {
    const text = render(stats(), {
      status: "unavailable",
      message: "LANDING EVIDENCE WAS NOT CAPTURED",
    });
    expect(text).toContain("LANDING EVIDENCE WAS NOT CAPTURED");
    expect(text).toContain("NOT RANKED");
    expect(text).not.toContain("AUTHORITATIVE SCORE");
  });
  it("tells the player the site can be orbited", () => {
    expect(render(stats())).toMatch(/ORBIT|DRAG/i);
  });
  it("handles a zero-length flight without NaN", () => {
    const text = render(stats({ airtimeS: 0, distanceM: 0, maxG: 1, impactSinkFpm: 0 }));
    expect(text).not.toContain("NaN");
    expect(text).toContain("00:00");
  });
  it("shows the SIM callsign on the debrief when given, em-dash when absent (UI-002)", () => {
    const withCall = collectText(
      EndCard({
        stats: stats(),
        submission: accepted,
        onRetry: () => {},
        callsign: "SIM-4F2A",
        onExit: () => {},
      }),
    ).join(" ");
    expect(withCall).toContain("CALLSIGN");
    expect(withCall).toContain("SIM-4F2A");
    const without = collectText(
      EndCard({
        stats: stats(),
        submission: accepted,
        onRetry: () => {},
        callsign: null,
        onExit: () => {},
      }),
    ).join(" ");
    expect(without).toContain("CALLSIGN");
    expect(without).not.toContain("SIM-4F2A");
    expect(without).toContain("—");
  });
});
