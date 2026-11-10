import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { ApiError } from "../middleware/errorHandler";
import { recordAudit } from "../middleware/audit";
import { purgeExpiredInvestigations } from "../services/investigation.service";
import { env } from "../config/env";

const settingsSchema = z.object({
  retentionDays: z.number().int().min(1).max(3650).optional(),
  autoPurge: z.boolean().optional(),
  consentAcknowledged: z.boolean().optional(),
});

/** Read-only platform data policies surfaced to the UI (retention, TTL, presence thresholds). */
function policies() {
  return {
    locationRetentionHours: env.LOCATION_RETENTION_HOURS,
    locationSessionTtlHours: Math.round(env.LOCATION_SESSION_TTL_MS / (60 * 60_000)),
    locationStaleThresholdMs: env.LOCATION_STALE_THRESHOLD_MS,
    locationOfflineThresholdMs: env.LOCATION_OFFLINE_THRESHOLD_MS,
  };
}

export async function handleGetSettings(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const settings = await prisma.userSettings.findUnique({ where: { userId: req.user.id } });
  res.json({
    ...(settings ?? { retentionDays: 90, autoPurge: false, consentAcknowledged: false }),
    policies: policies(),
  });
}

export async function handleUpdateSettings(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const body = settingsSchema.parse(req.body);
  const settings = await prisma.userSettings.upsert({
    where: { userId: req.user.id },
    update: body,
    create: { userId: req.user.id, ...body },
  });

  if (body.autoPurge === true) {
    await purgeExpiredInvestigations();
  }

  await recordAudit({ userId: req.user.id, action: "settings.updated", details: { retentionDays: body.retentionDays, autoPurge: body.autoPurge }, req });
  res.json(settings);
}
