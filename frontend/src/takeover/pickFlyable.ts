/*
 * The default-flight auto-pick: the nearest flyable live aircraft to a point (spec — one-click
 * start). Pure and shared with the same `checkEligibility` gate the TAKE CONTROLS button uses, so
 * "flyable" means exactly one thing across the app. The caller passes the current (aged) contacts.
 */
import type { Contact } from "../data/types";
import { rangeNm } from "../dashboard/geoRange";
import { checkEligibility } from "./eligibility";

export function nearestFlyableContact(
  contacts: Contact[],
  centerLatDeg: number,
  centerLonDeg: number,
): Contact | null {
  let best: Contact | null = null;
  let bestRangeNm = Infinity;
  for (const contact of contacts) {
    if (!checkEligibility(contact).eligible) continue;
    const r = rangeNm(centerLatDeg, centerLonDeg, contact.lat, contact.lon);
    if (r < bestRangeNm) {
      bestRangeNm = r;
      best = contact;
    }
  }
  return best;
}
