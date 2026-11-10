import type { Request, Response } from "express";
import { z } from "zod";
import { ApiError } from "../middleware/errorHandler";
import * as cameraService from "../services/camera.service";

const startSchema = z.object({
  mode: z.enum(["CAPTURE", "LIVE"]).default("CAPTURE"),
});

export async function handleStart(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const body = startSchema.parse(req.body);
  const session = await cameraService.startCameraSession(req.user.id, body.mode, req);
  res.status(201).json({ session });
}

export async function handleEnd(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const result = await cameraService.endCameraSession(req.user.id, req.params.id, { by: "USER", actorId: req.user.id }, req);
  res.json(result);
}

export async function handleMyStatus(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const session = await cameraService.getActiveCameraSession(req.user.id);
  res.json({ session });
}

export async function handleMyHistory(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const limit = Math.min(Number(req.query.limit ?? 20) || 20, 100);
  const offset = Number(req.query.offset ?? 0) || 0;
  const result = await cameraService.listCameraSessionsForUser(req.user.id, { limit, offset });
  res.json(result);
}

/** ADMIN: list all camera sessions. */
export async function handleAdminListSessions(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
  const offset = Number(req.query.offset ?? 0) || 0;
  const result = await cameraService.listAllCameraSessions({ limit, offset });
  res.json(result);
}

/** ADMIN: camera session status for a specific user. */
export async function handleAdminUserStatus(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const session = await cameraService.getCameraStatusForAdmin(req.params.userId);
  res.json({ session });
}

/** ADMIN: end a user's camera session. */
export async function handleAdminEnd(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const result = await cameraService.endCameraSession(
    req.params.userId,
    req.params.sessionId,
    { by: "ADMIN", actorId: req.user.id },
    req
  );
  res.json(result);
}
