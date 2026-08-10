import { useEffect, useState } from "react";

import {
  consumeAuthToken,
  loadCurrentProfile,
  type SessionProfile,
} from "./session";

export default function AuthReturn({
  token,
  onAuthenticated,
  onFailure,
}: {
  token: string | null;
  onAuthenticated: (profile: SessionProfile) => void;
  onFailure: () => void;
}) {
  const [working, setWorking] = useState(token !== null);

  useEffect(() => {
    if (token === null) return;
    let active = true;
    void consumeAuthToken(token)
      .then(() => active ? loadCurrentProfile() : null)
      .then((profile) => {
        if (!active) return;
        setWorking(false);
        if (profile === null) onFailure();
        else onAuthenticated(profile);
      })
      .catch(() => {
        if (!active) return;
        setWorking(false);
        onFailure();
      });
    return () => {
      active = false;
    };
  }, [onAuthenticated, onFailure, token]);

  return working ? (
    <div className="auth-notice label" role="status">VERIFYING SIGN-IN LINK…</div>
  ) : null;
}
