export type TutorialLesson = {
  id: string;
  title: string;
  body: string;
  triggerAirtimeS: number;
};

export const LIVE_COACHING_LESSONS: readonly TutorialLesson[] = [
  {
    id: "live-hold",
    title: "Stabilize the approach",
    body: "Use small corrections. Keep the assigned runway centered and follow the glide gates.",
    triggerAirtimeS: 3,
  },
  {
    id: "live-configure",
    title: "Configure before the threshold",
    body: "Confirm landing flap, gear, and a speed inside the class landing envelope.",
    triggerAirtimeS: 25,
  },
  {
    id: "live-flare",
    title: "Finish the landing",
    body: "Reduce power and flare at the marked height. Hold centerline through rollout.",
    triggerAirtimeS: 70,
  },
];

/** Pure progression shared by pausing tutorials and optional non-pausing live coaching. */
export function nextLesson(
  lessons: readonly TutorialLesson[],
  seen: ReadonlySet<string>,
  airtimeS: number,
  enabled = true,
): TutorialLesson | null {
  if (!enabled) return null;
  return lessons.find((lesson) => !seen.has(lesson.id) && airtimeS >= lesson.triggerAirtimeS) ?? null;
}
