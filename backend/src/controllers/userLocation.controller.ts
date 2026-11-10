import type { Request, Response } from "express";
import { z } from "zod";
import { ApiError } from "../middleware/errorHandler";
import * as locService from "../services/location.service";
import { ensureWebDevice, getWebDevice } from "../services/permission.service";
import { parseLocationFix, historyRangeSchema, historyWindow, locationModeSchema } from "../utils/location";

/** Resolve the target owner depending on role (ADMIN may act for a USER). */
function resolveOwnerId(req: Request): string {
  if (!req.user) throw new ApiError(401, "Authentication required");
  return req.user.role === "ADMIN" && req.params.userId ? req.params.userId : req.user.id;
}

/** USER dashboard: start location sharing on the user's web device (consent already recorded). */
export async function handleSessionStart(req: Request, res: Response): Promise<void> {
  const ownerId = resolveOwnerId(req);
  const device = await ensureWebDevice(ownerId);
  const body = locationModeSchema.parse(req.body);
  // Pressing "Start sharing" is an explicit consent action: record the audited
  // ConsentRecord (idempotent — an open record is reused) so the session can
  // legally start even if the user never visited the permission center.
  await locService.recordConsent(device.id, ownerId);
  const session = await locService.startLocationSharing(device.id, ownerId, body.mode, body.intervalMs);
  res.status(201).json({
    session: {
      id: session.id,
      mode: session.mode,
      intervalMs: session.intervalMs,
      startedAt: session.startedAt.toISOString(),
    },
  });
}

/** USER dashboard: stop location sharing on the user's web device. */
export async function handleSessionStop(req: Request, res: Response): Promise<void> {
  const ownerId = resolveOwnerId(req);
  const device = await ensureWebDevice(ownerId);
  const result = await locService.stopLocationSharing(device.id, ownerId);
  res.json(result);
}

const updateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(10_000),
  altitude: z.number().min(-500).max(20_000).nullable().optional(),
  speed: z.number().min(0).max(1000).nullable().optional(),
  heading: z.number().min(0).max(360).nullable().optional(),
  timestamp: z.string().datetime({ offset: true }).optional(),
});

/**
 * Push a location fix from the user dashboard. Authenticated with the user's
 * JWT OR the web device token; the target device is always the caller's own
 * web device (never another user's).
 */
export async function handleLocationUpdate(req: Request, res: Response): Promise<void> {
  if (req.authMode === "device") {
    if (!req.device) throw new ApiError(401, "Authentication required");
    const fix = parseLocationFix(req.body);
    const event = await locService.pushLocationFix(req.device.id, req.device.ownerId, fix);
    res.status(201).json({ id: event.id, timestamp: event.timestamp.toISOString() });
    return;
  }
  if (!req.user) throw new ApiError(401, "Authentication required");
  const device = await ensureWebDevice(req.user.id);
  const parsed = updateSchema.parse(req.body);
  const fix = parseLocationFix({
    latitude: parsed.latitude,
    longitude: parsed.longitude,
    accuracy: parsed.accuracy,
    altitude: parsed.altitude ?? null,
    speed: parsed.speed ?? null,
    heading: parsed.heading ?? null,
    timestamp: parsed.timestamp ?? new Date().toISOString(),
    isTest: false,
  });
  const event = await locService.pushLocationFix(device.id, req.user.id, fix);
  res.status(201).json({ id: event.id, timestamp: event.timestamp.toISOString() });
}

/** ADMIN or owner: location history for a user's web device. */
export async function handleUserHistory(req: Request, res: Response): Promise<void> {
  const isAdmin = req.user?.role === "ADMIN";
  const ownerId = req.user?.role === "ADMIN" && req.params.userId ? req.params.userId : req.user?.id;
  if (!ownerId) throw new ApiError(401, "Authentication required");
  const query = historyRangeSchema.parse(req.query);
  const window = historyWindow(query.range, query.from, query.to);
  const device = await getWebDevice(ownerId);
  if (!device) {
    // No web device registered for this user -> no history, not an error.
    res.json({ items: [], total: 0, range: query.range, from: window.from.toISOString(), to: window.to.toISOString() });
    return;
  }
  const result = await locService.getLocationHistory(ownerId, isAdmin, device.id, window, query.max);
  res.json({ ...result, range: query.range, from: window.from.toISOString(), to: window.to.toISOString() });
}
