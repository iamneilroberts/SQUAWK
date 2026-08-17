import { describe, expect, it } from "vitest";

import {
  ValidationError,
  clampRadiusNm,
  readBoundedJsonBody,
  validateCoordinates,
  validateRadiusNm,
} from "./validation";

describe("bounded request validation", () => {
  it("streams a JSON body up to its declared byte limit", async () => {
    const request = new Request("https://squawk.example/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "ok" }),
    });

    await expect(readBoundedJsonBody(request, 64)).resolves.toEqual({ value: "ok" });
  });

  it("rejects a body that exceeds the route limit without trusting content-length", async () => {
    const request = new Request("https://squawk.example/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "too large" }),
    });

    await expect(readBoundedJsonBody(request, 8)).rejects.toMatchObject({
      code: "REQUEST_TOO_LARGE",
      status: 413,
    });
  });

  it("rejects non-JSON, malformed JSON, and non-finite numeric inputs", async () => {
    const textRequest = new Request("https://squawk.example/api/test", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    const malformedRequest = new Request("https://squawk.example/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    await expect(readBoundedJsonBody(textRequest)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(readBoundedJsonBody(malformedRequest)).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(() => validateCoordinates("NaN", 20)).toThrow(ValidationError);
    expect(() => validateRadiusNm(Number.POSITIVE_INFINITY)).toThrow(ValidationError);
  });

  it("validates coordinates and separates rejection from an explicit radius clamp", () => {
    expect(validateCoordinates("30.69", "-88.04")).toEqual({
      latitude: 30.69,
      longitude: -88.04,
    });
    expect(validateRadiusNm("10")).toBe(10);
    expect(validateRadiusNm(250)).toBe(250);
    expect(() => validateCoordinates(91, 0)).toThrow(ValidationError);
    expect(() => validateCoordinates(0, -181)).toThrow(ValidationError);
    expect(() => validateRadiusNm(9)).toThrow(ValidationError);
    expect(() => validateRadiusNm(251)).toThrow(ValidationError);
    expect(clampRadiusNm(9)).toBe(10);
    expect(clampRadiusNm(251)).toBe(250);
  });
});
