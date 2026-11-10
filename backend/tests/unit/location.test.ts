import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  historyWindow,
  locationFixSchema,
  parseLocationFix,
  validateTrackingMode,
  MODE_INTERVALS_MS,
} from "../../src/utils/location";

const valid = {
  latitude: 18.5204,
  longitude: 73.8567,
  accuracy: 8.5,
  altitude: 560,
  speed: 0,
  heading: 0,
  timestamp: new Date().toISOString(),
};

describe("location validation", () => {
  it("accepts valid GPS coordinates", () => {
    const fix = parseLocationFix(valid);
    expect(fix.latitude).toBe(18.5204);
    expect(fix.longitude).toBe(73.8567);
    expect(fix.accuracy).toBe(8.5);
    expect(fix.timestamp).toBeInstanceOf(Date);
  });

  it("accepts optional fields as null", () => {
    const fix = parseLocationFix({ ...valid, altitude: null, speed: null, heading: null });
    expect(fix.altitude).toBeNull();
    expect(fix.speed).toBeNull();
    expect(fix.heading).toBeNull();
  });

  it("rejects impossible latitudes", () => {
    for (const latitude of [91, -91, 200, -200, Number.NaN]) {
      expect(() => parseLocationFix({ ...valid, latitude })).toThrow(ZodError);
    }
  });

  it("rejects impossible longitudes", () => {
    for (const longitude of [181, -181, 400, Number.POSITIVE_INFINITY]) {
      expect(() => parseLocationFix({ ...valid, longitude })).toThrow(ZodError);
    }
  });

  it("rejects invalid accuracy", () => {
    for (const accuracy of [-1, 20_000, Number.NaN]) {
      expect(() => parseLocationFix({ ...valid, accuracy })).toThrow(ZodError);
    }
  });

  it("rejects invalid speed and heading", () => {
    expect(() => parseLocationFix({ ...valid, speed: -5 })).toThrow(ZodError);
    expect(() => parseLocationFix({ ...valid, speed: 2000 })).toThrow(ZodError);
    expect(() => parseLocationFix({ ...valid, heading: -1 })).toThrow(ZodError);
    expect(() => parseLocationFix({ ...valid, heading: 361 })).toThrow(ZodError);
  });

  it("rejects malformed timestamps", () => {
    expect(() => parseLocationFix({ ...valid, timestamp: "not-a-date" })).toThrow(ZodError);
  });

  it("rejects old timestamps", () => {
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(() => parseLocationFix({ ...valid, timestamp: old })).toThrow(ZodError);
  });

  it("rejects timestamps from the future beyond clock skew", () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect(() => parseLocationFix({ ...valid, timestamp: future })).toThrow(ZodError);
  });

  it("accepts a timestamp slightly in the future (clock skew)", () => {
    const skew = new Date(Date.now() + 30_000).toISOString();
    expect(parseLocationFix({ ...valid, timestamp: skew }).timestamp).toBeInstanceOf(Date);
  });

  it("accepts extreme but valid coordinates", () => {
    const fix = locationFixSchema.parse({ ...valid, latitude: -90, longitude: 180, altitude: -400 });
    expect(fix.latitude).toBe(-90);
    expect(fix.longitude).toBe(180);
  });
});

describe("tracking modes", () => {
  it("maps each mode to a sane update interval", () => {
    expect(MODE_INTERVALS_MS.NORMAL).toBeGreaterThanOrEqual(10_000);
    expect(MODE_INTERVALS_MS.NORMAL).toBeLessThanOrEqual(30_000);
    expect(MODE_INTERVALS_MS.HIGH_ACCURACY).toBeLessThanOrEqual(10_000);
    expect(MODE_INTERVALS_MS.BATTERY_SAVING).toBeGreaterThanOrEqual(30_000);
  });

  it("falls back to NORMAL for unknown modes", () => {
    expect(validateTrackingMode("EXTREME")).toBe("NORMAL");
    expect(validateTrackingMode("HIGH_ACCURACY")).toBe("HIGH_ACCURACY");
  });
});

describe("history windows", () => {
  it("computes the preset ranges", () => {
    const win = historyWindow("1h");
    expect(win.to.getTime() - win.from.getTime()).toBeCloseTo(60 * 60 * 1000, -1);
  });

  it("requires from/to for custom ranges", () => {
    expect(() => historyWindow("custom")).toThrow(ZodError);
    expect(() => historyWindow("custom", "2026-08-12T00:00:00Z")).toThrow(ZodError);
  });

  it("rejects inverted custom ranges", () => {
    expect(() => historyWindow("custom", "2026-08-12T02:00:00Z", "2026-08-12T01:00:00Z")).toThrow(ZodError);
  });
});
