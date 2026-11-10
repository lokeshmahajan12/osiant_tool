import type { Request, Response } from "express";
import { z } from "zod";
import { login, logout, getMe, changePassword, registerUser } from "../services/auth.service";
import { ApiError } from "../middleware/errorHandler";
import { env } from "../config/env";

const loginSchema = z.object({
  // Unified login: `email` (must be a valid email) OR `identifier` (username or mobile).
  email: z.string().trim().toLowerCase().email().optional(),
  identifier: z.string().trim().min(1).optional(),
  password: z.string().min(1),
}).refine((v) => v.email || v.identifier, { message: "email or identifier is required" });

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  username: z.string().trim().min(3).max(32).optional(),
  email: z.string().trim().toLowerCase().email(),
  mobile: z.string().trim().min(7).max(20).optional(),
  password: z.string().min(8),
  confirmPassword: z.string().min(8),
  country: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  profile: z.record(z.unknown()).optional(),
}).refine((v) => v.password === v.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

export async function handleLogin(req: Request, res: Response): Promise<void> {
  const body = loginSchema.parse(req.body);
  const identifier = body.identifier ?? body.email ?? "";
  const result = await login(identifier, body.password, req);
  res.json(result);
}

export async function handleRegister(req: Request, res: Response): Promise<void> {
  if (!env.REGISTRATION_ENABLED) {
    throw new ApiError(403, "Self-registration is currently disabled", "REGISTRATION_DISABLED");
  }
  const body = registerSchema.parse(req.body);
  const result = await registerUser(body, req);
  res.status(201).json(result);
}

export async function handleLogout(req: Request, res: Response): Promise<void> {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    await logout(header.slice(7), req);
  }
  res.status(204).send();
}

export async function handleMe(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  res.json({ user: await getMe(req.user.id) });
}

export async function handleChangePassword(req: Request, res: Response): Promise<void> {
  const body = changePasswordSchema.parse(req.body);
  if (!req.user) throw new ApiError(401, "Authentication required");
  await changePassword(req.user.id, body.currentPassword, body.newPassword);
  res.status(204).send();
}
