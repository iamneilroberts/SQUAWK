import { useEffect, useRef, useState, type FormEvent } from "react";

import { requestMagicLink } from "./session";

type TurnstileApi = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      theme: "dark";
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ): string;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptRequest: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile !== undefined) return Promise.resolve(window.turnstile);
  if (scriptRequest !== null) return scriptRequest;
  scriptRequest = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.turnstile === undefined) reject(new Error("Challenge unavailable"));
      else resolve(window.turnstile);
    };
    script.onerror = () => reject(new Error("Challenge unavailable"));
    document.head.append(script);
  });
  return scriptRequest;
}

export default function SignInSheet({
  siteKey,
  onClose,
}: {
  siteKey: string | null;
  onClose: () => void;
}) {
  const challengeHost = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState("");
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [state, setState] = useState<"ready" | "sending" | "sent" | "error">("ready");

  useEffect(() => {
    if (siteKey === null || challengeHost.current === null) return;
    let active = true;
    let widgetId: string | null = null;
    void loadTurnstile()
      .then((turnstile) => {
        if (!active || challengeHost.current === null) return;
        widgetId = turnstile.render(challengeHost.current, {
          sitekey: siteKey,
          action: "magic-link",
          theme: "dark",
          callback: setChallengeToken,
          "expired-callback": () => setChallengeToken(null),
          "error-callback": () => setChallengeToken(null),
        });
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
      if (widgetId !== null && window.turnstile !== undefined) {
        window.turnstile.remove(widgetId);
      }
    };
  }, [siteKey]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (challengeToken === null || state === "sending") return;
    setState("sending");
    try {
      await requestMagicLink(email, challengeToken);
      setState("sent");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="auth-sheet-backdrop" role="presentation">
      <section className="panel auth-sheet" aria-label="Sign in">
        <div className="auth-sheet-heading">
          <span className="label">SECURE HANDOFF</span>
          <button className="auth-close" onClick={onClose} aria-label="Close sign in">×</button>
        </div>
        {state === "sent" ? (
          <p className="auth-copy" role="status">
            IF THE ADDRESS CAN SIGN IN, A LINK WILL ARRIVE SHORTLY.
          </p>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <p className="auth-copy">EMAIL A ONE-USE LINK TO CONTINUE THIS BRIEFING.</p>
            <label className="label" htmlFor="auth-email">EMAIL</label>
            <input
              id="auth-email"
              className="auth-input"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <div ref={challengeHost} className="auth-challenge" />
            {siteKey === null && (
              <p className="auth-error label">SIGN-IN CHALLENGE IS NOT CONFIGURED.</p>
            )}
            {state === "error" && (
              <p className="auth-error label">SIGN-IN IS TEMPORARILY UNAVAILABLE.</p>
            )}
            <button
              className="control-button w-full"
              type="submit"
              disabled={challengeToken === null || state === "sending"}
            >
              {state === "sending" ? "SENDING…" : "SEND SIGN-IN LINK"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
