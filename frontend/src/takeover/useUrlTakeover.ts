/*
 * Deep-link takeover: the browser wiring (the pure decisions live in urlTakeover.ts).
 *
 * On mount, once, parse `?takeover=<hex>` from location.search. If present, wait for the live
 * feed poller to surface that contact and — the moment it appears AND passes checkEligibility —
 * perform the EXACT take-control sequence the ContactList button runs (select → setOrigin with a
 * frozen snapshot → fire "TAKE_CONTROLS"). We do not fork the takeover path; we drive the same
 * store actions.
 *
 * If the hex never appears within TAKEOVER_TIMEOUT_MS, or is present but ineligible when the
 * window closes, we fall back to BROWSE (no takeover) with the contact selected if it is present,
 * and surface an honest LORAN-style message naming why. We NEVER synthesize the contact to force
 * a takeover (honesty rule #1) — only the player SIM is synthesized, and only via this real path.
 *
 * Fired ONCE: a `done` latch guards against the store-subscription re-entering during our own
 * select/setOrigin/fire, and against later polls. After handling (either a takeover or a
 * fallback), we clear the `takeover` param via history.replaceState so a manual reload does not
 * silently re-take-over — the hex is already captured in a closure, so clearing the URL cannot
 * disrupt an in-flight decision.
 */
import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { checkEligibility } from "./eligibility";
import {
  parseTakeoverHex,
  evaluateTakeover,
  takeoverFallbackMessage,
} from "./urlTakeover";

/** How long to wait for the target hex to appear on the feed before giving up. A couple of
 *  poll cycles (5 s cadence) plus slack — a real contact usually lands within one or two. */
export const TAKEOVER_TIMEOUT_MS = 18000;

/** Strip only the `takeover` param, preserving everything else in the URL, then replace history
 *  so Back/reload will not re-trigger. Kept tiny and defensive so a stubbed history in a
 *  non-browser context is a no-op rather than a throw. */
function clearTakeoverParam(): void {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("takeover")) return;
  url.searchParams.delete("takeover");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

export function useUrlTakeover(): string | null {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const hex = parseTakeoverHex(window.location.search);
    if (hex === null) return;

    let done = false;

    // Terminal fallback: the wait window closed without a takeover. Report why, and select the
    // contact if it is on the feed so the player lands in BROWSE looking at it (never synthesized).
    const timer = window.setTimeout(() => {
      if (done) return;
      done = true;
      unsubscribe();
      const st = useStore.getState();
      const contact = st.contacts.get(hex);
      setMessage(takeoverFallbackMessage(hex, contact, checkEligibility(contact)));
      if (contact) st.select(hex);
      clearTakeoverParam();
    }, TAKEOVER_TIMEOUT_MS);

    const attempt = () => {
      if (done) return;
      const st = useStore.getState();
      // Only auto-take from a fresh BROWSE session; if the user already started flying or
      // otherwise moved on, do not hijack the app out from under them.
      if (st.mode !== "BROWSE") return;
      const contact = st.contacts.get(hex);
      const step = evaluateTakeover(contact, checkEligibility(contact));
      if (step.status !== "take") return; // absent / ineligible → keep waiting until timeout

      // Set the latch BEFORE mutating the store: setOrigin/fire below re-enter this listener
      // synchronously, and without the latch that would double-fire TAKE_CONTROLS.
      done = true;
      window.clearTimeout(timer);
      unsubscribe();
      // The SAME sequence as ContactList's TAKE CONTROLS button. Freeze the snapshot now: the
      // next applyFetch nulls selectedHex the instant the contact leaves the feed, and the origin
      // must survive that (spec §4).
      st.select(step.contact.hex);
      st.setOrigin({ hex: step.contact.hex, snapshot: { ...step.contact } });
      st.fire("TAKE_CONTROLS");
      clearTakeoverParam();
    };

    // Re-check on every store update (each poll's applyFetch is one). unsubscribe is hoisted so
    // both the timeout and attempt can detach the listener when they reach a terminal state.
    const unsubscribe = useStore.subscribe(attempt);
    attempt(); // the target may already be on the feed at mount

    return () => {
      done = true;
      window.clearTimeout(timer);
      unsubscribe();
    };
    // Mount-only: parse and arm exactly once. The `done` latch + unsubscribe guarantee single-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return message;
}
