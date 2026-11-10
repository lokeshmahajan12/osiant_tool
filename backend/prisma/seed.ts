import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { env } from "../src/config/env";

const prisma = new PrismaClient();

async function main() {
  const rounds = env.BCRYPT_ROUNDS;

  const adminHash = await bcrypt.hash(env.ADMIN_PASSWORD, rounds);
  const admin = await prisma.user.upsert({
    where: { email: env.ADMIN_EMAIL },
    update: {},
    create: {
      email: env.ADMIN_EMAIL,
      passwordHash: adminHash,
      name: "System Administrator",
      role: "ADMIN",
      settings: { create: { consentAcknowledged: true } },
    },
  });

  if (env.DEMO_ENABLED) {
    const demoHash = await bcrypt.hash("demo1234", rounds);
    await prisma.user.upsert({
      where: { email: "analyst@sentinel.local" },
      update: {},
      create: {
        email: "analyst@sentinel.local",
        passwordHash: demoHash,
        name: "Demo Analyst",
        role: "ANALYST",
        settings: { create: { consentAcknowledged: true } },
      },
    });
    await prisma.user.upsert({
      where: { email: "investigator@sentinel.local" },
      update: {},
      create: {
        email: "investigator@sentinel.local",
        passwordHash: demoHash,
        name: "Demo Investigator",
        role: "INVESTIGATOR",
        settings: { create: { consentAcknowledged: true } },
      },
    });

    // Demo end-user (USER role) — username/mobile/registration demo credentials.
    const demoUser = await prisma.user.upsert({
      where: { email: "user@sentinel.local" },
      update: {},
      create: {
        email: "user@sentinel.local",
        username: "sentineluser",
        mobile: "+919876543210",
        passwordHash: demoHash,
        name: "Demo End User",
        role: "USER",
        country: "India",
        state: "Karnataka",
        city: "Bengaluru",
        settings: { create: { consentAcknowledged: true } },
        permissions: {
          create: [
            { type: "LOCATION", state: "NOT_REQUESTED" },
            { type: "CAMERA", state: "NOT_REQUESTED" },
            { type: "MICROPHONE", state: "NOT_REQUESTED" },
            { type: "NOTIFICATIONS", state: "NOT_REQUESTED" },
          ],
        },
      },
    });

    // Give the demo end-user a web-browser device so the user portal can share
    // location through the same consent-based device pipeline as enrolled devices.
    const existingWebDevice = await prisma.device.findFirst({
      where: { ownerId: demoUser.id, platform: "WEB" },
    });
    if (!existingWebDevice) {
      const crypto = await import("node:crypto");
      await prisma.device.create({
        data: {
          ownerId: demoUser.id,
          name: "Web Browser",
          platform: "WEB",
          status: "OFFLINE",
          locationSharing: false,
          permissionStatus: "UNKNOWN",
          deviceTokenHash: crypto.createHash("sha256").update(`sentinel-demo-user-${demoUser.id}`).digest("hex"),
        },
      });
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[seed] Admin ready: ${admin.email}${env.DEMO_ENABLED ? " | demo users enabled" : ""}`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[seed] failed", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
