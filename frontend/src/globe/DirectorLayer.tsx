/*
 * The approach flight director (#22): a translucent GREEN lead aircraft that used to fly the
 * correct glide slope a fixed distance ahead of the player, as a fly-through guide.
 *
 * REMOVED (owner decision 2026-08-15): the lead-aircraft guide didn't read from the cockpit any
 * better than the flat corridor surface it flew alongside. The corridor is now edge RAILS +
 * GATES (see ApproachAssistLayer.tsx); this component is a deliberate no-op — still mounted in
 * FlightSession.tsx, renders nothing — so re-enabling it later is a one-line revert if wanted.
 *
 * It was never the "ghost" (globe/ghost.ts) — that's the genuine ADS-B aircraft the player takes
 * over from, dimmed cyan, real live-feed data. That is untouched by this change.
 *
 * The pure geometry this used to drive (positionAlongApproach, directorDistanceNm) is still
 * exported from guidanceGeometry.ts and still tested there; only the rendering here is gone.
 */
import type { LockedMissionView } from "../mission/contract";
import type { AssistMode } from "../mission/assists";

export default function DirectorLayer(_props: {
  mission: LockedMissionView;
  assist: AssistMode;
  instantFlight: boolean;
}) {
  return null;
}
