import { describe, expect, it } from "vitest";
import { sanitizeAccuracy } from "../src/pages/DeviceClient";

describe("sanitizeAccuracy", () => {
  it("passes through a normal accuracy value", () => {
    expect(sanitizeAccuracy(12.5)).toBe(12.5);
  });

  it("clamps Infinity to the max accepted by the backend (browsers can report Infinity)", () => {
    expect(sanitizeAccuracy(Number.POSITIVE_INFINITY)).toBe(10_000);
  });

  it("clamps NaN to the max accepted value", () => {
    expect(sanitizeAccuracy(Number.NaN)).toBe(10_000);
  });

  it("clamps negative and over-range values", () => {
    expect(sanitizeAccuracy(-3)).toBe(0);
    expect(sanitizeAccuracy(20_000)).toBe(10_000);
  });
});
