import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  loadCurrentProfile,
  requestMagicLink,
  verifyAuthCode,
  type SessionProfile,
} from "./session";

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

type SheetState =
  | "ready"
  | "sending"
  | "sent"
  | "verifying"
  | "code-error"
  | "error"
  | "done";

const CODE_ENTRY_STATES: ReadonlySet<SheetState> = new Set([
  "sent",
  "verifying",
  "code-error",
  "done",
]);

export default function SignInSheet({
  siteKey,
  onClose,
  onAuthenticated,
}: {
  siteKey: string | null;
  onClose: () => void;
  onAuthenticated: (profile: SessionProfile) => void;
}) {
  const challengeHost = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [state, setState] = useState<SheetState>("ready");

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
      setCode("");
      setState("sent");
    } catch {
      setState("error");
    }
  }

  async function verify(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!/^\d{6}$/.test(code) || state === "verifying") return;
    setState("verifying");
    try {
      await verifyAuthCode(email, code);
      const profile = await loadCurrentProfile();
      if (profile === null) {
        setState("error");
        return;
      }
      setState("done");
      onAuthenticated(profile);
      onClose();
    } catch {
      setState("code-error");
    }
  }

  return (
    <div className="auth-sheet-backdrop" role="presentation">
      <section className="panel auth-sheet" aria-label="Sign in">
        <div className="auth-sheet-heading">
          <span className="label">SECURE HANDOFF</span>
          <button className="auth-close" onClick={onClose} aria-label="Close sign in">×</button>
        </div>
        {CODE_ENTRY_STATES.has(state) ? (
          <form onSubmit={(event) => void verify(event)}>
            <p className="auth-copy" role="status">
              ENTER THE 6-DIGIT CODE FROM THE EMAIL.
            </p>
            <label className="label" htmlFor="auth-code">CODE</label>
            <input
              id="auth-code"
              className="auth-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            {state === "code-error" && (
              <p className="auth-error label">CODE INVALID OR EXPIRED.</p>
            )}
            <button
              className="control-button w-full"
              type="submit"
              disabled={!/^\d{6}$/.test(code) || state === "verifying"}
            >
              {state === "verifying" ? "VERIFYING…" : "VERIFY CODE"}
            </button>
          </form>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <p className="auth-copy">EMAIL A ONE-TIME CODE TO CONTINUE THIS BRIEFING.</p>
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
              {state === "sending" ? "SENDING…" : "SEND CODE"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
