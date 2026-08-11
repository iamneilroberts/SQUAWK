import {
  TRAFFIC_PROVIDER_RADIUS_STEP_NM,
  TRAFFIC_REGION_CELL_DEGREES,
} from "../../src/shared/limits";
import type { SystemMode } from "../../src/shared/mode";
import { normalizeRegion } from "../adsb/region";
import type { Env } from "../env";
import type { AdminBroker } from "./mode";

export async function clearTrafficRegion(
  namespace: Env["ADSB_BROKER"],
  input: { latitude: number; longitude: number; radiusNm: number },
  maximumRadiusNm: number,
  forceMode: SystemMode,
  broker: AdminBroker,
) {
  const normalized = resolveTrafficRegion(input, maximumRadiusNm);
  const result = await broker(namespace, {
    type: "cache-clear-region",
    regionKey: normalized.regionKey,
    forceMode,
  });
  if (result.type !== "cache-cleared") throw new TypeError("Unexpected broker response");
  return result;
}

export function resolveTrafficRegion(
  input: { latitude: number; longitude: number; radiusNm: number },
  maximumRadiusNm: number,
) {
  return normalizeRegion(input.latitude, input.longitude, input.radiusNm, {
    cellDegrees: TRAFFIC_REGION_CELL_DEGREES,
    providerRadiusStepNm: TRAFFIC_PROVIDER_RADIUS_STEP_NM,
    providerMaxRadiusNm: maximumRadiusNm,
  });
}
