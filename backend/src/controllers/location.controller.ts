import type { Request, Response } from "express";
import { z } from "zod";
import { ApiError } from "../middleware/errorHandler";
import { recordAudit } from "../middleware/audit";
import * as service from "../services/location.service";
import { historyRangeSchema, historyWindow, locationModeSchema, parseLocationFix } from "../utils/location";

const PLATFORMS = ["ANDROID", "IOS", "WEB", "OTHER"] as const;

const PHONE_REGEX = /^[+]?[\d\s()-]{7,20}$/;

const phoneSchema = z
  .string()
  .trim()
  .max(20)
  .refine((v) => v === "" || PHONE_REGEX.test(v), "Enter a valid phone number (e.g. +919876543210)")
  .transform((v) => v.trim() || null)
  .nullable()
  .optional();

const enrollSchema = z.object({
  name: z.string().trim().min(1).max(80),
  platform: z.enum(PLATFORMS).default("WEB"),
  phone: phoneSchema,
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  phone: phoneSchema,
  isActive: z.boolean().optional(),
});

const consentSchema = z.object({
  consentVersion: z.string().trim().min(1).max(20).default("1.0"),
});

/** Resolve the target device id depending on which credential authenticated the request. */
function resolveDeviceId(req: Request, fallback: string): string {
  return req.authMode === "device" ? (req.device?.id ?? fallback) : fallback;
}

function isAdmin(req: Request): boolean {
  return req.user?.role === "ADMIN";
}

function userId(req: Request): string {
  if (!req.user) throw new ApiError(401, "Authentication required");
  return req.user.id;
}

export async function handleEnroll(req: Request, res: Response): Promise<void> {
  const body = enrollSchema.parse(req.body);
  const result = await service.enrollDevice(userId(req), body.name, body.platform, body.phone);
  await recordAudit({
    userId: req.user!.id,
    action: "DEVICE_ENROLLED",
    details: { deviceId: result.deviceId, name: result.name, phone: result.phone ? result.phone.replace(/[^\d+]/g, "") : undefined },
    req,
  });
  res.status(201).json(result);
}

export async function handleList(req: Request, res: Response): Promise<void> {
  const devices = await service.listDevices(userId(req), isAdmin(req));
  res.json({ devices });
}

export async function handleGet(req: Request, res: Response): Promise<void> {
  const device = await service.getDevice(userId(req), isAdmin(req), req.params.id);
  res.json({ device });
}

export async function handleUpdate(req: Request, res: Response): Promise<void> {
  const body = updateSchema.parse(req.body);
  const device = await service.updateDevice(userId(req), isAdmin(req), req.params.id, body);
  await recordAudit({ userId: req.user!.id, action: "DEVICE_UPDATED", details: { deviceId: device.id }, req });
  res.json({ device });
}

export async function handleDelete(req: Request, res: Response): Promise<void> {
  await service.deleteDevice(userId(req), isAdmin(req), req.params.id);
  res.status(204).send();
}

/** Dashboard (JWT) or device (token) records the explicit consent before sharing. */
export async function handleRecordConsent(req: Request, res: Response): Promise<void> {
  const body = consentSchema.parse(req.body);
  const deviceId = resolveDeviceId(req, req.params.id);
  const ownerId = req.authMode === "device" ? req.device!.ownerId : userId(req);
  const consent = await service.recordConsent(deviceId, ownerId, body.consentVersion);
  res.status(201).json({ consent });
}

export async function handleStart(req: Request, res: Response): Promise<void> {
  const body = locationModeSchema.parse(req.body);
  const deviceId = resolveDeviceId(req, req.params.id);
  const ownerId = req.authMode === "device" ? req.device!.ownerId : userId(req);
  const session = await service.startLocationSharing(deviceId, ownerId, body.mode, body.intervalMs);
  res.status(201).json({
    session: {
      id: session.id,
      mode: session.mode,
      intervalMs: session.intervalMs,
      startedAt: session.startedAt.toISOString(),
    },
  });
}

export async function handleStop(req: Request, res: Response): Promise<void> {
  const deviceId = resolveDeviceId(req, req.params.id);
  const ownerId = req.authMode === "device" ? req.device!.ownerId : userId(req);
  const result = await service.stopLocationSharing(deviceId, ownerId);
  res.json(result);
}

export async function handleStatus(req: Request, res: Response): Promise<void> {
  const status = await service.getLocationStatus(userId(req), isAdmin(req), req.params.id);
  await recordAudit({ userId: req.user!.id, action: "LOCATION_ACCESSED", details: { deviceId: status.deviceId }, req });
  res.json({ status });
}

export async function handleHistory(req: Request, res: Response): Promise<void> {
  const query = historyRangeSchema.parse(req.query);
  const window = historyWindow(query.range, query.from, query.to);
  const result = await service.getLocationHistory(userId(req), isAdmin(req), req.params.id, window, query.max);
  await recordAudit({
    userId: req.user!.id,
    action: "LOCATION_HISTORY_VIEWED",
    details: { deviceId: req.params.id, range: query.range, from: window.from.toISOString(), to: window.to.toISOString(), points: result.total },
    req,
  });
  res.json({ ...result, range: query.range, from: window.from.toISOString(), to: window.to.toISOString() });
}

export async function handleHistoryExport(req: Request, res: Response): Promise<void> {
  const query = historyRangeSchema.parse(req.query);
  const window = historyWindow(query.range, query.from, query.to);
  const result = await service.getLocationHistory(userId(req), isAdmin(req), req.params.id, window, 5000);

  const format = req.query.format === "csv" ? "csv" : "json";
  if (format === "csv") {
    const header = "timestamp,latitude,longitude,accuracy_m,altitude_m,speed_mps,heading_deg";
    const lines = result.items.map((r) =>
      [r.timestamp, r.latitude, r.longitude, r.accuracy, r.altitude ?? "", r.speed ?? "", r.heading ?? ""].join(",")
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="sentinel-location-${req.params.id}.csv"`);
    res.send([header, ...lines].join("\n"));
  } else {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="sentinel-location-${req.params.id}.json"`);
    res.send(JSON.stringify(result, null, 2));
  }
  await recordAudit({
    userId: req.user!.id,
    action: "LOCATION_HISTORY_EXPORTED",
    details: { deviceId: req.params.id, format, points: result.total },
    req,
  });
}

/** Device-token-authenticated location push. */
export async function handlePushLocation(req: Request, res: Response): Promise<void> {
  if (!req.device) throw new ApiError(401, "Authentication required");
  const fix = parseLocationFix(req.body);
  const event = await service.pushLocationFix(req.device.id, req.device.ownerId, fix);
  res.status(201).json({ id: event.id, timestamp: event.timestamp.toISOString() });
}

/** Device-token-authenticated heartbeat. */
export async function handleHeartbeat(req: Request, res: Response): Promise<void> {
  if (!req.device) throw new ApiError(401, "Authentication required");
  const result = await service.recordHeartbeat(req.device.id, req.device.ownerId);
  res.json(result);
}

/** Device-token-authenticated self-service info. */
export async function handleDeviceMe(req: Request, res: Response): Promise<void> {
  if (!req.device) throw new ApiError(401, "Authentication required");
  const info = await service.getDeviceMe(req.device.id);
  res.json({ device: info });
}

/** Device-token-authenticated privacy control: delete this device's recorded history. */
export async function handleHistoryDeleteSelf(req: Request, res: Response): Promise<void> {
  if (!req.device) throw new ApiError(401, "Authentication required");
  const result = await service.deleteDeviceHistory(req.device.ownerId, false, req.device.id);
  res.json(result);
}

/** Device-token-authenticated diagnostics for the mobile diagnostics page. */
export async function handleDeviceDiagnostics(req: Request, res: Response): Promise<void> {
  if (!req.device) throw new ApiError(401, "Authentication required");
  const diag = await service.getDeviceDiagnostics(req.device.id);
  res.json(diag);
}

const permissionSchema = z.object({
  status: z.enum(["GRANTED", "DENIED", "REVOKED"]),
});

/** Device (or dashboard) reports the OS/browser location-permission state. */
export async function handlePermission(req: Request, res: Response): Promise<void> {
  const body = permissionSchema.parse(req.body);
  const deviceId = resolveDeviceId(req, req.params.id);
  const ownerId = req.authMode === "device" ? req.device!.ownerId : userId(req);
  const result = await service.setDevicePermission(deviceId, ownerId, body.status);
  res.json(result);
}

/** Dashboard-only: wipe all recorded fixes for a device (privacy control). */
export async function handleHistoryDelete(req: Request, res: Response): Promise<void> {
  const result = await service.deleteDeviceHistory(userId(req), isAdmin(req), req.params.id);
  res.json(result);
}
