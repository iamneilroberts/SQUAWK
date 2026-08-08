/*
 * Feed snapshot -> initial sim state. Pure: no Cesium, no clock, no store.
 *
 * Honesty rule for this file (spec §4): clamping a synthetic aircraft into its own flight
 * envelope is legal, doing it silently is not. Every value this function changes goes into
 * `adjustments[]` with the before, the after and the reason, and the handoff card prints
 * that list verbatim.
 *
 * Task 2 review carried a binding note: computeForces reads density from state.altitudeM,
 * so a hand-built state has a silent one-step error unless finalized. The derived readouts
 * below (tasMs/iasMs/aoaRad/sideslipRad/verticalSpeedMs/loadFactor/gLimited/stalled) are
 * therefore placeholders — the state this function returns is the output of `refreshDerived`,
 * not the hand-set object.
 */
import type { Contact } from "../data/types";
import type { ClassParams, ControlVector, SimState } from "../sim/types";
import { dragCoefficient, liftCoefficient, POWER_LAPSE_MODELS, stallSpeedIasMs } from "../sim/forces";
import { iasToTas, isaDensity, speedOfSoundMs, tasToIas } from "../sim/isa";
import { geodeticSurfaceNormal, geodeticToEcef } from "../sim/geo";
import { qRotate, quatFromHpr } from "../sim/quat";
import { degToRad, fpmToMs, ftToM, ktToMs, msToKt, mToFt } from "../sim/units";
import { vDot } from "../sim/vec3";
import { refreshDerived } from "../sim/aircraft";

const G0 = 9.80665;
/** Minimum clearance when a pressure altitude has to be clamped onto real terrain. */
const BARO_CLEARANCE_M = 300;

export type SpawnAdjustment = { field: string; from: string; to: string; reason: string };

export type SpawnResult = {
  state: SimState;
  /** The control positions the player inherits — trimmed and powered for the snapshot. */
  controls: ControlVector;
  adjustments: SpawnAdjustment[];
  altitudeSource: "alt_geom" | "alt_baro";
};

export function buildSpawnState(
  contact: Contact,
  params: ClassParams,
  opts: { terrainHeightM: number | null },
): SpawnResult {
  const adjustments: SpawnAdjustment[] = [];

  // ---- altitude: alt_geom is ellipsoidal, the same datum as the terrain (G-003) ----
  const altGeomM = contact.alt_geom === null ? null : ftToM(contact.alt_geom);
  const altBaroFt = typeof contact.alt_baro === "number" ? contact.alt_baro : null;
  const altitudeSource: "alt_geom" | "alt_baro" = altGeomM !== null ? "alt_geom" : "alt_baro";
  let altitudeM = altGeomM ?? (altBaroFt === null ? 0 : ftToM(altBaroFt));

  if (altitudeSource === "alt_baro") {
    if (opts.terrainHeightM === null) {
      adjustments.push({
        field: "ALTITUDE",
        from: `${Math.round(mToFt(altitudeM))} FT PRESSURE`,
        to: `${Math.round(mToFt(altitudeM))} FT ASSUMED`,
        reason: "No alt_geom in the feed and terrain height unknown — pressure altitude used as-is.",
      });
    } else {
      const floor = opts.terrainHeightM + BARO_CLEARANCE_M;
      if (altitudeM < floor) {
        adjustments.push({
          field: "ALTITUDE",
          from: `${Math.round(mToFt(altitudeM))} FT PRESSURE`,
          to: `${Math.round(mToFt(floor))} FT`,
          reason: `Feed had only pressure altitude; raised to terrain + ${BARO_CLEARANCE_M} m so the spawn is not underground.`,
        });
        altitudeM = floor;
      } else {
        adjustments.push({
          field: "ALTITUDE",
          from: `${Math.round(mToFt(altitudeM))} FT PRESSURE`,
          to: `${Math.round(mToFt(altitudeM))} FT`,
          reason: "No alt_geom in the feed — pressure altitude used, already clear of terrain.",
        });
      }
    }
  }

  if (altitudeM > params.limits.serviceCeilingM) {
    adjustments.push({
      field: "ALTITUDE",
      from: `${Math.round(mToFt(altitudeM))} FT`,
      to: `${Math.round(mToFt(params.limits.serviceCeilingM))} FT`,
      reason: `Above the ${params.label} service ceiling.`,
    });
    altitudeM = params.limits.serviceCeilingM;
  }

  // ---- speed: ground speed approximates TAS (still air, v1 scope) ----
  const snapshotKt = contact.gs ?? 0;
  let tasMs = ktToMs(snapshotKt);
  const vsMin = 1.3 * stallSpeedIasMs(params, 0);
  const vneMax = 0.9 * params.limits.vneIasMs;
  const iasMs = tasToIas(tasMs, altitudeM);
  if (iasMs < vsMin) {
    tasMs = iasToTas(vsMin, altitudeM);
    adjustments.push({
      field: "SPEED",
      from: `${Math.round(snapshotKt)} KT`,
      to: `${Math.round(msToKt(tasMs))} KT`,
      reason: `Below 1.3 x stall speed for the ${params.label} — raised to avoid spawning stalled.`,
    });
  } else if (iasMs > vneMax) {
    tasMs = iasToTas(vneMax, altitudeM);
    adjustments.push({
      field: "SPEED",
      from: `${Math.round(snapshotKt)} KT`,
      to: `${Math.round(msToKt(tasMs))} KT`,
      reason: `Above 0.9 x Vne for the ${params.label} — lowered into the envelope.`,
    });
  }

  // Vne is an IAS limit and is toothless at altitude (low density -> low IAS for a high TAS),
  // so a fast contact spawning high can clear the check above yet still sit past Mmo. Clamp
  // TAS to the class's Mmo at this altitude too, or the HUD's MMO annunciator trips the instant
  // the "trimmed" handoff card hands over control.
  const mmoTasMax = params.limits.mmo * speedOfSoundMs(altitudeM);
  if (tasMs > mmoTasMax) {
    adjustments.push({
      field: "SPEED",
      from: `${Math.round(msToKt(tasMs))} KT`,
      to: `${Math.round(msToKt(mmoTasMax))} KT`,
      reason: `Above Mmo (M${params.limits.mmo.toFixed(2)}) for the ${params.label} — lowered into the envelope.`,
    });
    tasMs = mmoTasMax;
  }

  // ---- attitude: flight path from the vertical rate, body pitched by the trimmed AoA ----
  const latRad = degToRad(contact.lat);
  const lonRad = degToRad(contact.lon);
  const position = geodeticToEcef(latRad, lonRad, altitudeM);
  const headingRad = degToRad(contact.track ?? 0);
  if (contact.baro_rate === null) {
    adjustments.push({
      field: "VERTICAL RATE",
      from: "—",
      to: "ASSUMED LEVEL",
      reason: "No baro_rate in the feed.",
    });
  }
  const verticalSpeedMs = contact.baro_rate === null ? 0 : fpmToMs(contact.baro_rate);
  const fpaRad =
    tasMs > 0.1 ? Math.asin(Math.min(1, Math.max(-1, verticalSpeedMs / tasMs))) : 0;

  // AoA that makes lift equal weight at this speed and density — spawn trimmed, not lurching.
  const rho = isaDensity(altitudeM);
  const qBar = 0.5 * rho * tasMs * tasMs;
  const clNeeded = qBar > 0 ? (params.massKg * G0) / (qBar * params.wingAreaM2) : 0;
  const flap = params.flaps[0];
  const alphaTrimRad = Math.min(
    params.aero.stallAlphaRad,
    (clNeeded - (params.aero.cl0 + flap.dCL0)) / params.aero.clAlphaPerRad,
  );

  const flightPath = quatFromHpr(position, headingRad, fpaRad, 0);
  const attitude = quatFromHpr(position, headingRad, fpaRad + alphaTrimRad, 0);
  const velocity = qRotate(flightPath, { x: tasMs, y: 0, z: 0 });

  // ---- controls: the throttle that holds this speed, and the trim that holds this AoA ----
  const cl = liftCoefficient(alphaTrimRad, params, flap);
  const dragN = dragCoefficient(cl, params, flap) * qBar * params.wingAreaM2;
  const thrustCapacityN =
    (params.propulsion.propEfficiency * params.propulsion.maxPowerW *
      POWER_LAPSE_MODELS[params.propulsion.lapseModel](altitudeM)) /
    Math.max(tasMs, params.propulsion.propPeakSpeedMs);
  const throttle = thrustCapacityN > 0 ? Math.min(1, Math.max(0, dragN / thrustCapacityN)) : 0;
  const trim = Math.min(
    1,
    Math.max(
      -1,
      (alphaTrimRad - params.control.trimAlphaCenterRad) / params.control.trimAlphaRangeRad,
    ),
  );
  const controls: ControlVector = { pitch: 0, roll: 0, yaw: 0, throttle, flapDetent: 0, trim, gearDown: false, afterburner: false };

  // Placeholder derived readouts — refreshDerived below is the source of truth for these
  // (carried review note: computeForces reads density from state.altitudeM, so a hand-built
  // state has a silent one-step error unless finalized through it).
  const provisional: SimState = {
    position,
    velocity,
    attitude,
    rates: { x: 0, y: 0, z: 0 },
    timeS: 0,
    altitudeM,
    tasMs,
    iasMs: tasToIas(tasMs, altitudeM),
    aoaRad: alphaTrimRad,
    sideslipRad: 0,
    verticalSpeedMs: vDot(velocity, geodeticSurfaceNormal(position)),
    loadFactor: 1,
    gLimited: false,
    stalled: false,
    machNumber: 0,
    gearPosition: 0,
  };

  const state = refreshDerived(provisional, controls, params);

  return {
    state,
    controls,
    adjustments,
    altitudeSource,
  };
}
