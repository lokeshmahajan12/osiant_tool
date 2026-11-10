import type { Request, Response } from "express";
import { z } from "zod";
import { ApiError } from "../middleware/errorHandler";
import { getUserProfile, getUserSelfSummary, listUsersForAdmin } from "../services/user.service";
import { setUserActive } from "../services/auth.service";
import { recordAudit } from "../middleware/audit";

const statusSchema = z.object({
  status: z.enum(["active", "inactive"]),
});

/** ADMIN: searchable, filterable, paginated user directory. */
export async function handleDirectory(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const result = await listUsersForAdmin({
    search: typeof req.query.search === "string" ? req.query.search : undefined,
    role: typeof req.query.role === "string" ? req.query.role : undefined,
    status: typeof req.query.status === "string" ? req.query.status : undefined,
    online: typeof req.query.online === "string" ? req.query.online : undefined,
    sharing: typeof req.query.sharing === "string" ? req.query.sharing : undefined,
    permission: typeof req.query.permission === "string" ? req.query.permission : undefined,
    recent: typeof req.query.recent === "string" ? req.query.recent : undefined,
    sort: typeof req.query.sort === "string" ? req.query.sort : undefined,
    order: typeof req.query.order === "string" ? req.query.order : undefined,
    limit: Number(req.query.limit ?? 50),
    offset: Number(req.query.offset ?? 0),
  });
  await recordAudit({ userId: req.user.id, action: "admin.directory_viewed", details: { count: result.items.length }, req });
  res.json(result);
}

/** ADMIN: full intelligence profile for a single user. */
export async function handleUserProfile(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const profile = await getUserProfile(req.params.id, req.user.role === "ADMIN", req.user.id);
  await recordAudit({ userId: req.user.id, action: "admin.user_profile_viewed", details: { targetUserId: req.params.id }, req });
  res.json({ profile });
}

/** USER: their own portal summary. */
export async function handleSelfSummary(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const summary = await getUserSelfSummary(req.user.id);
  res.json({ summary });
}

/** ADMIN: enable or disable a user account (PATCH /api/users/:id/status). */
export async function handleUpdateStatus(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const { status } = statusSchema.parse(req.body);
  const isActive = status === "active";
  await setUserActive(req.params.id, isActive, req.user.id);
  await recordAudit({ userId: req.user.id, action: isActive ? "admin.user_enabled" : "admin.user_disabled", details: { targetUserId: req.params.id }, req });
  res.json({ id: req.params.id, status, isActive });
}
