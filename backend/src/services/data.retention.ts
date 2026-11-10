import { prisma } from "../lib/prisma";
import { emitToOwner } from "../lib/ws";
import { recordAudit } from "../middleware/audit";
import { presenceManager } from "./location.presence";
import { env } from "../config/env";
import { logger } from "../lib/logger";

let timer: NodeJS.Timeout | null = null;

/**
 * Automatic data expiration for the live-location domain:
 *  1. Location history is deleted once older than `LOCATION_RETENTION_HOURS`
 *     (location data is never retained permanently by default).
 *  2. Active sharing sessions older than `LOCATION_SESSION_TTL_MS` are expired,
 *     which stops sharing and emits `session:expired`.
 *
 * Runs once on boot and then on `LOCATION_RETENTION_SWEEP_MS`.
 */
export async function runRetentionSweep(): Promise<{ purged: number; expired: number }> {
  const cutoff = new Date(Date.now() - env.LOCATION_RETENTION_HOURS * 60 * 60_000);
  const expiredCutoff = new Date(Date.now() - env.LOCATION_SESSION_TTL_MS);
  let purged = 0;
  let expired = 0;

  try {
    const res = await prisma.locationEvent.deleteMany({ where: { timestamp: { lt: cutoff } } });
    purged = res.count;
    if (purged > 0) {
      await recordAudit({
        action: "LOCATION_HISTORY_AUTO_PURGED",
        details: { deleted: purged, olderThan: cutoff.toISOString(), retentionHours: env.LOCATION_RETENTION_HOURS },
      });
      logger.info({ purged, retentionHours: env.LOCATION_RETENTION_HOURS }, "location history auto-purged");
    }
  } catch (err) {
    logger.warn({ err }, "location history purge failed");
  }

  try {
    const sessions = await prisma.locationSession.findMany({
      where: { status: "ACTIVE", startedAt: { lt: expiredCutoff } },
      include: { device: true },
    });
    for (const session of sessions) {
      const stoppedAt = new Date();
      await prisma.locationSession.update({ where: { id: session.id }, data: { status: "STOPPED", stoppedAt } });
      await prisma.consentRecord.updateMany({ where: { deviceId: session.deviceId, revokedAt: null }, data: { revokedAt: stoppedAt } });
      await prisma.device.update({
        where: { id: session.deviceId },
        data: { locationSharing: false, status: "OFFLINE" },
      });
      presenceManager.markStopped(session.deviceId);
      emitToOwner(session.userId, "session:expired", {
        deviceId: session.deviceId,
        sessionId: session.id,
        timestamp: stoppedAt.toISOString(),
      });
      emitToOwner(session.userId, "device:expired", {
        deviceId: session.deviceId,
        sessionId: session.id,
        timestamp: stoppedAt.toISOString(),
      });
      emitToOwner(session.userId, "location:stopped", {
        deviceId: session.deviceId,
        sessionId: session.id,
        stoppedAt: stoppedAt.toISOString(),
      });
      await recordAudit({
        userId: session.userId,
        action: "LOCATION_SESSION_EXPIRED",
        details: { deviceId: session.deviceId, sessionId: session.id },
      }).catch(() => undefined);
      expired += 1;
    }
    if (expired > 0) {
      logger.info({ expired }, "expired stale location-sharing sessions");
    }
  } catch (err) {
    logger.warn({ err }, "session expiry sweep failed");
  }

  return { purged, expired };
}

export function startRetentionSweeper(): void {
  if (timer) return;
  void runRetentionSweep();
  timer = setInterval(() => void runRetentionSweep(), env.LOCATION_RETENTION_SWEEP_MS);
  timer.unref?.();
}

export function stopRetentionSweeper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
