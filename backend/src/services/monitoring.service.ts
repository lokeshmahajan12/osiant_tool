import type { Request } from "express";
import { prisma } from "../lib/prisma";
import { ApiError } from "../middleware/errorHandler";
import { recordAudit } from "../middleware/audit";
import { recordSecurityEvent } from "./securityEvent.service";
import { emitToOwner } from "../lib/ws";
import { presenceManager } from "./location.presence";

export const MONITORING_STATUS = {
  INACTIVE: "INACTIVE",
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
} as const;
export type MonitoringStatus = (typeof MONITORING_STATUS)[keyof typeof MONITORING_STATUS];

function wsEventName(action: string): string {
  switch (action) {
    case "start":
      return "admin:monitor-started";
    case "stop":
      return "admin:monitor-stopped";
    case "suspend":
      return "admin:user-suspended";
    case "enable":
      return "admin:monitor-enabled";
    default:
      return "admin:monitor-updated";
  }
}

async function setStatus(targetUserId: string, actorId: string, status: MonitoringStatus, action: string, req?: Request): Promise<{ status: string }> {
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw new ApiError(404, "User not found");

  const now = new Date();
  await prisma.monitoringState.upsert({
    where: { userId: targetUserId },
    create: {
      userId: targetUserId,
      status,
      startedAt: status === "ACTIVE" ? now : null,
      stoppedAt: status === "INACTIVE" || status === "SUSPENDED" ? now : null,
      updatedBy: actorId,
    },
    update: {
      status,
      startedAt: status === "ACTIVE" ? now : undefined,
      stoppedAt: status === "INACTIVE" || status === "SUSPENDED" ? now : undefined,
      updatedBy: actorId,
    },
  });

  await recordAudit({ userId: actorId, action: `admin.${action}`, details: { targetUserId }, req });
  await recordSecurityEvent({
    userId: targetUserId,
    type: action === "suspend" ? "USER_SUSPENDED" : `MONITORING_${action.toUpperCase()}`,
    severity: action === "suspend" ? "WARN" : "INFO",
    message: `Admin ${action} monitoring for account`,
    metadata: { actorId },
    ip: req?.ip,
  }).catch(() => undefined);
  emitToOwner(targetUserId, wsEventName(action), { userId: targetUserId, status, timestamp: now.toISOString() });

  return { status };
}

export async function startMonitoring(targetUserId: string, actorId: string, req?: Request) {
  return setStatus(targetUserId, actorId, "ACTIVE", "start", req);
}

export async function stopMonitoring(targetUserId: string, actorId: string, req?: Request) {
  // Stopping the application monitoring session also stops active location sharing.
  await stopAllLocationSharing(targetUserId, actorId, "monitoring stopped");
  return setStatus(targetUserId, actorId, "INACTIVE", "stop", req);
}

export async function suspendMonitoring(targetUserId: string, actorId: string, req?: Request) {
  await stopAllLocationSharing(targetUserId, actorId, "monitoring suspended");
  return setStatus(targetUserId, actorId, "SUSPENDED", "suspend", req);
}

export async function reEnableMonitoring(targetUserId: string, actorId: string, req?: Request) {
  return setStatus(targetUserId, actorId, "ACTIVE", "enable", req);
}

async function stopAllLocationSharing(targetUserId: string, actorId: string, reason: string): Promise<void> {
  const sessions = await prisma.locationSession.findMany({
    where: { userId: targetUserId, status: "ACTIVE" },
    include: { device: true },
  });
  const stoppedAt = new Date();
  for (const s of sessions) {
    await prisma.locationSession.update({ where: { id: s.id }, data: { status: "STOPPED", stoppedAt } });
    await prisma.consentRecord.updateMany({ where: { deviceId: s.deviceId, revokedAt: null }, data: { revokedAt: stoppedAt } });
    await prisma.device.update({
      where: { id: s.deviceId },
      data: { locationSharing: false, status: "OFFLINE" },
    });
    presenceManager.markStopped(s.deviceId);
    emitToOwner(targetUserId, "location:stopped", { deviceId: s.deviceId, sessionId: s.id, stoppedAt: stoppedAt.toISOString() });
  }
  await recordAudit({ userId: actorId, action: "admin.location_stopped", details: { targetUserId, reason, sessions: sessions.length } });
}

export async function forceLogout(targetUserId: string, actorId: string, req?: Request): Promise<{ revoked: number }> {
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw new ApiError(404, "User not found");
  const res = await prisma.session.updateMany({ where: { userId: targetUserId, revokedAt: null }, data: { revokedAt: new Date() } });
  await recordAudit({ userId: actorId, action: "admin.user_logged_out", details: { targetUserId, sessions: res.count }, req });
  await recordSecurityEvent({
    userId: targetUserId,
    type: "FORCED_LOGOUT",
    severity: "WARN",
    message: "All sessions were revoked by an administrator",
    metadata: { actorId },
  }).catch(() => undefined);
  emitToOwner(targetUserId, "admin:user-logged-out", { userId: targetUserId, timestamp: new Date().toISOString() });
  return { revoked: res.count };
}

export async function revokeMonitoringAuthorization(targetUserId: string, actorId: string, req?: Request): Promise<{ revoked: boolean }> {
  await stopAllLocationSharing(targetUserId, actorId, "authorization revoked");
  await prisma.permissionRecord.updateMany({
    where: { userId: targetUserId, state: { in: ["GRANTED", "NOT_REQUESTED"] } },
    data: { state: "REVOKED" },
  });
  await prisma.device.updateMany({
    where: { ownerId: targetUserId },
    data: { permissionStatus: "REVOKED", locationSharing: false, status: "PERMISSION_REVOKED" },
  });
  await prisma.monitoringState.upsert({
    where: { userId: targetUserId },
    create: { userId: targetUserId, status: "INACTIVE", updatedBy: actorId },
    update: { status: "INACTIVE", updatedBy: actorId },
  });
  await recordAudit({ userId: actorId, action: "admin.authorization_revoked", details: { targetUserId }, req });
  await recordSecurityEvent({
    userId: targetUserId,
    type: "AUTHORIZATION_REVOKED",
    severity: "WARN",
    message: "Application-side monitoring authorization was revoked by an administrator",
    metadata: { actorId },
  }).catch(() => undefined);
  emitToOwner(targetUserId, "admin:authorization-revoked", { userId: targetUserId, timestamp: new Date().toISOString() });
  return { revoked: true };
}

export async function deleteUserLocationHistory(targetUserId: string, actorId: string, req?: Request): Promise<{ deleted: number }> {
  const devices = await prisma.device.findMany({ where: { ownerId: targetUserId }, select: { id: true } });
  const ids = devices.map((d) => d.id);
  const res = ids.length > 0 ? await prisma.locationEvent.deleteMany({ where: { deviceId: { in: ids } } }) : { count: 0 };
  await recordAudit({ userId: actorId, action: "admin.location_history_deleted", details: { targetUserId, deleted: res.count }, req });
  await recordSecurityEvent({
    userId: targetUserId,
    type: "LOCATION_HISTORY_DELETED",
    severity: "INFO",
    message: "Location history was deleted by an administrator",
    metadata: { actorId, deleted: res.count },
  }).catch(() => undefined);
  return { deleted: res.count };
}

export async function deleteUserSessionData(targetUserId: string, actorId: string, req?: Request): Promise<{ sessions: number; locationSessions: number; events: number }> {
  const devices = await prisma.device.findMany({ where: { ownerId: targetUserId }, select: { id: true } });
  const ids = devices.map((d) => d.id);
  const [sessions, locationSessions, events] = await Promise.all([
    prisma.session.deleteMany({ where: { userId: targetUserId } }),
    ids.length > 0 ? prisma.locationSession.deleteMany({ where: { deviceId: { in: ids } } }) : { count: 0 },
    ids.length > 0 ? prisma.locationEvent.deleteMany({ where: { deviceId: { in: ids } } }) : { count: 0 },
  ]);
  presenceManager.markStopped(ids[0] ?? "");
  await recordAudit({
    userId: actorId,
    action: "admin.session_data_deleted",
    details: { targetUserId, sessions: sessions.count, locationSessions: locationSessions.count, events: events.count },
    req,
  });
  return { sessions: sessions.count, locationSessions: locationSessions.count, events: events.count };
}

export async function getMonitoringState(targetUserId: string): Promise<{ status: string; startedAt: string | null; stoppedAt: string | null } | null> {
  const m = await prisma.monitoringState.findUnique({ where: { userId: targetUserId } });
  if (!m) return null;
  return { status: m.status, startedAt: m.startedAt ? m.startedAt.toISOString() : null, stoppedAt: m.stoppedAt ? m.stoppedAt.toISOString() : null };
}
