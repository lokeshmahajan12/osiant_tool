import { prisma } from "../lib/prisma";
import { ApiError } from "../middleware/errorHandler";
import { env } from "../config/env";
import { presenceManager } from "./location.presence";
import type { Role } from "../middleware/auth";

const SORTABLE: Record<string, "createdAt" | "lastLoginAt" | "name" | "email" | "role"> = {
  createdAt: "createdAt",
  registered: "createdAt",
  lastLoginAt: "lastLoginAt",
  name: "name",
  email: "email",
  role: "role",
};

export interface DirectoryUser {
  id: string;
  accountId: string;
  name: string;
  email: string;
  username: string | null;
  mobile: string | null;
  role: Role;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  online: boolean;
  locationSharing: boolean;
  locationPermission: string;
  cameraPermission: string;
  microphonePermission: string;
  notificationPermission: string;
  lastSeen: string | null;
  lastLocationUpdate: string | null;
  browser: string | null;
  os: string | null;
  deviceCount: number;
  activeSessions: number;
  monitoringStatus: string;
}

/** Aggregate derived directory view for a single user row + its devices + permissions. */
function toDirectoryUser(u: {
  id: string;
  name: string;
  email: string;
  username: string | null;
  mobile: string | null;
  role: Role;
  isActive: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  devices: {
    id: string;
    locationSharing: boolean;
    permissionStatus: string;
    browser: string | null;
    os: string | null;
    lastSeenAt: Date | null;
    locationEvents: { timestamp: Date }[];
  }[];
  permissions: { type: string; state: string }[];
  monitoring: { status: string } | null;
}): DirectoryUser {
  const anyLive = u.devices.some((d) => {
    const last = d.lastSeenAt?.getTime() ?? null;
    if (!last) return false;
    return presenceManager.isOnline(d.id, last) || d.locationSharing;
  });
  const sharing = u.devices.some((d) => d.locationSharing);
  const lastSeen = u.devices.reduce<number | null>((max, d) => {
    const t = d.lastSeenAt?.getTime() ?? null;
    if (t === null) return max;
    return max === null || t > max ? t : max;
  }, null);
  const lastFix = u.devices.reduce<number | null>((max, d) => {
    const t = d.locationEvents[0]?.timestamp.getTime() ?? null;
    if (t === null) return max;
    return max === null || t > max ? t : max;
  }, null);
  const p = (t: string) => u.permissions.find((x) => x.type === t)?.state ?? "NOT_REQUESTED";

  return {
    id: u.id,
    accountId: u.id,
    name: u.name,
    email: u.email,
    username: u.username,
    mobile: u.mobile,
    role: u.role,
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    online: anyLive,
    locationSharing: sharing,
    locationPermission: p("LOCATION"),
    cameraPermission: p("CAMERA"),
    microphonePermission: p("MICROPHONE"),
    notificationPermission: p("NOTIFICATIONS"),
    lastSeen: lastSeen ? new Date(lastSeen).toISOString() : null,
    lastLocationUpdate: lastFix ? new Date(lastFix).toISOString() : null,
    browser: u.devices.find((d) => d.browser)?.browser ?? null,
    os: u.devices.find((d) => d.os)?.os ?? null,
    deviceCount: u.devices.length,
    activeSessions: u.devices.filter((d) => d.locationSharing).length,
    monitoringStatus: u.monitoring?.status ?? "INACTIVE",
  };
}

export async function listUsersForAdmin(params: {
  search?: string;
  role?: string;
  status?: string;
  online?: string;
  sharing?: string;
  permission?: string;
  recent?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: DirectoryUser[]; total: number }> {
  const { search, role, status } = params;
  const limit = Math.min(params.limit ?? 50, 200);
  const offset = params.offset ?? 0;

  const sortKey = SORTABLE[params.sort ?? "createdAt"] ?? "createdAt";
  const order: "asc" | "desc" = params.order === "asc" ? "asc" : "desc";

  const where: Record<string, unknown> = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { username: { contains: search, mode: "insensitive" } },
      { mobile: { contains: search, mode: "insensitive" } },
    ];
  }
  if (role && role !== "ALL") where.role = role;
  if (status === "active") where.isActive = true;
  if (status === "inactive") where.isActive = false;

  const rows = await prisma.user.findMany({
    where,
    orderBy: { [sortKey]: order },
    skip: offset,
    take: limit,
    include: {
      devices: {
        select: {
          id: true,
          locationSharing: true,
          permissionStatus: true,
          browser: true,
          os: true,
          lastSeenAt: true,
          locationEvents: { orderBy: { timestamp: "desc" }, take: 1, select: { timestamp: true } },
        },
      },
      permissions: { select: { type: true, state: true } },
      monitoring: { select: { status: true } },
    },
  });
  const total = await prisma.user.count({ where });

  let items = rows.map(toDirectoryUser);

  // JS-side filters that depend on derived state.
  if (params.online === "true") items = items.filter((u) => u.online);
  if (params.online === "false") items = items.filter((u) => !u.online);
  if (params.sharing === "true") items = items.filter((u) => u.locationSharing);
  if (params.permission === "denied") items = items.filter((u) => u.locationPermission === "DENIED" || u.locationPermission === "REVOKED");
  if (params.recent === "true") {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    items = items.filter((u) => new Date(u.createdAt).getTime() >= cutoff);
  }

  return { items, total };
}

/** Rich single-user profile for the ADMIN detail page + OSINT intelligence view. */
export async function getUserProfile(targetUserId: string, viewerIsAdmin: boolean, viewerId: string) {
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    include: {
      settings: true,
      sessions: { orderBy: { createdAt: "desc" }, take: 20, select: { id: true, createdAt: true, revokedAt: true, expiresAt: true, userAgent: true, ip: true } },
      devices: {
        orderBy: { createdAt: "asc" },
        include: { locationSessions: { orderBy: { startedAt: "desc" }, take: 10 }, locationEvents: { orderBy: { timestamp: "desc" }, take: 5000 } },
      },
      permissions: true,
      monitoring: true,
      securityEvents: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!user) throw new ApiError(404, "User not found");

  const webDevice = user.devices.find((d) => d.platform === "WEB") ?? null;
  const lastFix = webDevice
    ? (() => {
        const f = webDevice.locationEvents[0];
        return f
          ? {
              latitude: f.latitude,
              longitude: f.longitude,
              accuracy: f.accuracy,
              timestamp: f.timestamp.toISOString(),
              isTest: f.isTest,
            }
          : null;
      })()
    : null;

  const profile = {
    identity: {
      id: user.id,
      accountId: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      mobile: user.mobile,
      country: user.country,
      state: user.state,
      city: user.city,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    },
    account: {
      registrationDate: user.createdAt.toISOString(),
      settings: user.settings,
      activeSessions: user.sessions.filter((s) => !s.revokedAt && s.expiresAt.getTime() > Date.now()).length,
      totalSessions: user.sessions.length,
      recentLogins: user.securityEvents.filter((e) => e.type === "LOGIN_SUCCESS").slice(0, 10),
      securityEvents: user.securityEvents,
    },
    device: webDevice
      ? {
          id: webDevice.id,
          name: webDevice.name,
          platform: webDevice.platform,
          browser: webDevice.browser,
          os: webDevice.os,
          permissionStatus: webDevice.permissionStatus,
          status: webDevice.status,
          lastSeenAt: webDevice.lastSeenAt ? webDevice.lastSeenAt.toISOString() : null,
          sessions: webDevice.locationSessions,
        }
      : null,
    location: {
      current: lastFix,
      history: webDevice?.locationEvents.slice(0, 200) ?? [],
      session: webDevice?.locationSessions[0] ?? null,
    },
    permissions: user.permissions.map((p) => ({
      type: p.type,
      state: p.state,
      consentVersion: p.consentVersion,
      grantedAt: p.grantedAt ? p.grantedAt.toISOString() : null,
      deniedAt: p.deniedAt ? p.deniedAt.toISOString() : null,
    })),
    monitoring: user.monitoring,
    dataPolicy: {
      retentionHours: env.LOCATION_RETENTION_HOURS,
      sessionTtlHours: Math.round(env.LOCATION_SESSION_TTL_MS / (60 * 60_000)),
      consentVersion: env.CONSENT_VERSION,
      privacyPolicyVersion: env.PRIVACY_POLICY_VERSION,
    },
  };

  return profile;
}

export interface LiveMapEntry {
  userId: string;
  name: string;
  email: string;
  username: string | null;
  deviceId: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  lastFixAt: string | null;
  sharing: boolean;
  online: boolean;
  permissionStatus: string;
  monitoringStatus: string;
  lastSeenAt: string | null;
}

/**
 * ADMIN: aggregate the current coordinates of every user that has any recorded
 * location event. Powers the admin live map without exposing any raw event rows.
 */
export async function getLiveMap(): Promise<LiveMapEntry[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    include: {
      devices: {
        select: {
          id: true,
          platform: true,
          locationSharing: true,
          permissionStatus: true,
          lastSeenAt: true,
          locationEvents: { orderBy: { timestamp: "desc" }, take: 1, select: { latitude: true, longitude: true, accuracy: true, timestamp: true } },
        },
      },
      monitoring: { select: { status: true } },
    },
  });

  return users
    .map((u) => {
      const device = u.devices.find((d) => d.platform === "WEB") ?? u.devices[0] ?? null;
      const fix = device?.locationEvents[0] ?? null;
      return {
        userId: u.id,
        name: u.name,
        email: u.email,
        username: u.username,
        deviceId: device?.id ?? null,
        latitude: fix?.latitude ?? null,
        longitude: fix?.longitude ?? null,
        accuracy: fix?.accuracy ?? null,
        lastFixAt: fix ? fix.timestamp.toISOString() : null,
        sharing: device?.locationSharing ?? false,
        online: device ? presenceManager.isOnline(device.id, device.lastSeenAt?.getTime() ?? null) : false,
        permissionStatus: device?.permissionStatus ?? "UNKNOWN",
        monitoringStatus: u.monitoring?.status ?? "INACTIVE",
        lastSeenAt: device?.lastSeenAt ? device.lastSeenAt.toISOString() : null,
      };
    })
    .filter((u) => u.latitude !== null && u.longitude !== null);
}

/** Minimal profile used by a USER to view their own data. */
export async function getUserSelfSummary(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      settings: true,
      permissions: true,
      devices: {
        include: { locationSessions: { orderBy: { startedAt: "desc" }, take: 1 }, locationEvents: { orderBy: { timestamp: "desc" }, take: 1 } },
      },
      cameraSessions: { orderBy: { startedAt: "desc" }, take: 1 },
      monitoring: true,
    },
  });
  if (!user) throw new ApiError(404, "User not found");
  const webDevice = user.devices.find((d) => d.platform === "WEB") ?? null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    mobile: user.mobile,
    country: user.country,
    state: user.state,
    city: user.city,
    accountId: user.id,
    createdAt: user.createdAt.toISOString(),
    role: user.role,
    isActive: user.isActive,
    settings: user.settings,
    permissions: user.permissions,
    webDevice: webDevice
      ? {
          id: webDevice.id,
          status: webDevice.status,
          permissionStatus: webDevice.permissionStatus,
          locationSharing: webDevice.locationSharing,
          lastSeenAt: webDevice.lastSeenAt ? webDevice.lastSeenAt.toISOString() : null,
          lastFix: webDevice.locationEvents[0]
            ? {
                latitude: webDevice.locationEvents[0].latitude,
                longitude: webDevice.locationEvents[0].longitude,
                accuracy: webDevice.locationEvents[0].accuracy,
                timestamp: webDevice.locationEvents[0].timestamp.toISOString(),
              }
            : null,
          session: webDevice.locationSessions[0] ?? null,
        }
      : null,
    camera: user.cameraSessions[0] ?? null,
    monitoring: user.monitoring,
  };
}
