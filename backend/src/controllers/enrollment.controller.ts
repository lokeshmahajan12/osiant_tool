import type { Request, Response } from "express";
import { z } from "zod";
import { ApiError } from "../middleware/errorHandler";
import * as service from "../services/enrollment.service";

const PLATFORMS = ["ANDROID", "IOS", "WEB", "OTHER"] as const;

const createSchema = z.object({
  purpose: z.string().trim().max(200).optional(),
  deviceName: z.string().trim().min(1, "Device name is required").max(80),
  platform: z.enum(PLATFORMS).optional(),
  phone: z.string().trim().max(20).optional(),
  ttlMinutes: z.coerce.number().int().min(1).max(10080).optional(),
});

const redeemSchema = z.object({
  deviceName: z.string().trim().min(1).max(80).optional(),
  platform: z.enum(PLATFORMS).optional(),
  browser: z.string().trim().max(120).optional(),
  os: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(20).optional(),
  isTestDevice: z.boolean().optional().default(false),
});

function requireUser(req: Request): { id: string; role: string } {
  if (!req.user) throw new ApiError(401, "Authentication required");
  return req.user;
}

export async function handleCreate(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = createSchema.parse(req.body);
  const link = await service.createEnrollment(user.id, {
    purpose: body.purpose,
    deviceName: body.deviceName,
    platform: body.platform,
    phone: body.phone,
    ttlMs: body.ttlMinutes !== undefined ? body.ttlMinutes * 60_000 : undefined,
  });
  res.status(201).json({ enrollment: link });
}

export async function handleList(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const enrollments = await service.listEnrollments(user.id, user.role === "ADMIN");
  res.json({ enrollments });
}

export async function handleRevoke(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const result = await service.revokeEnrollment(user.id, user.role === "ADMIN", req.params.id);
  res.json(result);
}

/** Public: metadata shown on the enrollment page. */
export async function handleGetInfo(req: Request, res: Response): Promise<void> {
  const info = await service.getEnrollmentInfo(req.params.token);
  res.json({ enrollment: info });
}

/** Public: redeem the single-use token and register the authorized device. */
export async function handleRedeem(req: Request, res: Response): Promise<void> {
  const body = redeemSchema.parse(req.body);
  const result = await service.redeemEnrollment(req.params.token, body);
  res.status(201).json(result);
}
