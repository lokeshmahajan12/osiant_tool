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
let userId = "";
let userToken = "";

const TEST_EMAILS = ["admin@test.local", "analyst@test.local", "user@test.local", "newuser@test.local", "portal@test.local"];

/** Only remove rows the tests created so a shared dev database is left intact. */
async function cleanupScoped(): Promise<void> {
  const users = await prisma.user.findMany({ where: { email: { in: TEST_EMAILS } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.cameraSession.deleteMany({ where: { userId: { in: ids } } });
  await prisma.locationEvent.deleteMany({ where: { device: { ownerId: { in: ids } } } });
  await prisma.locationSession.deleteMany({ where: { userId: { in: ids } } });
  await prisma.consentRecord.deleteMany({ where: { userId: { in: ids } } });
  await prisma.enrollmentToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.device.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.permissionRecord.deleteMany({ where: { userId: { in: ids } } });
  await prisma.monitoringState.deleteMany({ where: { userId: { in: ids } } });
  await prisma.securityEvent.deleteMany({ where: { userId: { in: ids } } });
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

describeIf("self-registration", () => {
  it("registers a USER account with a web device and token", async () => {
    const res = await request(api).post("/api/auth/register").send({
      name: "New User",
      username: "newuser_test",
      email: "newuser@test.local",
      mobile: "+919876543210",
      password: "UserPass12345",
      confirmPassword: "UserPass12345",
      country: "IN",
      state: "MH",
      city: "Pune",
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe("USER");
    expect(res.body.user.email).toBe("newuser@test.local");
    expect(res.body.user.username).toBe("newuser_test");
    expect(res.body.user.mobile).toBe("+919876543210");
    expect(res.body.user.webDevice.id).toBeTruthy();
    expect(res.body.user.webDevice.deviceToken).toMatch(/^sentinel-device-/);
  });

  it("rejects duplicate email (409)", async () => {
    const res = await request(api).post("/api/auth/register").send({
      name: "New User",
      email: "newuser@test.local",
      password: "UserPass12345",
      confirmPassword: "UserPass12345",
    });
    expect(res.status).toBe(409);
  });

  it("rejects duplicate username (409)", async () => {
    const res = await request(api).post("/api/auth/register").send({
      name: "New User",
      username: "newuser_test",
      email: "newuser2@test.local",
      password: "UserPass12345",
      confirmPassword: "UserPass12345",
    });
    expect(res.status).toBe(409);
  });

  it("rejects duplicate mobile (409)", async () => {
    const res = await request(api).post("/api/auth/register").send({
      name: "New User",
      email: "newuser3@test.local",
      mobile: "+919876543210",
      password: "UserPass12345",
      confirmPassword: "UserPass12345",
    });
    expect(res.status).toBe(409);
  });

  it("rejects a weak password (400)", async () => {
    const res = await request(api).post("/api/auth/register").send({
      name: "New User",
      email: "weakpass@test.local",
      password: "weakpass",
      confirmPassword: "weakpass",
    });
    expect(res.status).toBe(400);
  });

  it("rejects mismatched passwords (400)", async () => {
    const res = await request(api).post("/api/auth/register").send({
      name: "New User",
      email: "mismatch@test.local",
      password: "UserPass12345",
      confirmPassword: "UserPass99999",
    });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid mobile number (400)", async () => {
    const res = await request(api).post("/api/auth/register").send({
      name: "New User",
      email: "badmobile@test.local",
      mobile: "12",
      password: "UserPass12345",
      confirmPassword: "UserPass12345",
    });
    expect(res.status).toBe(400);
  });
});

describeIf("unified identifier login", () => {
  it("logs in with username identifier", async () => {
    const res = await request(api).post("/api/auth/login").send({ identifier: "newuser_test", password: "UserPass12345" });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("USER");
  });

  it("logs in with mobile identifier", async () => {
    const res = await request(api).post("/api/auth/login").send({ identifier: "+919876543210", password: "UserPass12345" });
    expect(res.status).toBe(200);
  });

  it("logs in with email identifier", async () => {
    const res = await request(api).post("/api/auth/login").send({ identifier: "newuser@test.local", password: "UserPass12345" });
    expect(res.status).toBe(200);
    userToken = res.body.token;
  });
});

describeIf("permission center", () => {
  it("returns the four default permission records", async () => {
    const res = await request(api).get("/api/permissions").set("Authorization", `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(res.body.permissions).toHaveLength(4);
    for (const p of res.body.permissions) {
      expect(p.state).toBe("NOT_REQUESTED");
    }
  });

  it("records a GRANTED state for LOCATION (uppercase type)", async () => {
    const res = await request(api)
      .post("/api/permissions/LOCATION")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ state: "GRANTED" });
    expect(res.status).toBe(200);
    expect(res.body.permission.type).toBe("LOCATION");
    expect(res.body.permission.state).toBe("GRANTED");
    expect(res.body.permission.grantedAt).toBeTruthy();
  });

  it("rejects unknown permission types (400)", async () => {
    const res = await request(api).post("/api/permissions/WHATEVER").set("Authorization", `Bearer ${userToken}`).send({ state: "GRANTED" });
    expect(res.status).toBe(400);
  });

  it("rejects invalid state values (400)", async () => {
    const res = await request(api).post("/api/permissions/CAMERA").set("Authorization", `Bearer ${userToken}`).send({ state: "SOMETIMES" });
    expect(res.status).toBe(400);
  });
});

describeIf("self summary", () => {
  it("returns identity, permissions, web device and policy", async () => {
    const res = await request(api).get("/api/users/me/summary").set("Authorization", `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(res.body.summary.email).toBe("newuser@test.local");
    expect(res.body.summary.role).toBe("USER");
    expect(res.body.summary.permissions).toHaveLength(4);
    expect(res.body.summary.webDevice.permissionStatus).toBe("GRANTED");
    expect(res.body.summary.settings.consentAcknowledged).toBe(false);
  });
});

describeIf("admin user directory & status", () => {
  it("analyst cannot list the directory (403)", async () => {
    const res = await request(api).get("/api/users").set("Authorization", `Bearer ${analystToken}`);
    expect(res.status).toBe(403);
  });

  it("admin lists the directory including the new user", async () => {
    const res = await request(api).get("/api/users").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const found = res.body.items.find((u: { email: string }) => u.email === "newuser@test.local");
    expect(found).toBeTruthy();
    expect(found.role).toBe("USER");
    userId = found.id;
  });

  it("admin views the full user profile", async () => {
    const res = await request(api).get(`/api/users/${userId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.profile.identity.email).toBe("newuser@test.local");
    expect(res.body.profile.identity.role).toBe("USER");
  });

  it("analyst cannot disable a user (403)", async () => {
    const res = await request(api).patch(`/api/users/${userId}/status`).set("Authorization", `Bearer ${analystToken}`).send({ status: "inactive" });
    expect(res.status).toBe(403);
  });

  it("admin disabling a user revokes their sessions", async () => {
    const res = await request(api).patch(`/api/users/${userId}/status`).set("Authorization", `Bearer ${adminToken}`).send({ status: "inactive" });
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);

    const me = await request(api).get("/api/auth/me").set("Authorization", `Bearer ${userToken}`);
    expect(me.status).toBe(401);
  });

  it("admin re-enables the user", async () => {
    const res = await request(api).patch(`/api/users/${userId}/status`).set("Authorization", `Bearer ${adminToken}`).send({ status: "active" });
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(true);
  });
});

describeIf("admin oversight endpoints", () => {
  it("analyst cannot access the live map (403)", async () => {
    const res = await request(api).get("/api/admin/live-map").set("Authorization", `Bearer ${analystToken}`);
    expect(res.status).toBe(403);
  });

  it("admin live-map returns the users list", async () => {
    const res = await request(api).get("/api/admin/live-map").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
  });

  it("admin audit-logs alias lists entries", async () => {
    const res = await request(api).get("/api/admin/audit-logs").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it("analyst cannot end a user's camera session (403)", async () => {
    const res = await request(api)
      .post(`/api/camera/admin/camera/${userId}/whatever-session/end`)
      .set("Authorization", `Bearer ${analystToken}`);
    expect(res.status).toBe(403);
  });

  it("admin sees no active camera session for the new user", async () => {
    const res = await request(api).get(`/api/camera/admin/camera/${userId}/status`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.session).toBeNull();
  });

  it("admin lists camera sessions", async () => {
    const res = await request(api).get("/api/camera/admin/camera-sessions").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});

describeIf("portal location sharing (dashboard)", () => {
  let portalToken = "";
  let portalId = "";

  it("registers a fresh portal user", async () => {
    const res = await request(api).post("/api/auth/register").send({
      name: "Portal User",
      username: "portal_test",
      email: "portal@test.local",
      mobile: "+919988776655",
      password: "PortalPass123",
      confirmPassword: "PortalPass123",
    });
    expect(res.status).toBe(201);
    portalToken = res.body.token;
    portalId = res.body.user.id;
  });

  it("starts sharing WITHOUT visiting the permission center (consent auto-recorded)", async () => {
    const res = await request(api)
      .post("/api/location/session/start")
      .set("Authorization", `Bearer ${portalToken}`)
      .send({ mode: "NORMAL" });
    expect(res.status).toBe(201);
    expect(res.body.session.mode).toBe("NORMAL");
    expect(res.body.session.id).toBeTruthy();
  });

  it("pushes a location fix from the dashboard", async () => {
    const res = await request(api)
      .post("/api/location/update")
      .set("Authorization", `Bearer ${portalToken}`)
      .send({ latitude: 12.9716, longitude: 77.5946, accuracy: 12.5, altitude: null, speed: null, heading: null });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
  });

  it("exposes the fix to the owner's history", async () => {
    const res = await request(api).get(`/api/location/${portalId}/history?range=1h`).set("Authorization", `Bearer ${portalToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent for repeated start (still 201)", async () => {
    const res = await request(api)
      .post("/api/location/session/start")
      .set("Authorization", `Bearer ${portalToken}`)
      .send({ mode: "HIGH_ACCURACY" });
    expect(res.status).toBe(201);
    expect(res.body.session.mode).toBe("NORMAL"); // existing live session is reused
  });

  it("stops sharing", async () => {
    const res = await request(api).post("/api/location/session/stop").set("Authorization", `Bearer ${portalToken}`);
    expect(res.status).toBe(200);
    expect(res.body.stopped).toBe(true);
  });

  it("admin sees the shared fix on the live map", async () => {
    const res = await request(api).get("/api/admin/live-map").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const entry = res.body.users.find((u: { userId: string }) => u.userId === portalId);
    expect(entry).toBeTruthy();
    expect(entry.latitude).toBeCloseTo(12.9716, 3);
    expect(entry.longitude).toBeCloseTo(77.5946, 3);
  });
});
