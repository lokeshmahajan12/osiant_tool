import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { ApiError } from "../middleware/errorHandler";

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  action: z.string().optional(),
});

export async function handleListAudit(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const isAdmin = req.user.role === "ADMIN";
  const query = auditQuerySchema.parse(req.query);

  const where = {
    ...(isAdmin ? {} : { userId: req.user.id }),
    ...(query.action ? { action: query.action } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: query.limit,
      skip: query.offset,
      select: { id: true, action: true, details: true, ip: true, userAgent: true, createdAt: true, user: { select: { email: true } }, investigationId: true },
    }),
    prisma.auditLog.count({ where }),
  ]);

  res.json({ items, total });
}
