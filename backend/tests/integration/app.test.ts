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
let adminId = "";
let analystId = "";

const TEST_EMAILS = ["admin@test.local", "analyst@test.local"];

/** Only remove rows the tests created so a shared dev database is left intact. */
async function cleanupScoped(): Promise<void> {
  const users = await prisma.user.findMany({ where: { email: { in: TEST_EMAILS } }, select: { id: true } });
  const ids = users.map((u) => u.id);
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
  const admin = await prisma.user.create({
    data: { email: "admin@test.local", name: "Admin", passwordHash: hash, role: "ADMIN", settings: { create: {} } },
  });
  const analyst = await prisma.user.create({
    data: { email: "analyst@test.local", name: "Analyst", passwordHash: hash, role: "ANALYST", settings: { create: {} } },
  });
  adminId = admin.id;
  analystId = analyst.id;
});

afterAll(async () => {
  if (!ok) return;
  await cleanupScoped();
  await prisma.$disconnect();
});

describeIf("auth", () => {
  it("rejects login with wrong password", async () => {
    const res = await request(api).post("/api/auth/login").send({ email: "admin@test.local", password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("rejects login with unknown user", async () => {
    const res = await request(api).post("/api/auth/login").send({ email: "nobody@test.local", password: "whatever123" });
    expect(res.status).toBe(401);
  });

  it("rejects login with invalid email format", async () => {
    const res = await request(api).post("/api/auth/login").send({ email: "not-an-email", password: "whatever123" });
    expect(res.status).toBe(400);
  });

  it("logs in and returns a token", async () => {
    const res = await request(api).post("/api/auth/login").send({ email: "admin@test.local", password: "AdminTest12345" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe("ADMIN");
    adminToken = res.body.token;
  });

  it("logs in the analyst", async () => {
    const res = await request(api).post("/api/auth/login").send({ email: "analyst@test.local", password: "AdminTest12345" });
    expect(res.status).toBe(200);
    analystToken = res.body.token;
  });

  it("returns me for a valid token", async () => {
    const res = await request(api).get("/api/auth/me").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("admin@test.local");
  });

  it("rejects missing/invalid tokens (401)", async () => {
    expect((await request(api).get("/api/auth/me")).status).toBe(401);
    expect((await request(api).get("/api/auth/me").set("Authorization", "Bearer invalid.token.here")).status).toBe(401);
  });

  it("logs out and revokes the session", async () => {
    const res = await request(api).post("/api/auth/login").send({ email: "admin@test.local", password: "AdminTest12345" });
    const token = res.body.token;
    await request(api).post("/api/auth/logout").set("Authorization", `Bearer ${token}`);
    const me = await request(api).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(401);
  });
});

describeIf("authorization (RBAC)", () => {
  it("analyst cannot toggle providers (403)", async () => {
    const res = await request(api)
      .post("/api/providers/hibp/toggle")
      .set("Authorization", `Bearer ${analystToken}`)
      .send({ enabled: false });
    expect(res.status).toBe(403);
  });

  it("analyst cannot list users (403)", async () => {
    const res = await request(api).get("/api/admin/users").set("Authorization", `Bearer ${analystToken}`);
    expect(res.status).toBe(403);
  });

  it("admin can toggle providers", async () => {
    const res = await request(api)
      .post("/api/providers/hibp/toggle")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ enabled: true });
    expect(res.status).toBe(200);
  });

  it("admin can list users", async () => {
    const res = await request(api).get("/api/admin/users").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeGreaterThanOrEqual(2);
  });
});

describeIf("investigations", () => {
  it("rejects invalid inputs (400)", async () => {
    for (const [type, value] of [
      ["EMAIL", "not-an-email"],
      ["PHONE", "abc"],
      ["IP", "999.1.1.1"],
      ["DOMAIN", "not a domain"],
      ["USERNAME", "x"],
    ] as const) {
      const res = await request(api).post("/api/investigations").set("Authorization", `Bearer ${analystToken}`).send({ type, value });
      expect(res.status).toBe(400);
    }
  });

  it("rejects SQL injection and XSS payloads (400)", async () => {
    const payloads = ["' OR 1=1--", "<script>alert(1)</script>", "x'; DROP TABLE investigations;--@example.com", "<img src=x onerror=alert(1)>"];
    for (const value of payloads) {
      const res = await request(api).post("/api/investigations").set("Authorization", `Bearer ${analystToken}`).send({ type: "EMAIL", value });
      expect(res.status).toBe(400);
    }
  });

  it("creates and completes an email investigation", async () => {
    const res = await request(api).post("/api/investigations").set("Authorization", `Bearer ${analystToken}`).send({ type: "EMAIL", value: "analyst@example.com" });
    expect(res.status).toBe(202);
    expect(res.body.id).toBeTruthy();

    const detail = await request(api).get(`/api/investigations/${res.body.id}`).set("Authorization", `Bearer ${analystToken}`);
    expect(detail.status).toBe(200);
    expect(["COMPLETED", "PARTIAL", "FAILED"]).toContain(detail.body.status);
    expect(Array.isArray(detail.body.results)).toBe(true);
  });

  it("creates an IP investigation", async () => {
    const res = await request(api).post("/api/investigations").set("Authorization", `Bearer ${analystToken}`).send({ type: "IP", value: "8.8.8.8" });
    expect(res.status).toBe(202);
  });

  it("lists investigations for the user", async () => {
    const res = await request(api).get("/api/investigations").set("Authorization", `Bearer ${analystToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);
  });

  it("analyst cannot see another user's investigation (404)", async () => {
    const adminInv = await request(api).post("/api/investigations").set("Authorization", `Bearer ${adminToken}`).send({ type: "EMAIL", value: "admin@example.com" });
    const res = await request(api).get(`/api/investigations/${adminInv.body.id}`).set("Authorization", `Bearer ${analystToken}`);
    expect(res.status).toBe(404);
  });

  it("deletes an investigation", async () => {
    const created = await request(api).post("/api/investigations").set("Authorization", `Bearer ${analystToken}`).send({ type: "USERNAME", value: "alice_test" });
    const del = await request(api).delete(`/api/investigations/${created.body.id}`).set("Authorization", `Bearer ${analystToken}`);
    expect(del.status).toBe(204);
    const get = await request(api).get(`/api/investigations/${created.body.id}`).set("Authorization", `Bearer ${analystToken}`);
    expect(get.status).toBe(404);
  });

  it("exports JSON report", async () => {
    const created = await request(api).post("/api/investigations").set("Authorization", `Bearer ${analystToken}`).send({ type: "EMAIL", value: "export@example.com" });
    const res = await request(api).get(`/api/investigations/${created.body.id}/export`).set("Authorization", `Bearer ${analystToken}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("generates a PDF report payload", async () => {
    const created = await request(api).post("/api/investigations").set("Authorization", `Bearer ${analystToken}`).send({ type: "EMAIL", value: "pdf@example.com" });
    const res = await request(api).get(`/api/investigations/${created.body.id}/report`).set("Authorization", `Bearer ${analystToken}`);
    expect(res.status).toBe(200);
    expect(res.body.report.sources.length).toBeGreaterThanOrEqual(0);
  });
});

describeIf("settings & audit", () => {
  it("reads and updates settings", async () => {
    const res = await request(api).patch("/api/settings").set("Authorization", `Bearer ${analystToken}`).send({ retentionDays: 30, consentAcknowledged: true });
    expect(res.status).toBe(200);
    expect(res.body.retentionDays).toBe(30);
  });

  it("rejects invalid retention value (400)", async () => {
    const res = await request(api).patch("/api/settings").set("Authorization", `Bearer ${analystToken}`).send({ retentionDays: -1 });
    expect(res.status).toBe(400);
  });

  it("lists audit log entries", async () => {
    const res = await request(api).get("/api/audit").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});

describeIf("health", () => {
  it("returns provider health", async () => {
    const res = await request(api).get("/api/health").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.db).toBe("ok");
    expect(res.body.mode).toBe("mock");
    expect(res.body.providers.length).toBeGreaterThan(0);
  });
});
