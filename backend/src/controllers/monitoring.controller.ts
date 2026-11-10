import type { Request, Response } from "express";
import { ApiError } from "../middleware/errorHandler";
import * as monitoring from "../services/monitoring.service";

function targetId(req: Request): string {
  return req.params.id;
}

function actorId(req: Request): string {
  if (!req.user) throw new ApiError(401, "Authentication required");
  return req.user.id;
}

/** ADMIN: start application monitoring for a user. */
export async function handleMonitorStart(req: Request, res: Response): Promise<void> {
  const result = await monitoring.startMonitoring(targetId(req), actorId(req), req);
  res.json(result);
}

/** ADMIN: stop application monitoring for a user. */
export async function handleMonitorStop(req: Request, res: Response): Promise<void> {
  const result = await monitoring.stopMonitoring(targetId(req), actorId(req), req);
  res.json(result);
}

/** ADMIN: suspend a user's monitoring. */
export async function handleSuspend(req: Request, res: Response): Promise<void> {
  const result = await monitoring.suspendMonitoring(targetId(req), actorId(req), req);
  res.json(result);
}

/** ADMIN: re-enable a suspended user's monitoring. */
export async function handleReEnable(req: Request, res: Response): Promise<void> {
  const result = await monitoring.reEnableMonitoring(targetId(req), actorId(req), req);
  res.json(result);
}

/** ADMIN: force-logout every session of a user. */
export async function handleForceLogout(req: Request, res: Response): Promise<void> {
  const result = await monitoring.forceLogout(targetId(req), actorId(req), req);
  res.json(result);
}

/** ADMIN: revoke application-side monitoring authorization. */
export async function handleRevokeAuthorization(req: Request, res: Response): Promise<void> {
  const result = await monitoring.revokeMonitoringAuthorization(targetId(req), actorId(req), req);
  res.json(result);
}

/** ADMIN: delete a user's location history. */
export async function handleDeleteLocationHistory(req: Request, res: Response): Promise<void> {
  const result = await monitoring.deleteUserLocationHistory(targetId(req), actorId(req), req);
  res.json(result);
}

/** ADMIN: delete a user's session data. */
export async function handleDeleteSessionData(req: Request, res: Response): Promise<void> {
  const result = await monitoring.deleteUserSessionData(targetId(req), actorId(req), req);
  res.json(result);
}

/** ADMIN: live view of which users are sharing location right now. */
export async function handleLiveUsers(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const { listUsersForAdmin } = await import("../services/user.service");
  const result = await listUsersForAdmin({ sharing: "true", limit: 200 });
  res.json(result);
}

/** ADMIN: current coordinates of every user with a recorded fix (live map). */
export async function handleLiveMap(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const { getLiveMap } = await import("../services/user.service");
  const users = await getLiveMap();
  res.json({ users });
}
