/*
 * Chrome only (spec D-5). This panel exists so the cockpit has the shape it will eventually
 * have, and it says so in as many words. There is no sample METAR, no sample radar image, no
 * placeholder number, and a test asserts the rendered text contains no digits at all — because
 * the cheapest way to accidentally ship fake data is to make a screen "look finished".
 */
export const NO_FEED = "NO FEED · FUTURE INTEGRATION";

export default function WeatherPanel() {
  return (
    <div className="dash-empty">
      <div className="dash-empty-state">{NO_FEED}</div>
      <div className="dash-empty-note">PLANNED: WEATHER RADAR MOSAIC, SHARED WITH LORAN</div>
    </div>
  );
}
