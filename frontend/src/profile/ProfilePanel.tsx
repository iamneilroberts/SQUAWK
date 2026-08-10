import { useEffect, useState, type FormEvent } from "react";

import {
  loadCurrentProfile,
  signOut,
  updateCurrentProfile,
  type SessionProfile,
} from "../auth/session";
import ProfileResults from "./ProfileResults";

export default function ProfilePanel({
  profile,
  onProfile,
  onSignedOut,
}: {
  profile: SessionProfile;
  onProfile: (profile: SessionProfile) => void;
  onSignedOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState(profile.handle);
  const [lat, setLat] = useState(String(profile.center.lat));
  const [lon, setLon] = useState(String(profile.center.lon));
  const [assist, setAssist] = useState<SessionProfile["defaultAssist"]>(
    profile.defaultAssist === "high" ? "medium" : profile.defaultAssist,
  );
  const [coaching, setCoaching] = useState(profile.coachingEnabled);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setHandle(profile.handle);
    setLat(String(profile.center.lat));
    setLon(String(profile.center.lon));
    setAssist(profile.defaultAssist === "high" ? "medium" : profile.defaultAssist);
    setCoaching(profile.coachingEnabled);
  }, [profile]);

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFailed(false);
    try {
      const updated = await updateCurrentProfile({
        handle,
        center: { lat: Number(lat), lon: Number(lon) },
        defaultAssist: assist,
        coachingEnabled: coaching,
      });
      onProfile(updated);
      setLat(String(updated.center.lat));
      setLon(String(updated.center.lon));
      setOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function logout(): Promise<void> {
    setBusy(true);
    try {
      await signOut();
      onSignedOut();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  function toggleOpen(): void {
    const next = !open;
    setOpen(next);
    if (!next) return;
    setFailed(false);
    void loadCurrentProfile()
      .then((current) => {
        if (current !== null) onProfile(current);
      })
      .catch(() => setFailed(true));
  }

  return (
    <div className="profile-control">
      <button className="status-chip-button" onClick={toggleOpen} aria-expanded={open}>
        {profile.handle}
      </button>
      {open && (
        <form className="panel profile-panel" onSubmit={(event) => void save(event)}>
          <div className="label">PROFILE</div>
          <label className="label" htmlFor="profile-handle">HANDLE</label>
          <input
            id="profile-handle"
            className="auth-input"
            minLength={3}
            maxLength={32}
            pattern="[A-Za-z][A-Za-z0-9_-]{2,31}"
            required
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
          />
          <div className="profile-center-row">
            <label className="label">LAT
              <input className="auth-input" type="number" step="any" required value={lat} onChange={(event) => setLat(event.target.value)} />
            </label>
            <label className="label">LON
              <input className="auth-input" type="number" step="any" required value={lon} onChange={(event) => setLon(event.target.value)} />
            </label>
          </div>
          <label className="label" htmlFor="profile-assist">DEFAULT ASSIST</label>
          <select
            id="profile-assist"
            className="auth-input"
            value={assist}
            onChange={(event) => setAssist(event.target.value as SessionProfile["defaultAssist"])}
          >
            <option value="none">OFF</option>
            <option value="low">NAV</option>
            <option value="medium">FULL</option>
          </select>
          <label className="profile-checkbox label">
            <input type="checkbox" checked={coaching} onChange={(event) => setCoaching(event.target.checked)} />
            COACHING ENABLED
          </label>
          <div className="handoff-row">
            <span className="label">TUTORIAL</span>
            <span className="handoff-value">{profile.tutorialState.toUpperCase()}</span>
          </div>
          <ProfileResults history={profile.history} statistics={profile.classStatistics} />
          {failed && <div className="auth-error label">PROFILE UPDATE FAILED.</div>}
          <button className="control-button w-full" type="submit" disabled={busy}>SAVE PROFILE</button>
          <button className="auth-secondary w-full" type="button" disabled={busy} onClick={() => void logout()}>SIGN OUT</button>
        </form>
      )}
    </div>
  );
}
