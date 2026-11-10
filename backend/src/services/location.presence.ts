import { prisma } from "../lib/prisma";
import { emitToOwner } from "../lib/ws";
import { recordAudit } from "../middleware/audit";
import { env } from "../config/env";
import { logger } from "../lib/logger";

/** LIVE = fresh fix; STALE = no fix for a while; OFFLINE = threshold exceeded. */
export type PresenceStage = "LIVE" | "STALE" | "OFFLINE";

interface DevicePresence {
  ownerId: string;
  lastSeenAt: number;
  online: boolean;
  stage: PresenceStage;
  intervalMs: number;
}

/**
 * Tracks device on/offline state in memory and drives the LIVE -> STALE ->
 * OFFLINE ladder. A session goes STALE when no verified fix arrives within
 * `max(intervalMs * 2, LOCATION_STALE_THRESHOLD_MS)` and OFFLINE within
 * `max(intervalMs * 3, LOCATION_OFFLINE_THRESHOLD_MS)`.
 *
 * Emits both the project's `device:*` events (dashboard) and the documented
 * `session:*` aliases (consent/OSINT event contract).
 */
class PresenceManager {
  private readonly devices = new Map<string, DevicePresence>();
  private timer: NodeJS.Timeout | null = null;

  /** Seed presence from active sessions on startup. */
  async start(): Promise<void> {
    try {
      const sessions = await prisma.locationSession.findMany({
        where: { status: "ACTIVE" },
        include: { device: true },
      });
      for (const s of sessions) {
        this.devices.set(s.deviceId, {
          ownerId: s.userId,
          lastSeenAt: s.device.lastSeenAt?.getTime() ?? Date.now(),
          online: false,
          stage: "OFFLINE",
          intervalMs: s.intervalMs,
        });
      }
      if (sessions.length > 0) {
        logger.info({ devices: sessions.length }, "presence seeded from active sessions");
      }
    } catch (err) {
      logger.warn({ err }, "failed to seed presence from database");
    }
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => void this.check(), 5000);
    this.timer.unref?.();
  }

  /** Register or update session metadata (called on session start). */
  register(deviceId: string, ownerId: string, intervalMs: number): void {
    const existing = this.devices.get(deviceId);
    this.devices.set(deviceId, {
      ownerId,
      intervalMs,
      lastSeenAt: existing?.lastSeenAt ?? Date.now(),
      online: existing?.online ?? false,
      stage: existing?.stage ?? "OFFLINE",
    });
  }

  /**
   * A verified fix (or heartbeat) arrived. Moves the device back up the ladder:
   * OFFLINE -> LIVE (emits `device:online`) and STALE -> LIVE (emits
   * `device:live` / `session:live`).
   */
  noteFix(deviceId: string, ownerId: string, atMs: number): void {
    const existing = this.devices.get(deviceId);
    const wasOnline = existing?.online ?? false;
    const wasStage = existing?.stage ?? "OFFLINE";
    this.devices.set(deviceId, {
      ownerId,
      intervalMs: existing?.intervalMs ?? 15_000,
      lastSeenAt: atMs,
      online: true,
      stage: "LIVE",
    });
    if (!wasOnline) {
      emitToOwner(ownerId, "device:online", { deviceId, timestamp: new Date(atMs).toISOString() });
      emitToOwner(ownerId, "device:connected", { deviceId, timestamp: new Date(atMs).toISOString() });
      emitToOwner(ownerId, "session:live", { deviceId, timestamp: new Date(atMs).toISOString() });
      void prisma.device
        .update({ where: { id: deviceId }, data: { status: "LOCATION_ON", locationSharing: true } })
        .catch(() => undefined);
    } else if (wasStage === "STALE") {
      emitToOwner(ownerId, "device:live", { deviceId, timestamp: new Date(atMs).toISOString() });
      emitToOwner(ownerId, "session:live", { deviceId, timestamp: new Date(atMs).toISOString() });
      void prisma.device
        .update({ where: { id: deviceId }, data: { status: "LOCATION_ON" } })
        .catch(() => undefined);
      void recordAudit({ userId: ownerId, action: "SESSION_REFRESHED", details: { deviceId } }).catch(() => undefined);
    }
  }

  /** Update the interval used to compute the offline threshold. */
  setInterval(deviceId: string, intervalMs: number): void {
    const d = this.devices.get(deviceId);
    if (d) d.intervalMs = intervalMs;
  }

  /** Session stopped — the device is no longer sharing. */
  markStopped(deviceId: string): void {
    const d = this.devices.get(deviceId);
    if (d) d.online = false;
  }

  /** Current presence stage for a device (or OFFLINE when unknown). */
  stageOf(deviceId: string, lastSeenAtMs: number | null): PresenceStage {
    if (!lastSeenAtMs) return "OFFLINE";
    const d = this.devices.get(deviceId);
    if (d?.stage === "OFFLINE") return "OFFLINE";
    const age = Date.now() - lastSeenAtMs;
    if (age > this.offlineThreshold(d)) return "OFFLINE";
    if (age > this.staleThreshold(d)) return "STALE";
    return "LIVE";
  }

  private staleThreshold(d: DevicePresence | undefined): number {
    return Math.max(d?.intervalMs ?? 15_000, env.LOCATION_STALE_THRESHOLD_MS);
  }

  private offlineThreshold(d: DevicePresence | undefined): number {
    return Math.max((d?.intervalMs ?? 15_000) * 3, 20_000, env.LOCATION_OFFLINE_THRESHOLD_MS);
  }

  isOnline(deviceId: string, lastSeenAtMs: number | null): boolean {
    return this.stageOf(deviceId, lastSeenAtMs) !== "OFFLINE";
  }

  isStale(deviceId: string, lastSeenAtMs: number | null): boolean {
    return this.stageOf(deviceId, lastSeenAtMs) === "STALE";
  }

  private check(): void {
    const now = Date.now();
    for (const [deviceId, d] of this.devices) {
      if (!d.online) continue;
      const staleAt = now - this.staleThreshold(d);
      const offlineAt = now - this.offlineThreshold(d);
      if (d.lastSeenAt <= offlineAt) {
        // STALE -> OFFLINE
        d.online = false;
        d.stage = "OFFLINE";
        emitToOwner(d.ownerId, "device:offline", { deviceId, lastSeenAt: new Date(d.lastSeenAt).toISOString() });
        emitToOwner(d.ownerId, "device:disconnected", { deviceId, lastSeenAt: new Date(d.lastSeenAt).toISOString() });
        emitToOwner(d.ownerId, "session:offline", { deviceId, lastSeenAt: new Date(d.lastSeenAt).toISOString() });
        void prisma.device
          .update({ where: { id: deviceId }, data: { status: "OFFLINE" } })
          .catch(() => undefined);
        void recordAudit({
          userId: d.ownerId,
          action: "SESSION_OFFLINE",
          details: { deviceId, lastSeenAt: new Date(d.lastSeenAt).toISOString() },
        }).catch(() => undefined);
        logger.info({ deviceId }, "device went offline");
      } else if (d.lastSeenAt <= staleAt && d.stage === "LIVE") {
        // LIVE -> STALE
        d.stage = "STALE";
        emitToOwner(d.ownerId, "device:stale", { deviceId, lastSeenAt: new Date(d.lastSeenAt).toISOString() });
        emitToOwner(d.ownerId, "session:stale", { deviceId, lastSeenAt: new Date(d.lastSeenAt).toISOString() });
        void prisma.device
          .update({ where: { id: deviceId }, data: { status: "STALE" } })
          .catch(() => undefined);
        void recordAudit({
          userId: d.ownerId,
          action: "SESSION_STALE",
          details: { deviceId, lastSeenAt: new Date(d.lastSeenAt).toISOString() },
        }).catch(() => undefined);
        logger.info({ deviceId }, "device became stale");
      }
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const presenceManager = new PresenceManager();
