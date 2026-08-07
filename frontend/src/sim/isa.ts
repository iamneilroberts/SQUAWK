/*
 * ICAO standard atmosphere, troposphere + lower stratosphere. Still air only (no wind, no
 * turbulence, no non-standard temperature) — v1 scope, parent spec §4.
 *
 * IAS here is really equivalent airspeed: IAS = TAS * sqrt(rho/rho0). Below ~250 kt and
 * ~15000 ft the compressibility and position errors that separate EAS/CAS/IAS are inside
 * the ±3 kt band this project asserts, so the single square-root form is honest enough and
 * is documented as such rather than dressed up as a full pitot model.
 */
const P_SL = 101325;
const T_SL = 288.15;
const LAPSE = 0.0065; // K/m
const R_AIR = 287.05287; // J/(kg*K)
const G0 = 9.80665;
/*
 * Derived from the same P_SL/(R_AIR*T_SL) formula isaDensity() uses at h=0, rather than the
 * hand-rounded literal 1.225 — the literal differs from the formula's own sea-level output
 * by ~1.8e-5 kg/m3, which is enough to make tasToIas/iasToTas fail to round-trip exactly at
 * sea level (IAS must equal TAS there). Still reads as 1.225 to 3 decimal places.
 */
export const RHO_SL = P_SL / (R_AIR * T_SL);
const TROPOPAUSE_M = 11000;
const T_TROPOPAUSE = T_SL - LAPSE * TROPOPAUSE_M; // 216.65 K
const P_TROPOPAUSE = P_SL * Math.pow(T_TROPOPAUSE / T_SL, G0 / (LAPSE * R_AIR));

export function isaTemperatureK(altitudeM: number): number {
  if (altitudeM >= TROPOPAUSE_M) return T_TROPOPAUSE;
  return T_SL - LAPSE * altitudeM;
}

export function isaPressurePa(altitudeM: number): number {
  if (altitudeM >= TROPOPAUSE_M) {
    return P_TROPOPAUSE * Math.exp((-G0 * (altitudeM - TROPOPAUSE_M)) / (R_AIR * T_TROPOPAUSE));
  }
  return P_SL * Math.pow(isaTemperatureK(altitudeM) / T_SL, G0 / (LAPSE * R_AIR));
}

export function isaDensity(altitudeM: number): number {
  return isaPressurePa(altitudeM) / (R_AIR * isaTemperatureK(altitudeM));
}

export function tasToIas(tasMs: number, altitudeM: number): number {
  return tasMs * Math.sqrt(isaDensity(altitudeM) / RHO_SL);
}

export function iasToTas(iasMs: number, altitudeM: number): number {
  return iasMs / Math.sqrt(isaDensity(altitudeM) / RHO_SL);
}

/** Ratio of specific heats for dry air. */
export const GAMMA_AIR = 1.4;

/** Local speed of sound, a = sqrt(gamma * R * T), from the ISA temperature at this altitude. */
export function speedOfSoundMs(altitudeM: number): number {
  return Math.sqrt(GAMMA_AIR * R_AIR * isaTemperatureK(altitudeM));
}

/** Mach number = TAS / local speed of sound. */
export function machNumber(tasMs: number, altitudeM: number): number {
  return tasMs / speedOfSoundMs(altitudeM);
}
