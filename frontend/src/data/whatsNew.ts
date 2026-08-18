/*
 * CONVENTION: when a MAJOR feature ships, prepend an entry here (major features / new
 * capabilities only — NOT minor fixes). Keep newest first.
 */

export type WhatsNewRelease = { date: string; label?: string; items: string[] };

export const WHATS_NEW: WhatsNewRelease[] = [
  { date: "2026-08-18", items: [
    "Weather radar overlay — live precipitation draped on the globe and the tactical map, with one WX toggle",
    "Take controls of another aircraft mid-flight — click any contact, then TAKE CONTROLS to fly it",
    "Desktop cockpit polish — mouse-operable control strip, a single throttle lever, and a decluttered HUD" ] },
  { date: "2026-08-16", items: [
    "Live ships — AIS vessel traffic on the globe where coverage exists",
    "Auto-coordinated turns — automatic rudder keeps the turn balanced" ] },
  { date: "2026-08-12", items: [
    "Desktop mouse flying — flight stick, wheel throttle, and right-drag look-around",
    "Time compression — speed the cruise to 2x/4x, or skip straight to the approach",
    "Tactical map overhaul — line basemap with coastlines, plus a big centered location view" ] },
  { date: "2026-08-10", items: [
    "More aircraft — airliner, fighter, business jet, turboprop, trainer, and helicopter classes",
    "Landing guidance — an approach corridor, a flight-director lead aircraft, and turn-to-final cues" ] },
  { date: "2026-08-08", items: [
    "RE-SYNC to the live aircraft position, a player-chosen callsign, and a 4-way spawn chooser",
    "Tap another aircraft in flight to see its live details" ] },
  { date: "2026-08-06", label: "First flyable", items: [
    "Full 6-DOF flight — take off, fly first-person over real terrain, and land it" ] },
  { date: "2026-08-05", label: "Launch", items: [
    "Live ADS-B browse globe — pick a real aircraft and take the controls" ] },
];
