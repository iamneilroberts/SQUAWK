import type { SystemMode } from "../../src/shared/mode";
import {
  sendBrokerCommand,
  type BrokerCommandResult,
  type BrokerStatus,
} from "../durable/protocol";
import type { Env } from "../env";

export type AdminBroker = (
  namespace: Env["ADSB_BROKER"],
  command: Parameters<typeof sendBrokerCommand>[1],
) => Promise<BrokerCommandResult>;

function statusResult(result: BrokerCommandResult): BrokerStatus {
  if (result.type !== "status") throw new TypeError("Unexpected broker response");
  return result.status;
}

export async function readOperationalStatus(
  namespace: Env["ADSB_BROKER"],
  forceMode: SystemMode,
  broker: AdminBroker = sendBrokerCommand,
): Promise<BrokerStatus> {
  return statusResult(await broker(namespace, { type: "status", forceMode }));
}

export async function setRequestedMode(
  namespace: Env["ADSB_BROKER"],
  requestedMode: SystemMode,
  forceMode: SystemMode,
  broker: AdminBroker = sendBrokerCommand,
): Promise<BrokerStatus> {
  return statusResult(await broker(namespace, {
    type: "mode-set",
    requestedMode,
    forceMode,
  }));
}

export async function setOperationalSettings(
  namespace: Env["ADSB_BROKER"],
  settings: { registrationEnabled: boolean; providerCacheOnly: boolean },
  forceMode: SystemMode,
  broker: AdminBroker = sendBrokerCommand,
): Promise<BrokerStatus> {
  return statusResult(await broker(namespace, {
    type: "settings-set",
    ...settings,
    forceMode,
  }));
}
