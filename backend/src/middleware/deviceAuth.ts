import type { NextFunction, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { hashToken } from "./auth";

export interface AuthenticatedDevice {
  id: string;
  ownerId: string;
  name: string;
  platform: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      device?: AuthenticatedDevice;
      /** "user" when a dashboard JWT authenticated the request, "device" when a device token did. */
      authMode?: "user" | "device";
    }
  }
}

/** Generate a fresh device token. The plain value is returned once; only its hash is stored. */
export function generateDeviceToken(): string {
  return `sentinel-device-${randomBytes(24).toString("hex")}`;
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function resolveDeviceByToken(token: string): Promise<AuthenticatedDevice | null> {
  if (!token) return null;
  const device = await prisma.device.findUnique({ where: { deviceTokenHash: hashDeviceToken(token) } });
  if (!device || !device.isActive) return null;
  return { id: device.id, ownerId: device.ownerId, name: device.name, platform: device.platform };
}

/**
 * Authenticate a device via the `X-Device-Token` header. Used for the raw
 * location push endpoint and the device self-service endpoints.
 */
export async function requireDeviceToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = (req.headers["x-device-token"] as string | string[] | undefined)?.toString();
  if (!token) {
    res.status(401).json({ error: "Invalid or inactive device token" });
    return;
  }
  const device = await resolveDeviceByToken(token);
  if (!device) {
    res.status(401).json({ error: "Invalid or inactive device token" });
    return;
  }
  req.device = device;
  req.authMode = "device";
  next();
}

/**
 * Dual authentication for location control endpoints: a dashboard user may
 * act with their JWT, or the enrolled device may act with its token. Sets
 * `req.user` (dashboard) or `req.device` (mobile client) accordingly.
 */
export async function requireLocationControl(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  const deviceToken = (req.headers["x-device-token"] as string | string[] | undefined)?.toString();

  if (deviceToken) {
    const device = await resolveDeviceByToken(deviceToken);
    if (!device) {
      res.status(401).json({ error: "Invalid or inactive device token" });
      return;
    }
    req.device = device;
    req.authMode = "device";
    next();
    return;
  }

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
      const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
      if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
        res.status(401).json({ error: "Session revoked or expired" });
        return;
      }
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || !user.isActive) {
        res.status(401).json({ error: "Account disabled or removed" });
        return;
      }
      req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
      req.sessionId = session.id;
      req.authMode = "user";
      next();
      return;
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
  }

  res.status(401).json({ error: "Authentication required" });
}
