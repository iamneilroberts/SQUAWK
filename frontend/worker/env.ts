import type { AdsbProviderEnvironment } from "./adsb/provider";

export type Env = WorkerEnv &
  AdsbProviderEnvironment & {
    HOME_LAT?: string;
    HOME_LON?: string;
  };
