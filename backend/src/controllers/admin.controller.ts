import type { Request, Response } from "express";
import { z } from "zod";
import { createUser, listUsers, setUserActive } from "../services/auth.service";
import { recordAudit } from "../middleware/audit";

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  password: z.string().min(8),
  role: z.enum(["ANALYST", "INVESTIGATOR", "ADMIN"]),
});

const activeSchema = z.object({ isActive: z.boolean() });

export async function handleListUsers(_req: Request, res: Response): Promise<void> {
  res.json({ users: await listUsers() });
}

export async function handleCreateUser(req: Request, res: Response): Promise<void> {
  const body = createUserSchema.parse(req.body);
  const user = await createUser(body);
  await recordAudit({ userId: req.user?.id, action: "admin.user_created", details: { email: user.email, role: user.role }, req });
  res.status(201).json({ user });
}

export async function handleSetActive(req: Request, res: Response): Promise<void> {
  const { isActive } = activeSchema.parse(req.body);
  await setUserActive(req.params.id, isActive);
  await recordAudit({ userId: req.user?.id, action: isActive ? "admin.user_enabled" : "admin.user_disabled", details: { userId: req.params.id }, req });
  res.json({ id: req.params.id, isActive });
}
