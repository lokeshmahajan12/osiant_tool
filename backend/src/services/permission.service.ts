import type { Request } from "express";
import { prisma } from "../lib/prisma";
import { emitToOwner } from "../lib/ws";
import { recordAudit } from "../middleware/audit";
import { generateDeviceToken, hashDeviceToken } from "../middleware/deviceAuth";
import { recordSecurityEvent } from "./securityEvent.service";
import { setDevicePermission, recordConsent, DEVICE_STATUS, PERMISSION_STATUS, type PermissionStatus } from "./location.service";
import { env } from "../config/env";

export const PERMISSION_TYPES = ["LOCATION", "CAMERA", "MICROPHONE", "NOTIFICATIONS"] as const;
export type PermissionTypeName = (typeof PERMISSION_TYPES)[number];

export const PERMISSION_STATES = ["NOT_REQUESTED", "GRANTED", "DENIED", "REVOKED", "UNAVAILABLE"] as const;
export type PermissionStateName = (typeof PERMISSION_STATES)[number];

export interface PermissionRecordView {
  type: PermissionTypeName;
  state: PermissionStateName;
  consentVersion: string;
  privacyPolicyVersion: string;
  requestedAt: string | null;
  grantedAt: string | null;
  deniedAt: string | null;
  browser: string | null;
  os: string | null;
  updatedAt: string;
}

/** Resolve the user's single web-browser device (used for location sharing). */
export async function getWebDevice(userId: string) {
  return prisma.device.findFirst({
    where: { ownerId: userId, platform: "WEB" },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Resolve the user's web-browser device, creating it on first dashboard use.
 * Accounts seeded via `createUser` (ADMIN/ANALYST/INVESTIGATOR) have no WEB
 * device, so sharing must not fail with a 404 just because one is missing.
 */
export async function ensureWebDevice(userId: string) {
  const existing = await getWebDevice(userId);
  if (existing) return existing;
  const deviceToken = generateDeviceToken();
  const device = await prisma.device.create({
    data: {
      ownerId: userId,
      name: "Web Browser",
      platform: "WEB",
      status: DEVICE_STATUS.OFFLINE,
      locationSharing: false,
      permissionStatus: PERMISSION_STATUS.UNKNOWN,
      deviceTokenHash: hashDeviceToken(deviceToken),
    },
  });
  await recordAudit({ userId, action: "DEVICE_REGISTERED", details: { deviceId: device.id, name: device.name, platform: "WEB" } });
  return device;
}

function toView(r: {
  type: string;
  state: string;
  consentVersion: string;
  privacyPolicyVersion: string;
  requestedAt: Date | null;
  grantedAt: Date | null;
  deniedAt: Date | null;
  browser: string | null;
  os: string | null;
  updatedAt: Date;
}): PermissionRecordView {
  return {
    type: r.type as PermissionTypeName,
    state: r.state as PermissionStateName,
    consentVersion: r.consentVersion,
    privacyPolicyVersion: r.privacyPolicyVersion,
    requestedAt: r.requestedAt ? r.requestedAt.toISOString() : null,
    grantedAt: r.grantedAt ? r.grantedAt.toISOString() : null,
    deniedAt: r.deniedAt ? r.deniedAt.toISOString() : null,
    browser: r.browser,
    os: r.os,
    updatedAt: r.updatedAt.toISOString(),
  };
}

async function ensureRecords(userId: string): Promise<PermissionRecordView[]> {
  const existing = await prisma.permissionRecord.findMany({ where: { userId } });
  const byType = new Map(existing.map((r) => [r.type, r]));
  const wanted = PERMISSION_TYPES.filter((t) => !byType.has(t));
  if (wanted.length > 0) {
    await prisma.permissionRecord.createMany({
      data: wanted.map((t) => ({ userId, type: t })),
    });
  }
  const rows = await prisma.permissionRecord.findMany({ where: { userId } });
  return rows.map(toView);
}

export async function listUserPermissions(userId: string): Promise<PermissionRecordView[]> {
  return ensureRecords(userId);
}

function metadataFor(req?: Request): { browser: string | null; os: string | null; ip: string | undefined } {
  const ua = req?.get("user-agent") ?? "";
  return {
    browser: ua ? ua.slice(0, 300) : null,
    os: ua ? ua.slice(0, 300) : null,
    ip: req?.ip,
  };
}

/**
 * Record a permission state change reported by the user's browser/OS. The app
 * never forces a browser permission; it only records what the user's device
 * reports. When location is revoked/denied, any active sharing session for the
 * user's web device is stopped immediately.
 */
export async function updateUserPermission(
  userId: string,
  type: PermissionTypeName,
  state: PermissionStateName,
  req?: Request
): Promise<PermissionRecordView> {
  if (!PERMISSION_TYPES.includes(type)) throw new Error("invalid permission type");
  if (!PERMISSION_STATES.includes(state)) throw new Error("invalid permission state");

  const meta = metadataFor(req);
  const now = new Date();
  const existing = await prisma.permissionRecord.findUnique({
    where: { userId_type: { userId, type } },
  });

  // Side effects for location permission state changes.
  if (type === "LOCATION") {
    const webDevice = await getWebDevice(userId);
    if (webDevice) {
      const mapped = (state === "GRANTED" ? "GRANTED" : state === "DENIED" ? "DENIED" : state === "REVOKED" ? "REVOKED" : "UNKNOWN") as PermissionStatus;
      await setDevicePermission(webDevice.id, userId, mapped).catch(() => undefined);
      // An explicit LOCATION grant is audited device consent: create the open
      // ConsentRecord required by startLocationSharing. Revoking/denying already
      // revokes consent inside setDevicePermission.
      if (state === "GRANTED") {
        await recordConsent(webDevice.id, userId).catch(() => undefined);
      }
    }
  }

  const record = await prisma.permissionRecord.upsert({
    where: { userId_type: { userId, type } },
    create: {
      userId,
      type,
      state,
      consentVersion: env.CONSENT_VERSION,
      privacyPolicyVersion: env.PRIVACY_POLICY_VERSION,
      requestedAt: now,
      grantedAt: state === "GRANTED" ? now : null,
      deniedAt: state === "DENIED" || state === "REVOKED" ? now : null,
      browser: meta.browser,
      os: meta.os,
      ip: meta.ip,
      deviceMeta: { userAgent: meta.browser },
    },
    update: {
      state,
      grantedAt: state === "GRANTED" ? now : undefined,
      deniedAt: state === "DENIED" || state === "REVOKED" ? now : undefined,
      requestedAt: existing?.requestedAt ? undefined : now,
      browser: meta.browser,
      os: meta.os,
      ip: meta.ip,
      deviceMeta: { userAgent: meta.browser },
      consentVersion: state === "GRANTED" ? env.CONSENT_VERSION : undefined,
    },
  });

  const revoked = state === "DENIED" || state === "REVOKED";
  const action = type === "LOCATION" && revoked ? "PERMISSION_LOCATION_REVOKED" : `PERMISSION_${type}_${state}`;
  await recordAudit({ userId, action, details: { type, state }, req });
  await recordSecurityEvent({
    userId,
    type: "PERMISSION_UPDATED",
    severity: revoked ? "WARN" : "INFO",
    message: `${type} permission state changed to ${state}`,
    metadata: { type, state },
    ip: req?.ip,
  }).catch(() => undefined);

  emitToOwner(userId, "permission:updated", { userId, type, state, timestamp: now.toISOString() });

  return toView(record);
}
