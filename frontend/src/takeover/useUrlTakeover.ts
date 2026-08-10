/* Browser wiring for the legacy ?takeover=<hex> briefing deep link. */
import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { evaluateTakeover, parseTakeoverHex, takeoverFallbackMessage } from "./urlTakeover";

export const TAKEOVER_TIMEOUT_MS = 18000;

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

    const timer = window.setTimeout(() => {
      if (done) return;
      done = true;
      unsubscribe();
      const state = useStore.getState();
      const contact = state.contacts.get(hex);
      setMessage(takeoverFallbackMessage(hex, contact));
      if (contact) state.select(hex);
      clearTakeoverParam();
    }, TAKEOVER_TIMEOUT_MS);

    const attempt = () => {
      if (done) return;
      const state = useStore.getState();
      if (state.mode !== "BROWSE") return;
      const step = evaluateTakeover(state.contacts.get(hex));
      if (step.status !== "select") return;

      done = true;
      window.clearTimeout(timer);
      unsubscribe();
      state.select(step.contact.hex);
      clearTakeoverParam();
    };

    const unsubscribe = useStore.subscribe(attempt);
    attempt();

    return () => {
      done = true;
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  return message;
}
