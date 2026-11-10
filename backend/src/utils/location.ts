import { z } from "zod";
import { env } from "../config/env";

export const TRACKING_MODES = ["NORMAL", "HIGH_ACCURACY", "BATTERY_SAVING"] as const;
export type TrackingMode = (typeof TRACKING_MODES)[number];

/**
 * Update intervals (ms) per tracking mode. These are recommendations the
 * mobile client applies; the backend enforces a hard minimum to protect the
 * API and the device battery.
 */
export const MODE_INTERVALS_MS: Record<TrackingMode, number> = {
  NORMAL: 15_000,
  HIGH_ACCURACY: 8_000,
  BATTERY_SAVING: 45_000,
};

export const MIN_LOCATION_INTERVAL_MS = 5_000;

const finiteNumber = (message: string) =>
  z.number({ message }).refine((v) => Number.isFinite(v), message);

/**
 * Reject coordinates that are impossible or that a real GPS receiver could
 * never produce. Every bound mirrors the valid WGS-84 / NMEA ranges.
 */
export const locationFixSchema = z.object({
  latitude: finiteNumber("latitude must be a finite number").refine((v) => v >= -90 && v <= 90, {
    message: "latitude must be between -90 and 90",
  }),
  longitude: finiteNumber("longitude must be a finite number").refine((v) => v >= -180 && v <= 180, {
    message: "longitude must be between -180 and 180",
  }),
  accuracy: finiteNumber("accuracy must be a finite number").refine((v) => v >= 0 && v <= 10_000, {
    message: "accuracy must be between 0 and 10000 meters",
  }),
  altitude: finiteNumber("altitude must be a finite number")
    .refine((v) => v >= -500 && v <= 20_000, { message: "altitude out of range (-500..20000 m)" })
    .nullable()
    .optional(),
  speed: finiteNumber("speed must be a finite number")
    .refine((v) => v >= 0 && v <= 1_000, { message: "speed must be between 0 and 1000 m/s" })
    .nullable()
    .optional(),
  heading: finiteNumber("heading must be a finite number")
    .refine((v) => v >= 0 && v <= 360, { message: "heading must be between 0 and 360 degrees" })
    .nullable()
    .optional(),
  timestamp: z
    .string({ message: "timestamp must be an ISO-8601 string" })
    .datetime({ offset: true })
    .refine((ts) => {
      const t = Date.parse(ts);
      if (Number.isNaN(t)) return false;
      const skew = Math.abs(Date.now() - t);
      // Reject stale fixes and fixes from the future beyond clock skew.
      return skew <= env.LOCATION_MAX_TS_SKEW_MS;
    }, { message: "timestamp is outside the accepted time window" }),
  // Development-test fixes (simulated coordinates). Never presented as real GPS.
  isTest: z.boolean().optional().default(false),
});

export type LocationFixInput = z.infer<typeof locationFixSchema>;

export interface NormalizedFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: Date;
  isTest: boolean;
}

export function parseLocationFix(raw: unknown): NormalizedFix {
  const parsed = locationFixSchema.parse(raw);
  return {
    latitude: parsed.latitude,
    longitude: parsed.longitude,
    accuracy: parsed.accuracy,
    altitude: parsed.altitude ?? null,
    speed: parsed.speed ?? null,
    heading: parsed.heading ?? null,
    timestamp: new Date(parsed.timestamp),
    isTest: parsed.isTest ?? false,
  };
}

export const locationModeSchema = z.object({
  mode: z.enum(TRACKING_MODES).default("NORMAL"),
  intervalMs: z.number().int().min(MIN_LOCATION_INTERVAL_MS).max(120_000).optional(),
});

export const historyRangeSchema = z.object({
  range: z.enum(["15m", "1h", "6h", "24h", "custom"]).default("1h"),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  max: z.coerce.number().int().min(1).max(5000).default(2000),
});

export function historyWindow(range: string, from?: string, to?: string): { from: Date; to: Date } {
  const now = Date.now();
  if (range === "custom") {
    if (!from || !to) {
      throw new z.ZodError([
        { code: "custom", path: ["from"], message: "custom range requires from and to" },
      ]);
    }
    const f = Date.parse(from);
    const t = Date.parse(to);
    if (Number.isNaN(f) || Number.isNaN(t)) {
      throw new z.ZodError([{ code: "custom", path: ["from"], message: "invalid date range" }]);
    }
    if (t <= f) {
      throw new z.ZodError([{ code: "custom", path: ["to"], message: "to must be after from" }]);
    }
    if (t - f > 90 * 24 * 60 * 60 * 1000) {
      throw new z.ZodError([
        { code: "custom", path: ["range"], message: "custom range cannot exceed 90 days" },
      ]);
    }
    return { from: new Date(f), to: new Date(t) };
  }
  const ms =
    range === "15m" ? 15 * 60 * 1000 : range === "1h" ? 60 * 60 * 1000 : range === "6h" ? 6 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return { from: new Date(now - ms), to: new Date(now) };
}

export function validateTrackingMode(mode: string): TrackingMode {
  return (TRACKING_MODES as readonly string[]).includes(mode) ? (mode as TrackingMode) : "NORMAL";
}
