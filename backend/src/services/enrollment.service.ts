import { createHash, randomBytes } from "node:crypto";
import type { DevicePlatform, EnrollmentToken } from "@prisma/client";
import { ApiError } from "../middleware/errorHandler";
import { recordAudit } from "../middleware/audit";
import { emitToOwner } from "../lib/ws";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { generateDeviceToken, hashDeviceToken } from "../middleware/deviceAuth";
import { DEVICE_STATUS, PERMISSION_STATUS } from "./location.service";

export const ENROLLMENT_PURPOSES = ["Device enrollment"] as const;

export type EnrollmentStatus = "ACTIVE" | "USED" | "EXPIRED" | "REVOKED";

export interface EnrollmentLink {
  id: string;
  url: string;
  token: string;
  purpose: string;
  deviceName: string | null;
  platform: string | null;
  phone: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface EnrollmentSummary {
  id: string;
  purpose: string;
  deviceName: string | null;
  platform: string | null;
  phone: string | null;
  status: EnrollmentStatus;
  expiresAt: string;
  createdAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  deviceId: string | null;
}

/** Public base URL used to build enrollment invite links (from env, never hard-coded). */
export function enrollmentBaseUrl(): string {
  return (env.APP_URL || env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
}

export function enrollmentUrl(token: string): string {
  return `${enrollmentBaseUrl()}/enroll/${token}`;
}

/** Cryptographically random single-use token. Only its hash is stored. */
export function generateEnrollmentToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashEnrollmentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toStatus(t: EnrollmentToken): EnrollmentStatus {
  if (t.revokedAt) return "REVOKED";
  if (t.usedAt) return "USED";
  if (t.expiresAt.getTime() < Date.now()) return "EXPIRED";
  return "ACTIVE";
}

function normalizePlatform(p: string | null | undefined): DevicePlatform | null {
  if (!p) return null;
  return (["ANDROID", "IOS", "WEB", "OTHER"] as const).includes(p as DevicePlatform) ? (p as DevicePlatform) : null;
}

export async function createEnrollment(
  ownerId: string,
  opts: { purpose?: string; deviceName: string; platform?: string | null; phone?: string | null; ttlMs?: number }
): Promise<EnrollmentLink> {
  const ttl = Math.max(60_000, Math.min(opts.ttlMs ?? env.ENROLLMENT_TOKEN_TTL_MS, 7 * 24 * 60 * 60 * 1000));
  const token = generateEnrollmentToken();
  const expiresAt = new Date(Date.now() + ttl);
  const record = await prisma.enrollmentToken.create({
    data: {
      userId: ownerId,
      tokenHash: hashEnrollmentToken(token),
      purpose: opts.purpose?.trim() ? opts.purpose.trim().slice(0, 200) : "Device enrollment",
      deviceName: opts.deviceName.trim().slice(0, 80),
      platform: normalizePlatform(opts.platform),
      phone: opts.phone?.trim() || null,
      expiresAt,
    },
  });
  await recordAudit({
    userId: ownerId,
    action: "ENROLLMENT_LINK_CREATED",
    details: { tokenId: record.id, purpose: record.purpose, deviceName: record.deviceName, expiresAt: expiresAt.toISOString() },
  });
  return {
    id: record.id,
    url: enrollmentUrl(token),
    token,
    purpose: record.purpose,
    deviceName: record.deviceName,
    platform: record.platform,
    phone: record.phone,
    expiresAt: expiresAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
  };
}

export async function listEnrollments(userId: string, isAdmin: boolean): Promise<EnrollmentSummary[]> {
  const tokens = await prisma.enrollmentToken.findMany({
    where: isAdmin ? {} : { userId },
    orderBy: { createdAt: "desc" },
    include: { device: { select: { id: true, name: true } } },
  });
  return tokens.map((t) => ({
    id: t.id,
    purpose: t.purpose,
    deviceName: t.deviceName,
    platform: t.platform,
    phone: t.phone,
    status: toStatus(t),
    expiresAt: t.expiresAt.toISOString(),
    createdAt: t.createdAt.toISOString(),
    usedAt: t.usedAt ? t.usedAt.toISOString() : null,
    revokedAt: t.revokedAt ? t.revokedAt.toISOString() : null,
    deviceId: t.device?.id ?? null,
  }));
}

/** Public metadata for the enrollment page. Reveals nothing private. */
export async function getEnrollmentInfo(token: string): Promise<{
  id: string;
  purpose: string;
  deviceName: string | null;
  platform: string | null;
  expiresAt: string;
  createdAt: string;
}> {
  const record = await prisma.enrollmentToken.findUnique({ where: { tokenHash: hashEnrollmentToken(token) } });
  if (!record) throw new ApiError(404, "This enrollment link is invalid or was already used");
  const status = toStatus(record);
  if (status === "USED") throw new ApiError(410, "This enrollment link has already been used");
  if (status === "REVOKED") throw new ApiError(410, "This enrollment link has been revoked");
  if (status === "EXPIRED") throw new ApiError(410, "This enrollment link has expired");
  return {
    id: record.id,
    purpose: record.purpose,
    deviceName: record.deviceName,
    platform: record.platform,
    expiresAt: record.expiresAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
  };
}

export async function revokeEnrollment(userId: string, isAdmin: boolean, tokenId: string): Promise<{ revoked: boolean }> {
  const record = await prisma.enrollmentToken.findUnique({ where: { id: tokenId } });
  if (!record) throw new ApiError(404, "Enrollment link not found");
  if (!isAdmin && record.userId !== userId) throw new ApiError(404, "Enrollment link not found");
  if (!record.revokedAt) {
    await prisma.enrollmentToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
    await recordAudit({ userId, action: "ENROLLMENT_LINK_REVOKED", details: { tokenId } });
  }
  return { revoked: true };
}

/**
 * Redeem a single-use enrollment link. Claims the token atomically inside a
 * transaction so two requests can never both register a device, then creates
 * the authorized device and returns its one-time authentication token.
 */
export async function redeemEnrollment(
  token: string,
  deviceInfo: { deviceName?: string | null; platform?: string | null; browser?: string | null; os?: string | null; phone?: string | null; isTestDevice?: boolean }
): Promise<{ deviceId: string; deviceToken: string; name: string; platform: string; isTestDevice: boolean }> {
  const record = await prisma.enrollmentToken.findUnique({ where: { tokenHash: hashEnrollmentToken(token) } });
  if (!record) throw new ApiError(404, "This enrollment link is invalid");
  const status = toStatus(record);
  if (status === "USED") throw new ApiError(410, "This enrollment link has already been used");
  if (status === "REVOKED") throw new ApiError(410, "This enrollment link has been revoked");
  if (status === "EXPIRED") throw new ApiError(410, "This enrollment link has expired");

  const isTest = Boolean(deviceInfo.isTestDevice);
  const name = deviceInfo.deviceName?.trim() || record.deviceName || "Enrolled device";
  const platform = normalizePlatform(deviceInfo.platform) ?? record.platform ?? "WEB";
  const deviceToken = generateDeviceToken();

  const device = await prisma.$transaction(async (tx) => {
    const claimed = await tx.enrollmentToken.updateMany({
      where: { id: record.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new ApiError(410, "This enrollment link has already been used");
    }
    return tx.device.create({
      data: {
        ownerId: record.userId,
        name: name.slice(0, 80),
        phone: deviceInfo.phone?.trim() || record.phone || null,
        platform,
        browser: deviceInfo.browser?.trim().slice(0, 120) || null,
        os: deviceInfo.os?.trim().slice(0, 120) || null,
        isTestDevice: isTest,
        enrollmentTokenId: record.id,
        status: DEVICE_STATUS.OFFLINE,
        locationSharing: false,
        permissionStatus: PERMISSION_STATUS.UNKNOWN,
        deviceTokenHash: hashDeviceToken(deviceToken),
      },
    });
  });

  await recordAudit({
    userId: record.userId,
    action: "DEVICE_ENROLLED",
    details: { deviceId: device.id, name: device.name, enrollmentTokenId: record.id, platform, isTestDevice: isTest },
  });
  emitToOwner(record.userId, "device:connected", {
    deviceId: device.id,
    name: device.name,
    isTestDevice: isTest,
    timestamp: new Date().toISOString(),
  });

  return { deviceId: device.id, deviceToken, name: device.name, platform, isTestDevice: isTest };
}
