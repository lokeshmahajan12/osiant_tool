import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";

/**
 * Append-only security event log. Used for login failures, forced logouts,
 * permission/monitoring changes and other security-relevant activity. Failures
 * to persist are logged but never crash the request.
 */
export async function recordSecurityEvent(opts: {
  userId?: string;
  type: string;
  severity?: "INFO" | "WARN" | "CRITICAL";
  message: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}): Promise<void> {
  try {
    await prisma.securityEvent.create({
      data: {
        userId: opts.userId ?? null,
        type: opts.type,
        severity: opts.severity ?? "INFO",
        message: opts.message,
        metadata: (opts.metadata ?? {}) as object,
        ip: opts.ip,
      },
    });
  } catch (err) {
    logger.warn({ err }, "failed to persist security event");
  }
}

export async function listSecurityEvents(params: {
  userId?: string;
  type?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: unknown[]; total: number }> {
  const where = {
    ...(params.userId ? { userId: params.userId } : {}),
    ...(params.type ? { type: params.type } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.securityEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(params.limit ?? 50, 200),
      skip: params.offset ?? 0,
    }),
    prisma.securityEvent.count({ where }),
  ]);
  return { items, total };
}
