import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";

export type Role = "ANALYST" | "INVESTIGATOR" | "ADMIN" | "USER";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      sessionId?: string;
    }
  }
}

interface TokenPayload extends jwt.JwtPayload {
  sub: string;
  role: string;
  jti: string;
}

/** Alias kept for backwards compatibility with existing imports. */
export type UserRole = Role;

export function signToken(user: { id: string; role: string }, sessionId: string): string {
  return jwt.sign({ sub: user.id, role: user.role, jti: sessionId }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!session || session.revokedAt) {
      res.status(401).json({ error: "Session revoked or expired" });
      return;
    }
    if (session.expiresAt.getTime() < Date.now()) {
      res.status(401).json({ error: "Session expired" });
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      res.status(401).json({ error: "Account disabled or removed" });
      return;
    }
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    req.sessionId = session.id;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}
