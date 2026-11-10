import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { describeProviders, providerStates } from "../providers";
import { providerLimiter } from "../lib/rateLimiter";
import { logger } from "../lib/logger";

/**
 * API health for the dashboard: database status, provider status and
 * last-known provider result state derived from the most recent investigations.
 */
export async function handleHealth(_req: Request, res: Response): Promise<void> {
  let db = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = "error";
  }

  const descriptors = await describeProviders();
  const states = await providerStates();

  // Last known status per provider from the latest 50 investigation results.
  const recent = await prisma.investigation.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { results: true },
  });
  const lastStatus = new Map<string, string>();
  for (const inv of recent) {
    const results = (inv.results ?? []) as { provider: string; status: string }[];
    for (const r of results) if (!lastStatus.has(r.provider)) lastStatus.set(r.provider, r.status);
  }

  const providers = descriptors.map((d) => ({
    name: d.name,
    category: d.category,
    mode: d.mode,
    enabled: states[d.name],
    requiresKey: d.requiresKey,
    lastStatus: lastStatus.get(d.name) ?? "UNKNOWN",
    quota: providerLimiter.usage(d.name),
    healthy: !d.requiresKey || Boolean(process.env[d.requiresKey]) || env.MOCK_MODE,
  }));

  const healthyCount = providers.filter((p) => p.healthy).length;

  res.json({
    status: db === "ok" ? "ok" : "degraded",
    db,
    uptimeSeconds: Math.round(process.uptime()),
    mode: env.MOCK_MODE ? "mock" : "live",
    version: "1.0.0",
    providers,
    providerHealth: `${healthyCount}/${providers.length}`,
    mockProviders: providers.filter((p) => p.mode === "mock").map((p) => p.name),
  });
}

/** ping used by the frontend to detect an authenticated API session. */
export async function handlePing(_req: Request, res: Response): Promise<void> {
  res.json({ ok: true, timestamp: new Date().toISOString() });
}

export async function handleLogDrain(req: Request, res: Response): Promise<void> {
  logger.info({ body: req.body }, "client diagnostic log");
  res.status(204).send();
}
