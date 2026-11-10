import type { Device, DevicePlatform, LocationEvent, LocationSession } from "@prisma/client";
import { ApiError } from "../middleware/errorHandler";
import { recordAudit } from "../middleware/audit";
import { emitToOwner } from "../lib/ws";
import { prisma } from "../lib/prisma";
import { hashDeviceToken, generateDeviceToken } from "../middleware/deviceAuth";
import {
  MODE_INTERVALS_MS,
  MIN_LOCATION_INTERVAL_MS,
  validateTrackingMode,
  type NormalizedFix,
  type TrackingMode,
} from "../utils/location";
import { presenceManager, type PresenceStage } from "./location.presence";
import { env } from "../config/env";

export const CONSENT_VERSION = "1.0";

export const DEVICE_STATUS = {
  ONLINE: "ONLINE",
  OFFLINE: "OFFLINE",
  LOCATION_ON: "LOCATION_ON",
  LOCATION_OFF: "LOCATION_OFF",
  STALE: "STALE",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  PERMISSION_REVOKED: "PERMISSION_REVOKED",
} as const;

export type DeviceStatus = (typeof DEVICE_STATUS)[keyof typeof DEVICE_STATUS];

export const PERMISSION_STATUS = {
  GRANTED: "GRANTED",
  DENIED: "DENIED",
  REVOKED: "REVOKED",
  UNKNOWN: "UNKNOWN",
} as const;

export type PermissionStatus = (typeof PERMISSION_STATUS)[keyof typeof PERMISSION_STATUS];

/**
 * Derive the canonical device status from live session + presence state.
 * `PERMISSION_DENIED` / `PERMISSION_REVOKED` always win because the device
 * cannot legally share in those states.
 */
export function deriveDeviceStatus(opts: {
  permissionStatus: PermissionStatus | string;
  isLive: boolean;
  online: boolean;
  stale?: boolean;
}): DeviceStatus {
  const p = opts.permissionStatus;
  if (p === PERMISSION_STATUS.DENIED) return DEVICE_STATUS.PERMISSION_DENIED;
  if (p === PERMISSION_STATUS.REVOKED) return DEVICE_STATUS.PERMISSION_REVOKED;
  if (opts.isLive && opts.online) return opts.stale ? DEVICE_STATUS.STALE : DEVICE_STATUS.LOCATION_ON;
  if (opts.isLive) return DEVICE_STATUS.OFFLINE;
  return opts.online ? DEVICE_STATUS.ONLINE : DEVICE_STATUS.OFFLINE;
}

export interface DeviceSummary {
  id: string;
  name: string;
  phone: string | null;
  platform: string;
  browser: string | null;
  os: string | null;
  isActive: boolean;
  isTestDevice: boolean;
  status: DeviceStatus;
  permissionStatus: PermissionStatus;
  lastSeenAt: string | null;
  createdAt: string;
  sharing: "LIVE" | "STALE" | "OFF";
  online: boolean;
  /** LIVE | STALE | OFFLINE presence stage derived from the heartbeat stream. */
  presence: PresenceStage;
}

export interface LocationStatus {
  deviceId: string;
  deviceName: string;
  ownerId: string;
  sharing: "LIVE" | "STALE" | "OFF";
  online: boolean;
  /** LIVE | STALE | OFFLINE presence stage derived from the heartbeat stream. */
  presence: PresenceStage;
  status: DeviceStatus;
  permissionStatus: PermissionStatus;
  isTestDevice: boolean;
  lastKnown: {
    latitude: number;
    longitude: number;
    accuracy: number;
    altitude: number | null;
    speed: number | null;
    heading: number | null;
    timestamp: string;
    isTest: boolean;
  } | null;
  lastUpdated: string | null;
  offlineDurationMs: number;
  session: {
    id: string;
    mode: TrackingMode;
    intervalMs: number;
    startedAt: string;
  } | null;
  consent: {
    consentVersion: string;
    locationPermission: boolean;
    grantedAt: string;
    revokedAt: string | null;
  } | null;
}

async function assertDeviceAccess(userId: string, isAdmin: boolean, deviceId: string): Promise<Device> {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) throw new ApiError(404, "Device not found");
  if (!isAdmin && device.ownerId !== userId) throw new ApiError(404, "Device not found");
  return device;
}

function toSummary(d: Device, isLive: boolean, lastFixAtMs: number | null): DeviceSummary {
  // Presence is driven exclusively by REAL GPS fixes. A heartbeat keeps
  // `lastSeenAt` fresh (device is connected) but never elevates a device to
  // LIVE, so a device can never appear to be streaming a location it is not.
  const presence = isLive ? presenceManager.stageOf(d.id, lastFixAtMs) : "OFFLINE";
  const online = presence !== "OFFLINE";
  const sharing: DeviceSummary["sharing"] = isLive ? (presence === "LIVE" ? "LIVE" : "STALE") : "OFF";
  return {
    id: d.id,
    name: d.name,
    phone: d.phone,
    platform: d.platform,
    browser: d.browser,
    os: d.os,
    isActive: d.isActive,
    isTestDevice: d.isTestDevice,
    status: deriveDeviceStatus({ permissionStatus: d.permissionStatus, isLive, online, stale: presence === "STALE" }),
    permissionStatus: (d.permissionStatus as PermissionStatus) ?? PERMISSION_STATUS.UNKNOWN,
    lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
    sharing,
    online,
    presence,
  };
}

/** Newest recorded fix timestamp per device (real GPS fixes only). */
async function lastFixTimestamps(deviceIds: string[]): Promise<Map<string, number | null>> {
  const rows = await prisma.locationEvent.groupBy({
    by: ["deviceId"],
    where: { deviceId: { in: deviceIds } },
    _max: { timestamp: true },
  });
  return new Map(rows.map((r) => [r.deviceId, r._max.timestamp?.getTime() ?? null]));
}

async function activeDeviceIds(deviceIds: string[]): Promise<Set<string>> {
  const sessions = await prisma.locationSession.findMany({
    where: { deviceId: { in: deviceIds }, status: "ACTIVE" },
    select: { deviceId: true },
  });
  return new Set(sessions.map((s) => s.deviceId));
}

export async function enrollDevice(
  ownerId: string,
  name: string,
  platform: DevicePlatform,
  phone?: string | null,
  opts: { browser?: string | null; os?: string | null; isTestDevice?: boolean; enrollmentTokenId?: string | null } = {}
): Promise<{ deviceId: string; deviceToken: string; name: string; phone: string | null }> {
  const deviceToken = generateDeviceToken();
  const device = await prisma.device.create({
    data: {
      ownerId,
      name,
      phone: phone?.trim() || null,
      platform,
      browser: opts.browser ?? null,
      os: opts.os ?? null,
      isTestDevice: opts.isTestDevice ?? false,
      enrollmentTokenId: opts.enrollmentTokenId ?? null,
      status: DEVICE_STATUS.OFFLINE,
      locationSharing: false,
      permissionStatus: PERMISSION_STATUS.UNKNOWN,
      deviceTokenHash: hashDeviceToken(deviceToken),
    },
  });
  return { deviceId: device.id, deviceToken, name: device.name, phone: device.phone };
}

export async function listDevices(userId: string, isAdmin: boolean): Promise<DeviceSummary[]> {
  const devices = await prisma.device.findMany({
    where: isAdmin ? {} : { ownerId: userId },
    orderBy: { createdAt: "desc" },
  });
  const ids = devices.map((d) => d.id);
  const [activeIds, fixes] = await Promise.all([activeDeviceIds(ids), lastFixTimestamps(ids)]);
  return devices.map((d) => toSummary(d, activeIds.has(d.id), fixes.get(d.id) ?? null));
}

export async function getDevice(userId: string, isAdmin: boolean, deviceId: string): Promise<DeviceSummary> {
  const device = await assertDeviceAccess(userId, isAdmin, deviceId);
  const [activeIds, fixes] = await Promise.all([activeDeviceIds([device.id]), lastFixTimestamps([device.id])]);
  return toSummary(device, activeIds.has(device.id), fixes.get(device.id) ?? null);
}

export async function updateDevice(
  userId: string,
  isAdmin: boolean,
  deviceId: string,
  data: { name?: string; phone?: string | null; isActive?: boolean }
): Promise<DeviceSummary> {
  const device = await assertDeviceAccess(userId, isAdmin, deviceId);
  if (data.isActive === false && device.isActive) {
    // Deactivating the device also ends any active sharing session.
    await prisma.locationSession.updateMany({ where: { deviceId, status: "ACTIVE" }, data: { status: "STOPPED", stoppedAt: new Date() } });
    presenceManager.markStopped(deviceId);
    await recordAudit({ userId, action: "LOCATION_STOPPED", details: { deviceId, reason: "device_deactivated" } });
  }
  const updated = await prisma.device.update({
    where: { id: deviceId },
    data: {
      ...data,
      phone: data.phone?.trim() || null,
      locationSharing: data.isActive === false ? false : undefined,
      status: data.isActive === false ? DEVICE_STATUS.OFFLINE : undefined,
    },
  });
  const [activeIds, fixes] = await Promise.all([activeDeviceIds([updated.id]), lastFixTimestamps([updated.id])]);
  return toSummary(updated, activeIds.has(updated.id), fixes.get(updated.id) ?? null);
}

export async function deleteDevice(userId: string, isAdmin: boolean, deviceId: string): Promise<{ deleted: boolean; locationEvents: number }> {
  const device = await assertDeviceAccess(userId, isAdmin, deviceId);
  const locationEvents = await prisma.locationEvent.count({ where: { deviceId } });
  await prisma.device.delete({ where: { id: device.id } });
  presenceManager.markStopped(deviceId);
  await recordAudit({
    userId,
    action: "DEVICE_DELETED",
    details: { deviceId, name: device.name, locationEvents },
  });
  return { deleted: true, locationEvents };
}

export async function getOpenConsent(deviceId: string) {
  return prisma.consentRecord.findFirst({
    where: { deviceId, revokedAt: null },
    orderBy: { grantedAt: "desc" },
  });
}

/** Record explicit consent from the device owner before sharing may start. */
export async function recordConsent(
  deviceId: string,
  ownerId: string,
  consentVersion: string = CONSENT_VERSION
): Promise<{ consentVersion: string; locationPermission: boolean; grantedAt: string }> {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) throw new ApiError(404, "Device not found");
  if (device.ownerId !== ownerId) throw new ApiError(404, "Device not found");
  const existing = await getOpenConsent(deviceId);
  if (existing) {
    return {
      consentVersion: existing.consentVersion,
      locationPermission: existing.locationPermission,
      grantedAt: existing.grantedAt.toISOString(),
    };
  }
  const consent = await prisma.consentRecord.create({
    data: { deviceId, userId: ownerId, consentVersion, locationPermission: true },
  });
  await recordAudit({ userId: ownerId, action: "LOCATION_CONSENT_GRANTED", details: { deviceId, consentVersion } });
  return {
    consentVersion: consent.consentVersion,
    locationPermission: consent.locationPermission,
    grantedAt: consent.grantedAt.toISOString(),
  };
}

export async function startLocationSharing(
  deviceId: string,
  ownerId: string,
  mode: string,
  intervalMs?: number
): Promise<LocationSession> {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) throw new ApiError(404, "Device not found");
  if (device.ownerId !== ownerId) throw new ApiError(404, "Device not found");

  const consent = await getOpenConsent(deviceId);
  if (!consent) throw new ApiError(403, "Device consent required before location sharing can start");

  const active = await prisma.locationSession.findFirst({ where: { deviceId, status: "ACTIVE" } });
  if (active) {
    return active; // already live — idempotent
  }

  const normalizedMode = validateTrackingMode(mode);
  const effectiveInterval = Math.max(intervalMs ?? MODE_INTERVALS_MS[normalizedMode], MIN_LOCATION_INTERVAL_MS);

  const session = await prisma.locationSession.create({
    data: {
      deviceId,
      userId: ownerId,
      status: "ACTIVE",
      mode: normalizedMode,
      intervalMs: effectiveInterval,
      startedAt: new Date(),
    },
  });
  await prisma.device.update({ where: { id: deviceId }, data: { locationSharing: true, status: DEVICE_STATUS.LOCATION_ON } });
  presenceManager.register(deviceId, ownerId, effectiveInterval);
  await recordAudit({
    userId: ownerId,
    action: "LOCATION_STARTED",
    details: { deviceId, mode: normalizedMode, intervalMs: effectiveInterval },
  });
  emitToOwner(ownerId, "location:started", {
    deviceId,
    sessionId: session.id,
    mode: normalizedMode,
    intervalMs: effectiveInterval,
    startedAt: session.startedAt.toISOString(),
  });
  return session;
}

export async function stopLocationSharing(deviceId: string, ownerId: string): Promise<{ stopped: boolean; sessionId?: string }> {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) throw new ApiError(404, "Device not found");
  if (device.ownerId !== ownerId) throw new ApiError(404, "Device not found");

  const active = await prisma.locationSession.findFirst({ where: { deviceId, status: "ACTIVE" } });
  if (!active) {
    return { stopped: false };
  }
  const stoppedAt = new Date();
  await prisma.locationSession.update({ where: { id: active.id }, data: { status: "STOPPED", stoppedAt } });
  await prisma.consentRecord.updateMany({ where: { deviceId, revokedAt: null }, data: { revokedAt: stoppedAt } });
  await prisma.device.update({
    where: { id: deviceId },
    data: { locationSharing: false, status: deriveDeviceStatus({ permissionStatus: device.permissionStatus, isLive: false, online: false }) },
  });
  presenceManager.markStopped(deviceId);
  await recordAudit({ userId: ownerId, action: "LOCATION_STOPPED", details: { deviceId } });
  emitToOwner(ownerId, "location:stopped", { deviceId, sessionId: active.id, stoppedAt: stoppedAt.toISOString() });
  return { stopped: true, sessionId: active.id };
}

export async function pushLocationFix(deviceId: string, ownerId: string, fix: NormalizedFix): Promise<LocationEvent> {
  const session = await prisma.locationSession.findFirst({ where: { deviceId, status: "ACTIVE" } });
  if (!session) {
    throw new ApiError(403, "Location sharing is not active for this device");
  }

  const event = await prisma.locationEvent.create({
    data: {
      deviceId,
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracy: fix.accuracy,
      altitude: fix.altitude,
      speed: fix.speed,
      heading: fix.heading,
      timestamp: fix.timestamp,
      isTest: fix.isTest,
    },
  });

  await prisma.device.update({
    where: { id: deviceId },
    data: {
      lastSeenAt: fix.timestamp,
      status: DEVICE_STATUS.LOCATION_ON,
      locationSharing: true,
      isTestDevice: fix.isTest ? true : undefined,
    },
  });
  presenceManager.noteFix(deviceId, ownerId, fix.timestamp.getTime());

  emitToOwner(ownerId, "location:update", {
    deviceId,
    latitude: fix.latitude,
    longitude: fix.longitude,
    accuracy: fix.accuracy,
    altitude: fix.altitude,
    speed: fix.speed,
    heading: fix.heading,
    timestamp: fix.timestamp.toISOString(),
    isTest: fix.isTest,
  });

  return event;
}

export async function recordHeartbeat(deviceId: string, ownerId: string): Promise<{ ok: boolean; sharingActive: boolean; timestamp: string }> {
  const session = await prisma.locationSession.findFirst({ where: { deviceId, status: "ACTIVE" } });
  if (!session) {
    // Not an error: the client polls this continuously and uses `ok:false` to
    // learn that its session ended (e.g. dashboard STOP or expiry) so it can
    // transition out of the live stage instead of heartbeating forever.
    return { ok: false, sharingActive: false, timestamp: new Date().toISOString() };
  }
  const timestamp = new Date();
  await prisma.device.update({
    where: { id: deviceId },
    data: { lastSeenAt: timestamp },
  });
  // A heartbeat proves the device is connected but is NOT a GPS fix. It must
  // not drive the LIVE presence stage, otherwise a device with no working
  // location stream would be shown as LIVE with no coordinates.
  return { ok: true, sharingActive: true, timestamp: timestamp.toISOString() };
}

export async function getLocationStatus(userId: string, isAdmin: boolean, deviceId: string): Promise<LocationStatus> {
  const device = await assertDeviceAccess(userId, isAdmin, deviceId);
  const [session, consent, lastFix] = await Promise.all([
    prisma.locationSession.findFirst({ where: { deviceId, status: "ACTIVE" } }),
    getOpenConsent(deviceId),
    prisma.locationEvent.findFirst({ where: { deviceId }, orderBy: { timestamp: "desc" } }),
  ]);

  const lastUpdated = lastFix?.timestamp ?? device.lastSeenAt;
  const lastUpdatedMs = lastUpdated?.getTime() ?? null;
  // Presence is derived from the last REAL GPS fix, never from a heartbeat.
  const presence: PresenceStage = session ? presenceManager.stageOf(device.id, lastFix?.timestamp.getTime() ?? null) : "OFFLINE";
  const online = presence !== "OFFLINE";
  const sharing: LocationStatus["sharing"] = session ? (presence === "LIVE" ? "LIVE" : "STALE") : "OFF";
  const permissionStatus = (device.permissionStatus as PermissionStatus) ?? PERMISSION_STATUS.UNKNOWN;

  return {
    deviceId: device.id,
    deviceName: device.name,
    ownerId: device.ownerId,
    sharing,
    online,
    presence,
    permissionStatus,
    isTestDevice: device.isTestDevice,
    status: deriveDeviceStatus({ permissionStatus, isLive: Boolean(session), online, stale: presence === "STALE" }),
    lastKnown: lastFix
      ? {
          latitude: lastFix.latitude,
          longitude: lastFix.longitude,
          accuracy: lastFix.accuracy,
          altitude: lastFix.altitude,
          speed: lastFix.speed,
          heading: lastFix.heading,
          timestamp: lastFix.timestamp.toISOString(),
          isTest: lastFix.isTest,
        }
      : null,
    lastUpdated: lastUpdated ? lastUpdated.toISOString() : null,
    offlineDurationMs: online || !lastUpdatedMs ? 0 : Math.max(0, Date.now() - lastUpdatedMs),
    session: session
      ? {
          id: session.id,
          mode: validateTrackingMode(session.mode),
          intervalMs: session.intervalMs,
          startedAt: session.startedAt.toISOString(),
        }
      : null,
    consent: consent
      ? {
          consentVersion: consent.consentVersion,
          locationPermission: consent.locationPermission,
          grantedAt: consent.grantedAt.toISOString(),
          revokedAt: consent.revokedAt ? consent.revokedAt.toISOString() : null,
        }
      : null,
  };
}

export async function getLocationHistory(
  userId: string,
  isAdmin: boolean,
  deviceId: string,
  window: { from: Date; to: Date },
  max: number
): Promise<{ items: Array<{ latitude: number; longitude: number; accuracy: number; altitude: number | null; speed: number | null; heading: number | null; timestamp: string; isTest: boolean }>; total: number }> {
  await assertDeviceAccess(userId, isAdmin, deviceId);
  const rows = await prisma.locationEvent.findMany({
    where: { deviceId, timestamp: { gte: window.from, lte: window.to } },
    orderBy: { timestamp: "asc" },
    take: Math.min(max, 5000),
    select: {
      latitude: true,
      longitude: true,
      accuracy: true,
      altitude: true,
      speed: true,
      heading: true,
      timestamp: true,
      isTest: true,
    },
  });
  return {
    items: rows.map((r) => ({
      latitude: r.latitude,
      longitude: r.longitude,
      accuracy: r.accuracy,
      altitude: r.altitude,
      speed: r.speed,
      heading: r.heading,
      timestamp: r.timestamp.toISOString(),
      isTest: r.isTest,
    })),
    total: rows.length,
  };
}

export async function getDeviceMe(deviceId: string): Promise<{
  id: string;
  name: string;
  platform: string;
  browser: string | null;
  os: string | null;
  isTestDevice: boolean;
  sharing: boolean;
  session: { mode: TrackingMode; intervalMs: number; startedAt: string } | null;
  consentGranted: boolean;
  dataPolicy: {
    consentVersion: string;
    retentionHours: number;
    sessionTtlHours: number;
    staleThresholdMs: number;
    offlineThresholdMs: number;
  };
}> {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) throw new ApiError(404, "Device not found");
  const [session, consent] = await Promise.all([
    prisma.locationSession.findFirst({ where: { deviceId, status: "ACTIVE" } }),
    getOpenConsent(deviceId),
  ]);
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    browser: device.browser,
    os: device.os,
    isTestDevice: device.isTestDevice,
    sharing: Boolean(session),
    session: session
      ? { mode: validateTrackingMode(session.mode), intervalMs: session.intervalMs, startedAt: session.startedAt.toISOString() }
      : null,
    consentGranted: Boolean(consent),
    dataPolicy: {
      consentVersion: CONSENT_VERSION,
      retentionHours: env.LOCATION_RETENTION_HOURS,
      sessionTtlHours: Math.round(env.LOCATION_SESSION_TTL_MS / (60 * 60_000)),
      staleThresholdMs: env.LOCATION_STALE_THRESHOLD_MS,
      offlineThresholdMs: env.LOCATION_OFFLINE_THRESHOLD_MS,
    },
  };
}

/**
 * Update the OS/browser location-permission state reported by the device.
 * Revoking or denying permission stops any active sharing session and notifies
 * the dashboard immediately. The device is never silently restarted.
 */
export async function setDevicePermission(
  deviceId: string,
  ownerId: string,
  status: PermissionStatus
): Promise<{ permissionStatus: PermissionStatus; sharingStopped: boolean }> {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) throw new ApiError(404, "Device not found");
  if (device.ownerId !== ownerId) throw new ApiError(404, "Device not found");

  const revoked = status === PERMISSION_STATUS.DENIED || status === PERMISSION_STATUS.REVOKED;
  let sharingStopped = false;
  if (revoked) {
    await prisma.locationSession.updateMany({ where: { deviceId, status: "ACTIVE" }, data: { status: "STOPPED", stoppedAt: new Date() } });
    await prisma.consentRecord.updateMany({ where: { deviceId, revokedAt: null }, data: { revokedAt: new Date() } });
    presenceManager.markStopped(deviceId);
    sharingStopped = true;
  }

  await prisma.device.update({
    where: { id: deviceId },
    data: {
      permissionStatus: status,
      locationSharing: revoked ? false : device.locationSharing,
      status: deriveDeviceStatus({ permissionStatus: status, isLive: revoked ? false : device.locationSharing, online: false }),
    },
  });

  await recordAudit({
    userId: ownerId,
    action: status === PERMISSION_STATUS.GRANTED ? "LOCATION_PERMISSION_GRANTED" : "LOCATION_PERMISSION_REVOKED",
    details: { deviceId, permissionStatus: status, sharingStopped },
  });
  emitToOwner(ownerId, "permission:changed", { deviceId, permissionStatus: status, sharingStopped });

  return { permissionStatus: status, sharingStopped };
}

/** Permanently delete every recorded fix for a device (privacy control). */
export async function deleteDeviceHistory(userId: string, isAdmin: boolean, deviceId: string): Promise<{ deleted: number }> {
  await assertDeviceAccess(userId, isAdmin, deviceId);
  const res = await prisma.locationEvent.deleteMany({ where: { deviceId } });
  await recordAudit({ userId, action: "LOCATION_HISTORY_DELETED", details: { deviceId, deleted: res.count } });
  return { deleted: res.count };
}

/**
 * Device-side diagnostics: confirms the device token authenticates against the
 * API and returns the last stored fix plus connection timestamps so the mobile
 * "Connection diagnostics" page can report backend/auth health.
 */
export async function getDeviceDiagnostics(deviceId: string): Promise<{
  deviceId: string;
  auth: boolean;
  backend: "ok";
  apiStatus: number;
  lastFix: { timestamp: string; latitude: number; longitude: number; accuracy: number } | null;
  lastSeenAt: string | null;
  serverTime: string;
}> {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) throw new ApiError(404, "Device not found");
  const lastFix = await prisma.locationEvent.findFirst({ where: { deviceId }, orderBy: { timestamp: "desc" } });
  return {
    deviceId: device.id,
    auth: true,
    backend: "ok",
    apiStatus: 200,
    lastFix: lastFix
      ? { timestamp: lastFix.timestamp.toISOString(), latitude: lastFix.latitude, longitude: lastFix.longitude, accuracy: lastFix.accuracy }
      : null,
    lastSeenAt: device.lastSeenAt ? device.lastSeenAt.toISOString() : null,
    serverTime: new Date().toISOString(),
  };
}
