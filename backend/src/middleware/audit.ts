import type { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";

/**
 * Persist an audit-log entry. Sensitive fields (passwords, tokens) are never
 * written; `details` must be a plain metadata object.
 */
export async function recordAudit(opts: {
  userId?: string;
  investigationId?: string;
  action: string;
  details?: Record<string, unknown>;
  req?: Request;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: opts.userId,
        investigationId: opts.investigationId,
        action: opts.action,
        details: (opts.details ?? {}) as object,
        ip: opts.req?.ip,
        userAgent: opts.req?.get("user-agent")?.slice(0, 300),
      },
    });
  } catch (err) {
    logger.warn({ err }, "failed to persist audit log");
  }
}

/** Convenience wrapper to use as an Express handler for audited actions. */
export function audit(action: string, details?: (req: Request) => Record<string, unknown>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    void recordAudit({
      userId: req.user?.id,
      investigationId: (req.params.id as string | undefined) ?? (req.body.investigationId as string | undefined),
      action,
      details: details?.(req),
      req,
    });
    next();
  };
}
