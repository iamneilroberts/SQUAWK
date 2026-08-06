import { describe, it, expect } from "vitest";
import { RHO_SL, isaTemperatureK, isaPressurePa, isaDensity, tasToIas, iasToTas } from "./isa";
import { ftToM, ktToMs, msToKt } from "./units";

describe("ISA atmosphere vs the standard table", () => {
  it("is 288.15 K / 101325 Pa / 1.225 kg per m3 at sea level", () => {
    expect(isaTemperatureK(0)).toBeCloseTo(288.15, 2);
    expect(isaPressurePa(0)).toBeCloseTo(101325, 0);
    expect(isaDensity(0)).toBeCloseTo(1.225, 3);
    expect(RHO_SL).toBeCloseTo(1.225, 3);
  });
  it("matches the table at 5000 ft (1524 m): 278.24 K, 84307 Pa, 1.0556 kg per m3", () => {
    const h = ftToM(5000);
    expect(isaTemperatureK(h)).toBeCloseTo(278.24, 1);
    expect(isaPressurePa(h)).toBeCloseTo(84307, -1);
    expect(isaDensity(h)).toBeCloseTo(1.0556, 3);
  });
  it("matches the table at 8000 ft (2438.4 m): 272.31 K, 0.9629 kg per m3", () => {
    const h = ftToM(8000);
    expect(isaTemperatureK(h)).toBeCloseTo(272.31, 1);
    expect(isaDensity(h)).toBeCloseTo(0.9629, 3);
  });
  it("goes isothermal above the tropopause (11000 m: 216.65 K, 22632 Pa)", () => {
    expect(isaTemperatureK(11000)).toBeCloseTo(216.65, 1);
    expect(isaPressurePa(11000)).toBeCloseTo(22632, -1);
    expect(isaTemperatureK(15000)).toBeCloseTo(216.65, 2);
    expect(isaPressurePa(15000)).toBeLessThan(isaPressurePa(11000));
  });
  it("clamps below sea level rather than extrapolating into nonsense", () => {
    expect(isaDensity(-500)).toBeGreaterThan(RHO_SL);
    expect(Number.isFinite(isaDensity(-500))).toBe(true);
  });
});

describe("IAS / TAS", () => {
  it("are equal at sea level", () => {
    expect(msToKt(tasToIas(ktToMs(100), 0))).toBeCloseTo(100, 6);
  });
  it("IAS reads lower than TAS with altitude (100 kt TAS at 8000 ft reads ~88.6 kt)", () => {
    const ias = msToKt(tasToIas(ktToMs(100), ftToM(8000)));
    expect(ias).toBeGreaterThan(87);
    expect(ias).toBeLessThan(90);
  });
  it("round-trips TAS -> IAS -> TAS", () => {
    const tas = ktToMs(180);
    expect(iasToTas(tasToIas(tas, ftToM(12000)), ftToM(12000))).toBeCloseTo(tas, 9);
  });
});
