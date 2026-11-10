import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createApp } from "../../src/app";
import { prisma } from "../../src/lib/prisma";

async function dbAvailable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

const ok = await dbAvailable();
const describeIf = ok ? describe : describe.skip;

const api = createApp();
let adminToken = "";
let analystToken = "";
let deviceId = "";
let deviceToken = "";

const TEST_EMAILS = ["admin@test.local", "analyst@test.local"];

const validFix = {
  latitude: 18.5204,
  longitude: 73.8567,
  accuracy: 8.5,
  altitude: 560,
  speed: 1.2,
  heading: 45,
  timestamp: new Date().toISOString(),
};

/** Only remove rows the tests created so a shared dev database is left intact. */
async function cleanupScoped(): Promise<void> {
  const users = await prisma.user.findMany({ where: { email: { in: TEST_EMAILS } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.locationEvent.deleteMany({ where: { device: { ownerId: { in: ids } } } });
  await prisma.locationSession.deleteMany({ where: { userId: { in: ids } } });
  await prisma.consentRecord.deleteMany({ where: { userId: { in: ids } } });
  await prisma.enrollmentToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.device.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.investigation.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userSettings.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { in: TEST_EMAILS } } });
}

beforeAll(async () => {
  if (!ok) return;
  await cleanupScoped();

  const hash = await bcrypt.hash("AdminTest12345", 12);
  await prisma.user.create({
    data: { email: "admin@test.local", name: "Admin", passwordHash: hash, role: "ADMIN", settings: { create: {} } },
  });
  await prisma.user.create({
    data: { email: "analyst@test.local", name: "Analyst", passwordHash: hash, role: "ANALYST", settings: { create: {} } },
  });

  const admin = await request(api).post("/api/auth/login").send({ email: "admin@test.local", password: "AdminTest12345" });
  adminToken = admin.body.token;
  const analyst = await request(api).post("/api/auth/login").send({ email: "analyst@test.local", password: "AdminTest12345" });
  analystToken = analyst.body.token;
});

afterAll(async () => {
  if (!ok) return;
  await cleanupScoped();
  await prisma.$disconnect();
});

describeIf("device enrollment", () => {
  it("analyst cannot enroll devices (403)", async () => {
    const res = await request(api).post("/api/devices").set("Authorization", `Bearer ${analystToken}`).send({ name: "Sneaky", platform: "ANDROID" });
    expect(res.status).toBe(403);
  });

  it("rejects unauthenticated enrollment (401)", async () => {
    const res = await request(api).post("/api/devices").send({ name: "Ghost", platform: "WEB" });
    expect(res.status).toBe(401);
  });

  it("enrolls a device and returns a one-time token", async () => {
    const res = await request(api).post("/api/devices").set("Authorization", `Bearer ${adminToken}`).send({ name: "Analyst Phone", platform: "ANDROID" });
    expect(res.status).toBe(201);
    expect(res.body.deviceId).toBeTruthy();
    expect(res.body.deviceToken).toMatch(/^sentinel-device-/);
    deviceId = res.body.deviceId;
    deviceToken = res.body.deviceToken;
  });

  it("rejects blank device names (400)", async () => {
    const res = await request(api).post("/api/devices").set("Authorization", `Bearer ${adminToken}`).send({ name: "  " });
    expect(res.status).toBe(400);
  });
});

describeIf("device authentication", () => {
  it("rejects pushes without a token (401)", async () => {
    const res = await request(api).post(`/api/devices/${deviceId}/location`).send(validFix);
    expect(res.status).toBe(401);
  });

  it("rejects invalid device tokens (401)", async () => {
    const res = await request(api).post(`/api/devices/${deviceId}/location`).set("X-Device-Token", "sentinel-device-invalid").send(validFix);
    expect(res.status).toBe(401);
  });

  it("returns device self-info", async () => {
    const res = await request(api).get("/api/devices/me").set("X-Device-Token", deviceToken);
    expect(res.status).toBe(200);
    expect(res.body.device.id).toBe(deviceId);
    expect(res.body.device.sharing).toBe(false);
    expect(res.body.device.consentGranted).toBe(false);
  });
});

describeIf("consent gating", () => {
  it("rejects start without explicit consent (403)", async () => {
    const res = await request(api).post(`/api/devices/${deviceId}/location/start`).set("X-Device-Token", deviceToken).send({ mode: "NORMAL" });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/consent required/i);
  });

  it("rejects pushes while not sharing (403)", async () => {
    const res = await request(api).post(`/api/devices/${deviceId}/location`).set("X-Device-Token", deviceToken).send(validFix);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/not active/i);
  });

  it("records consent", async () => {
    const res = await request(api).post(`/api/devices/${deviceId}/location/consent`).set("X-Device-Token", deviceToken).send({ consentVersion: "1.0" });
    expect(res.status).toBe(201);
    expect(res.body.consent.consentVersion).toBe("1.0");
  });

  it("is idempotent for repeated consent", async () => {
    const res = await request(api).post(`/api/devices/${deviceId}/location/consent`).set("X-Device-Token", deviceToken).send({});
    expect(res.status).toBe(201);
  });
});

describeIf("location sharing", () => {
  it("starts sharing", async () => {
    const res = await request(api).post(`/api/devices/${deviceId}/location/start`).set("X-Device-Token", deviceToken).send({ mode: "HIGH_ACCURACY", intervalMs: 6000 });
    expect(res.status).toBe(201);
    expect(res.body.session.mode).toBe("HIGH_ACCURACY");
    expect(res.body.session.intervalMs).toBeGreaterThanOrEqual(5000);
  });

  it("is idempotent for repeated start", async () => {
    const res = await request(api).post(`/api/devices/${deviceId}/location/start`).set("X-Device-Token", deviceToken).send({ mode: "NORMAL" });
    expect(res.status).toBe(201);
  });

  it("accepts a valid fix", async () => {
    const res = await request(api).post(`/api/devices/${deviceId}/location`).set("X-Device-Token", deviceToken).send(validFix);
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
  });

  it("accepts a heartbeat while the session is active", async () => {
    const res = await request(api).put(`/api/devices/${deviceId}/heartbeat`).set("X-Device-Token", deviceToken);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.sharingActive).toBe(true);
    expect(res.body.timestamp).toBeTruthy();
  });

  it("rejects an invalid fix (400)", async () => {
    const res = await request(api).post(`/api/devices/${deviceId}/location`).set("X-Device-Token", deviceToken).send({ ...validFix, latitude: 999 });
    expect(res.status).toBe(400);
  });

  it("rejects a fix that is too old (400)", async () => {
    const stale = { ...validFix, timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString() };
    const res = await request(api).post(`/api/devices/${deviceId}/location`).set("X-Device-Token", deviceToken).send(stale);
    expect(res.status).toBe(400);
  });

  it("shows status as LIVE with a last known fix", async () => {
    const res = await request(api).get(`/api/devices/${deviceId}/location/status`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status.sharing).toBe("LIVE");
    expect(res.body.status.lastKnown.latitude).toBe(validFix.latitude);
    expect(res.body.status.consent.consentVersion).toBe("1.0");
  });

  it("returns location history", async () => {
    const res = await request(api).get(`/api/devices/${deviceId}/location/history?range=24h`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].longitude).toBe(validFix.longitude);
  });

  it("exports history as CSV", async () => {
    const res = await request(api).get(`/api/devices/${deviceId}/location/history/export?range=24h&format=csv`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text).toContain(String(validFix.latitude));
  });

  it("hides other users' devices (404)", async () => {
    const res = await request(api).get(`/api/devices/${deviceId}/location/status`).set("Authorization", `Bearer ${analystToken}`);
    expect(res.status).toBe(404);
  });

  it("stops sharing", async () => {
    const res = await request(api).post(`/api/devices/${deviceId}/location/stop`).set("X-Device-Token", deviceToken);
    expect(res.status).toBe(200);
    expect(res.body.stopped).toBe(true);
  });

  it("rejects pushes after stop (403)", async () => {
    const res = await request(api).post(`/api/devices/${deviceId}/location`).set("X-Device-Token", deviceToken).send(validFix);
    expect(res.status).toBe(403);
  });

  it("reports ok:false on heartbeat when no session is active", async () => {
    const res = await request(api).put(`/api/devices/${deviceId}/heartbeat`).set("X-Device-Token", deviceToken);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.sharingActive).toBe(false);
  });

  it("shows status as OFF after stop", async () => {
    const res = await request(api).get(`/api/devices/${deviceId}/location/status`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status.sharing).toBe("OFF");
  });
});

describeIf("device lifecycle", () => {
  it("deactivating a device invalidates its token", async () => {
    const res = await request(api).patch(`/api/devices/${deviceId}`).set("Authorization", `Bearer ${adminToken}`).send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.device.isActive).toBe(false);

    const push = await request(api).post(`/api/devices/${deviceId}/location`).set("X-Device-Token", deviceToken).send(validFix);
    expect(push.status).toBe(401);
  });

  it("re-enables and deletes the device", async () => {
    await request(api).patch(`/api/devices/${deviceId}`).set("Authorization", `Bearer ${adminToken}`).send({ isActive: true });
    const del = await request(api).delete(`/api/devices/${deviceId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(del.status).toBe(204);

    const me = await request(api).get("/api/devices/me").set("X-Device-Token", deviceToken);
    expect(me.status).toBe(401);
  });
});
