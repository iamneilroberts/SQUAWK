/*
 * Pure helpers for the WHAT'S NEW browse-screen entry point: formatting a changelog release
 * date for display, and deciding whether the newest release is unseen against the last-seen
 * date recorded in localStorage. Kept dependency-free (no Date object, no storage access) so
 * both are trivially unit-testable; App.tsx does the actual localStorage read/write, guarded
 * in try/catch like the app's other localStorage use (tutorialProgress, spawn mode).
 */

export const WHATS_NEW_SEEN_KEY = "squawk:whatsNewSeen";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "2026-08-18" -> "18 AUG 2026" (whatsNew.ts dates are always ISO YYYY-MM-DD). */
export function formatReleaseDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  const monthName = MONTHS[Number(month) - 1] ?? month;
  return `${day} ${monthName} ${year}`;
}

/**
 * True when the newest release postdates what's recorded as last-seen, or nothing has been
 * seen yet. ISO (YYYY-MM-DD) dates compare correctly as plain strings.
 */
export function isUnseen(newestDate: string, seenDate: string | null): boolean {
  return seenDate === null || newestDate > seenDate;
}
