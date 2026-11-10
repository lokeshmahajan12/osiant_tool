import { describe, expect, it, afterAll } from "vitest";
import { deriveDeviceStatus, DEVICE_STATUS, PERMISSION_STATUS } from "../../src/services/location.service";
import { presenceManager } from "../../src/services/location.presence";
import { env } from "../../src/config/env";

afterAll(() => {
  presenceManager.stop();
});

describe("deriveDeviceStatus", () => {
  it("lets permission-denied states always win", () => {
    expect(
      deriveDeviceStatus({ permissionStatus: PERMISSION_STATUS.DENIED, isLive: true, online: true })
    ).toBe(DEVICE_STATUS.PERMISSION_DENIED);
    expect(
      deriveDeviceStatus({ permissionStatus: PERMISSION_STATUS.REVOKED, isLive: true, online: true })
    ).toBe(DEVICE_STATUS.PERMISSION_REVOKED);
  });

  it("reports LOCATION_ON when a live session has fresh fixes", () => {
    expect(
      deriveDeviceStatus({ permissionStatus: PERMISSION_STATUS.GRANTED, isLive: true, online: true })
    ).toBe(DEVICE_STATUS.LOCATION_ON);
  });

  it("reports STALE when a live session has stale fixes", () => {
    expect(
      deriveDeviceStatus({ permissionStatus: PERMISSION_STATUS.GRANTED, isLive: true, online: true, stale: true })
    ).toBe(DEVICE_STATUS.STALE);
  });

  it("reports OFFLINE for a live session with no presence", () => {
    expect(
      deriveDeviceStatus({ permissionStatus: PERMISSION_STATUS.GRANTED, isLive: true, online: false })
    ).toBe(DEVICE_STATUS.OFFLINE);
  });

  it("reports ONLINE/OFFLINE when no session is live", () => {
    expect(
      deriveDeviceStatus({ permissionStatus: PERMISSION_STATUS.GRANTED, isLive: false, online: true })
    ).toBe(DEVICE_STATUS.ONLINE);
    expect(
      deriveDeviceStatus({ permissionStatus: PERMISSION_STATUS.GRANTED, isLive: false, online: false })
    ).toBe(DEVICE_STATUS.OFFLINE);
  });
});

describe("presenceManager stage ladder", () => {
  it("starts devices as OFFLINE before any fix", () => {
    presenceManager.register("dev-unknown", "owner-1", 15_000);
    expect(presenceManager.stageOf("dev-unknown", Date.now())).toBe("OFFLINE");
  });

  it("is LIVE for a fresh fix", () => {
    const now = Date.now();
    presenceManager.noteFix("dev-live", "owner-1", now);
    expect(presenceManager.stageOf("dev-live", now)).toBe("LIVE");
    expect(presenceManager.isOnline("dev-live", now)).toBe(true);
    expect(presenceManager.isStale("dev-live", now)).toBe(false);
  });

  it("is STALE once the stale threshold is exceeded but not offline", () => {
    const now = Date.now();
    const staleAt = now - env.LOCATION_STALE_THRESHOLD_MS - 1_000;
    const stillInOffline = now - env.LOCATION_OFFLINE_THRESHOLD_MS + 1_000;
    presenceManager.noteFix("dev-stale", "owner-1", staleAt);
    expect(presenceManager.stageOf("dev-stale", staleAt)).toBe("STALE");
    expect(presenceManager.isOnline("dev-stale", stillInOffline)).toBe(true);
    expect(presenceManager.isStale("dev-stale", staleAt)).toBe(true);
  });

  it("is OFFLINE once the offline threshold is exceeded", () => {
    const now = Date.now();
    const offlineAt = now - env.LOCATION_OFFLINE_THRESHOLD_MS - 1_000;
    presenceManager.noteFix("dev-off", "owner-1", offlineAt);
    expect(presenceManager.stageOf("dev-off", offlineAt)).toBe("OFFLINE");
    expect(presenceManager.isOnline("dev-off", offlineAt)).toBe(false);
  });

  it("bases the offline bound on the active update interval when larger", () => {
    const now = Date.now();
    presenceManager.register("dev-slow", "owner-1", 60_000);
    // 60s interval => offline bound = max(interval*3, 20s, env) >= 180s.
    const age = env.LOCATION_OFFLINE_THRESHOLD_MS + 5_000; // still under 180s
    const fixAt = now - age;
    presenceManager.noteFix("dev-slow", "owner-1", fixAt);
    const stage = presenceManager.stageOf("dev-slow", fixAt);
    expect(["STALE", "LIVE"]).toContain(stage);
    expect(stage).not.toBe("OFFLINE");
  });
});
