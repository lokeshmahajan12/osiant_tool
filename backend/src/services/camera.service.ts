import type { Request } from "express";
import { prisma } from "../lib/prisma";
import { emitToOwner } from "../lib/ws";
import { recordAudit } from "../middleware/audit";
import { recordSecurityEvent } from "./securityEvent.service";
import { ApiError } from "../middleware/errorHandler";

export const CAMERA_MODES = ["CAPTURE", "LIVE"] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

export interface CameraSessionView {
  id: string;
  userId: string;
  status: "ACTIVE" | "ENDED";
  mode: CameraMode;
  startedAt: string;
  endedAt: string | null;
  endedBy: string | null;
}

function toView(s: {
  id: string;
  userId: string;
  status: string;
  mode: string;
  startedAt: Date;
  endedAt: Date | null;
  endedBy: string | null;
}): CameraSessionView {
  return {
    id: s.id,
    userId: s.userId,
    status: s.status as CameraSessionView["status"],
    mode: s.mode as CameraMode,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
    endedBy: s.endedBy,
  };
}

/**
 * Start an application-managed camera session. The actual browser camera is
 * only ever activated by explicit user interaction in the browser; this merely
 * records the consent-backed session state so ADMIN can see the status.
 */
export async function startCameraSession(userId: string, mode: CameraMode, req?: Request): Promise<CameraSessionView> {
  const active = await prisma.cameraSession.findFirst({ where: { userId, status: "ACTIVE" } });
  if (active) {
    return toView(active); // idempotent
  }
  const session = await prisma.cameraSession.create({
    data: { userId, mode, status: "ACTIVE" },
  });
  await recordAudit({ userId, action: "CAMERA_SESSION_STARTED", details: { sessionId: session.id, mode }, req });
  await recordSecurityEvent({
    userId,
    type: "CAMERA_SESSION_STARTED",
    severity: "INFO",
    message: "User initiated a camera session",
    metadata: { sessionId: session.id, mode },
  }).catch(() => undefined);
  emitToOwner(userId, "camera:started", { userId, sessionId: session.id, mode, startedAt: session.startedAt.toISOString() });
  return toView(session);
}

/** End the user's active camera session (user-initiated or admin-managed). */
export async function endCameraSession(
  userId: string,
  sessionId: string,
  opts: { by: "USER" | "ADMIN"; actorId?: string },
  req?: Request
): Promise<{ ended: boolean; session?: CameraSessionView }> {
  const session = await prisma.cameraSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new ApiError(404, "Camera session not found");
  if (session.userId !== userId && opts.by !== "ADMIN") throw new ApiError(404, "Camera session not found");
  if (session.status === "ENDED") return { ended: false };

  const updated = await prisma.cameraSession.update({
    where: { id: sessionId },
    data: { status: "ENDED", endedAt: new Date(), endedBy: opts.by },
  });
  await recordAudit({
    userId: opts.actorId ?? userId,
    action: "CAMERA_SESSION_ENDED",
    details: { sessionId, endedBy: opts.by },
    req,
  });
  emitToOwner(session.userId, "camera:ended", { userId: session.userId, sessionId, endedAt: updated.endedAt?.toISOString() });
  return { ended: true, session: toView(updated) };
}

/** Current active session for a user (or null). */
export async function getActiveCameraSession(userId: string): Promise<CameraSessionView | null> {
  const s = await prisma.cameraSession.findFirst({ where: { userId, status: "ACTIVE" } });
  return s ? toView(s) : null;
}

export async function listCameraSessionsForUser(
  userId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<{ items: CameraSessionView[]; total: number }> {
  const [items, total] = await Promise.all([
    prisma.cameraSession.findMany({
      where: { userId },
      orderBy: { startedAt: "desc" },
      take: Math.min(opts.limit ?? 20, 100),
      skip: opts.offset ?? 0,
    }),
    prisma.cameraSession.count({ where: { userId } }),
  ]);
  return { items: items.map(toView), total };
}

/** ADMIN: view the camera session status of any user. */
export async function getCameraStatusForAdmin(targetUserId: string): Promise<CameraSessionView | null> {
  return getActiveCameraSession(targetUserId);
}

/** ADMIN: list camera sessions (active first, then recent ended). */
export async function listAllCameraSessions(opts: { limit?: number; offset?: number } = {}): Promise<{ items: CameraSessionView[]; total: number }> {
  const [items, total] = await Promise.all([
    prisma.cameraSession.findMany({
      orderBy: [{ status: "asc" }, { startedAt: "desc" }],
      take: Math.min(opts.limit ?? 50, 200),
      skip: opts.offset ?? 0,
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.cameraSession.count(),
  ]);
  return {
    items: items.map((s) => ({ ...toView(s), user: s.user as { id: string; name: string; email: string } })),
    total,
  };
}
