import type { Request, Response } from "express";
import { z } from "zod";
import { ApiError } from "../middleware/errorHandler";
import { listUserPermissions, updateUserPermission, PERMISSION_TYPES } from "../services/permission.service";

const updateSchema = z.object({
  state: z.enum(["NOT_REQUESTED", "GRANTED", "DENIED", "REVOKED", "UNAVAILABLE"]),
});

/** The user's own permission center state (all four permission types). */
export async function handleGetMyPermissions(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const permissions = await listUserPermissions(req.user.id);
  res.json({ permissions });
}

/** Record a browser/OS permission state change reported by the user's device. */
export async function handleUpdatePermission(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const type = req.params.type as string;
  if (!PERMISSION_TYPES.includes(type as (typeof PERMISSION_TYPES)[number])) {
    throw new ApiError(400, "Unknown permission type", "VALIDATION_ERROR");
  }
  const body = updateSchema.parse(req.body);
  const permission = await updateUserPermission(req.user.id, type as (typeof PERMISSION_TYPES)[number], body.state, req);
  res.json({ permission });
}
