/* Chrome only (spec D-5). Same rule as WeatherPanel — see the comment there. */
import { NO_FEED } from "./WeatherPanel";

export default function AtcPanel() {
  return (
    <div className="dash-empty">
      <div className="dash-empty-state">{NO_FEED}</div>
      <div className="dash-empty-note">
        PLANNED: LIVE ATC TRANSCRIPT WITH CALLSIGN CORRELATION
      </div>
    </div>
  );
}
