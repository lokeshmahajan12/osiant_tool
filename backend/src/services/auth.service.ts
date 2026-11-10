import bcrypt from "bcryptjs";
import type { Request } from "express";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { signToken, hashToken, type AuthenticatedUser } from "../middleware/auth";
import { ApiError } from "../middleware/errorHandler";
import { recordAudit } from "../middleware/audit";
import { recordSecurityEvent } from "../services/securityEvent.service";
import { generateDeviceToken, hashDeviceToken } from "../middleware/deviceAuth";
import { DEVICE_STATUS, PERMISSION_STATUS } from "./location.service";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface PublicUser extends AuthenticatedUser {
  username: string | null;
  mobile: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  isActive: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  accountId: string;
  /** Browser device used for user-dashboard location sharing. */
  webDevice?: { id: string; deviceToken?: string; name: string } | null;
}

export function publicUser(u: {
  id: string;
  email: string;
  name: string;
  role: string;
  username?: string | null;
  mobile?: string | null;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  isActive?: boolean;
  createdAt?: Date;
  lastLoginAt?: Date | null;
}): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role as AuthenticatedUser["role"],
    username: u.username ?? null,
    mobile: u.mobile ?? null,
    country: u.country ?? null,
    state: u.state ?? null,
    city: u.city ?? null,
    isActive: u.isActive ?? true,
    createdAt: u.createdAt ?? new Date(0),
    lastLoginAt: u.lastLoginAt ?? null,
    accountId: u.id,
  };
}

/** Resolve a login identifier that may be an email, username or mobile number. */
async function findUserByIdentifier(identifier: string) {
  const normalized = identifier.trim().toLowerCase();
  return prisma.user.findFirst({
    where: {
      OR: [{ email: normalized }, { username: normalized }, { mobile: { equals: normalized, mode: "insensitive" } }],
    },
  });
}

async function createSessionAndToken(user: { id: string; role: string }, req?: Request): Promise<{ token: string; sessionId: string }> {
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: "pending", // replaced below after token minted
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ip: req?.ip,
      userAgent: req?.get("user-agent")?.slice(0, 300),
    },
  });
  const token = signToken(user, session.id);
  await prisma.session.update({ where: { id: session.id }, data: { tokenHash: hashToken(token) } });
  return { token, sessionId: session.id };
}

export async function login(
  identifier: string,
  password: string,
  req?: Request
): Promise<{ token: string; user: PublicUser }> {
  const user = await findUserByIdentifier(identifier);
  if (!user || !user.isActive) {
    await recordSecurityEvent({
      userId: user?.id,
      type: "LOGIN_FAILED",
      severity: "WARN",
      message: `Failed login attempt for "${identifier.trim().toLowerCase()}"`,
      ip: req?.ip,
      metadata: { reason: "unknown_user_or_disabled" },
    }).catch(() => undefined);
    throw new ApiError(401, "Invalid credentials", "INVALID_CREDENTIALS");
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    await recordAudit({ userId: user.id, action: "auth.login_failed", details: { email: identifier }, req });
    await recordSecurityEvent({
      userId: user.id,
      type: "LOGIN_FAILED",
      severity: "WARN",
      message: "Failed login attempt (invalid password)",
      ip: req?.ip,
    }).catch(() => undefined);
    throw new ApiError(401, "Invalid credentials", "INVALID_CREDENTIALS");
  }

  const { token } = await createSessionAndToken(user, req);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await recordAudit({ userId: user.id, action: "auth.login", details: { email: user.email }, req });
  await recordSecurityEvent({
    userId: user.id,
    type: "LOGIN_SUCCESS",
    severity: "INFO",
    message: `Successful login for ${user.email}`,
    ip: req?.ip,
  }).catch(() => undefined);

  const detail = await loadUserDetail(user.id);
  return { token, user: detail };
}

export async function logout(token: string, req?: Request): Promise<void> {
  const res = await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (res.count > 0) {
    await recordAudit({ action: "auth.logout", req });
  }
}

async function loadUserDetail(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      username: true,
      mobile: true,
      country: true,
      state: true,
      city: true,
      isActive: true,
      createdAt: true,
      lastLoginAt: true,
      devices: { where: { platform: "WEB" }, orderBy: { createdAt: "asc" }, take: 1, select: { id: true, name: true } },
    },
  });
  if (!user) throw new ApiError(404, "User not found");
  return { ...publicUser(user), webDevice: user.devices[0] ?? null };
}

export async function getMe(userId: string): Promise<PublicUser> {
  return loadUserDetail(userId);
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, "User not found");
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new ApiError(400, "Current password is incorrect");
  }
  if (newPassword.length < 8) throw new ApiError(400, "New password must be at least 8 characters");

  const hash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: hash } });
  // Revoke all other sessions on password change.
  await prisma.session.updateMany({
    where: { userId, tokenHash: { not: "" }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await recordAudit({ userId, action: "auth.password_changed" });
  await recordSecurityEvent({ userId, type: "PASSWORD_CHANGED", severity: "INFO", message: "Password changed; all other sessions revoked" }).catch(
    () => undefined
  );
}

const MOBILE_REGEX = /^[+]?[\d\s()-]{7,20}$/;

export interface RegisterInput {
  name: string;
  username?: string;
  email: string;
  mobile?: string;
  password: string;
  country?: string;
  state?: string;
  city?: string;
  profile?: Record<string, unknown>;
}

/**
 * Register a new end-user (role USER). Creates the user, their settings, an
 * initial web-browser device used for consent-based location sharing, and
 * seeds the default permission records. Never stores plaintext passwords.
 */
export async function registerUser(data: RegisterInput, req?: Request): Promise<{ token: string; user: PublicUser }> {
  const email = data.email.trim().toLowerCase();
  const username = data.username?.trim().toLowerCase();
  const mobile = data.mobile?.trim();

  if (!MOBILE_REGEX.test(mobile ?? "") && mobile) {
    throw new ApiError(400, "Enter a valid mobile number (e.g. +919876543210)", "VALIDATION_ERROR");
  }
  if (username && !/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new ApiError(400, "Username must be 3-32 characters using letters, numbers, dot, dash or underscore", "VALIDATION_ERROR");
  }
  if (data.password.length < 8) {
    throw new ApiError(400, "Password must be at least 8 characters", "VALIDATION_ERROR");
  }
  if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(data.password)) {
    throw new ApiError(
      400,
      "Password must contain at least one lowercase letter, one uppercase letter and one number",
      "VALIDATION_ERROR"
    );
  }

  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { email },
        ...(username ? [{ username } as const] : []),
        ...(mobile ? [{ mobile } as const] : []),
      ],
    },
  });
  if (existing) {
    if (existing.email === email) throw new ApiError(409, "An account with this email already exists", "EMAIL_TAKEN");
    if (username && existing.username === username) throw new ApiError(409, "This username is already taken", "USERNAME_TAKEN");
    if (mobile && existing.mobile === mobile) throw new ApiError(409, "This mobile number is already registered", "MOBILE_TAKEN");
    throw new ApiError(409, "An account with these details already exists", "ACCOUNT_EXISTS");
  }

  const hash = await bcrypt.hash(data.password, env.BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: {
      email,
      username: username ?? null,
      mobile: mobile ?? null,
      passwordHash: hash,
      name: data.name.trim(),
      role: "USER",
      country: data.country?.trim() || null,
      state: data.state?.trim() || null,
      city: data.city?.trim() || null,
      profile: data.profile as object | undefined,
      settings: { create: { consentAcknowledged: false } },
    },
  });

  // Browser device used by the user dashboard for consent-based location sharing.
  const deviceToken = generateDeviceToken();
  const webDevice = await prisma.device.create({
    data: {
      ownerId: user.id,
      name: "Web Browser",
      platform: "WEB",
      status: DEVICE_STATUS.OFFLINE,
      locationSharing: false,
      permissionStatus: PERMISSION_STATUS.UNKNOWN,
      deviceTokenHash: hashDeviceToken(deviceToken),
    },
  });

  const { token } = await createSessionAndToken(user, req);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await recordAudit({ userId: user.id, action: "user.registered", details: { email, username, mobile: mobile ?? undefined }, req });
  await recordSecurityEvent({
    userId: user.id,
    type: "USER_REGISTERED",
    severity: "INFO",
    message: `Account registered for ${email}`,
    ip: req?.ip,
  }).catch(() => undefined);

  const detail = await loadUserDetail(user.id);
  detail.webDevice = { id: webDevice.id, deviceToken, name: webDevice.name };
  return { token, user: detail };
}

export async function createUser(data: {
  email: string;
  name: string;
  password: string;
  role: "ANALYST" | "INVESTIGATOR" | "ADMIN";
}): Promise<AuthenticatedUser> {
  if (data.password.length < 8) throw new ApiError(400, "Password must be at least 8 characters");
  const existing = await prisma.user.findUnique({ where: { email: data.email.trim().toLowerCase() } });
  if (existing) throw new ApiError(409, "User with this email already exists");

  const hash = await bcrypt.hash(data.password, env.BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: {
      email: data.email.trim().toLowerCase(),
      name: data.name.trim(),
      passwordHash: hash,
      role: data.role,
      settings: { create: { consentAcknowledged: false } },
    },
  });
  return publicUser(user);
}

export async function listUsers(): Promise<PublicUser[]> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true,
      lastLoginAt: true,
      username: true,
      mobile: true,
    },
  });
  return users.map((u) => publicUser(u));
}

export async function setUserActive(id: string, isActive: boolean, actorId?: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, "User not found");
  await prisma.user.update({ where: { id }, data: { isActive } });
  if (!isActive) {
    await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await recordSecurityEvent({
      userId: id,
      type: "ACCOUNT_DISABLED",
      severity: "WARN",
      message: "Account disabled; all sessions revoked",
    }).catch(() => undefined);
  }
  await recordAudit({
    userId: actorId,
    action: isActive ? "admin.user_enabled" : "admin.user_disabled",
    details: { targetUserId: id },
  });
}
