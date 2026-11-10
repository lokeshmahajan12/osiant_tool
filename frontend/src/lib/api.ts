import type {
  AdminCameraSession,
  ApiHealth,
  AuditEntry,
  CameraMode,
  CameraSession,
  DeviceClientInfo,
  DevicePlatform,
  DeviceSummary,
  DirectoryUser,
  EnrolledDevice,
  EnrollmentLink,
  EnrollmentSummary,
  InputType,
  Investigation,
  LiveMapUser,
  LocationFix,
  LocationHistory,
  LocationStatus,
  Paginated,
  PermissionRecord,
  PermissionState,
  PermissionType,
  ProviderDescriptor,
  TrackingMode,
  User,
  UserProfile,
  UserSelfSummary,
} from "../types";

const TOKEN_KEY = "sentinel.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

const DEVICE_TOKEN_KEY = "sentinel.deviceToken";

/** Persist a device token so dashboard pages can reopen the share page for that device. */
export function storeDeviceToken(deviceId: string, token: string): void {
  try {
    localStorage.setItem(`${DEVICE_TOKEN_KEY}.${deviceId}`, token);
  } catch {
    /* storage unavailable (private mode / tests) */
  }
}

export function getStoredDeviceToken(deviceId: string): string | null {
  try {
    return localStorage.getItem(`${DEVICE_TOKEN_KEY}.${deviceId}`);
  } catch {
    return null;
  }
}

/** Request init carrying the mobile device token (X-Device-Token header). */
export function deviceHeaders(token: string): RequestInit {
  return { headers: { "X-Device-Token": token } };
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init.headers as Record<string, string>),
  };

  const res = await fetch(path, { ...init, headers });

  if (res.status === 401 && token && !path.includes("/auth/login")) {
    clearToken();
    try {
      if (!location.pathname.startsWith("/login")) location.assign("/login");
    } catch {
      /* navigation unavailable (e.g. tests) */
    }
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? message;
    } catch {
      /* keep default message */
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  // auth
  login: (identifier: string, password: string) =>
    request<{ token: string; user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify({ identifier, password }) }),
  register: (body: {
    name: string;
    username?: string;
    email: string;
    mobile?: string;
    password: string;
    confirmPassword: string;
    country?: string;
    state?: string;
    city?: string;
  }) => request<{ token: string; user: User }>("/api/auth/register", { method: "POST", body: JSON.stringify(body) }),
  me: () => request<{ user: User }>("/api/auth/me"),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("/api/auth/me/password", { method: "PATCH", body: JSON.stringify({ currentPassword, newPassword }) }),

  // investigations
  createInvestigation: (type: InputType, value: string) =>
    request<{ id: string; status: string }>("/api/investigations", { method: "POST", body: JSON.stringify({ type, value }) }),
  getInvestigation: (id: string) => request<Investigation>(`/api/investigations/${id}`),
  listInvestigations: (params?: { type?: InputType; status?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.type) q.set("type", params.type);
    if (params?.status) q.set("status", params.status);
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    const qs = q.toString();
    return request<Paginated<Investigation>>(`/api/investigations${qs ? `?${qs}` : ""}`);
  },
  deleteInvestigation: (id: string) => request<void>(`/api/investigations/${id}`, { method: "DELETE" }),
  deleteAllInvestigations: () => request<{ deleted: number }>("/api/investigations", { method: "DELETE" }),
  investigationReport: (id: string) => request<{ report: unknown }>(`/api/investigations/${id}/report`),
  investigationReportMarkdown: (id: string) =>
    fetch(`/api/investigations/${id}/report?format=markdown`, {
      headers: { Authorization: `Bearer ${getToken() ?? ""}` },
    }).then(async (r) => {
      if (!r.ok) throw new Error("Failed to generate report");
      return r.text();
    }),

  // providers
  listProviders: () => request<{ providers: ProviderDescriptor[]; mockMode: Record<string, boolean> }>("/api/providers"),
  toggleProvider: (name: string, enabled: boolean) =>
    request<{ name: string; enabled: boolean }>(`/api/providers/${encodeURIComponent(name)}/toggle`, { method: "POST", body: JSON.stringify({ enabled }) }),
  testProvider: (name: string) =>
    request<{ provider: string; ok: boolean }>(`/api/providers/${encodeURIComponent(name)}/test`, { method: "POST" }),

  // settings
  getSettings: () =>
    request<{
      retentionDays: number;
      autoPurge: boolean;
      consentAcknowledged: boolean;
      policies: {
        locationRetentionHours: number;
        locationSessionTtlHours: number;
        locationStaleThresholdMs: number;
        locationOfflineThresholdMs: number;
      };
    }>("/api/settings"),
  updateSettings: (body: Partial<{ retentionDays: number; autoPurge: boolean; consentAcknowledged: boolean }>) =>
    request<{ retentionDays: number; autoPurge: boolean; consentAcknowledged: boolean }>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  // audit
  listAudit: (params?: { limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    const qs = q.toString();
    return request<Paginated<AuditEntry>>(`/api/audit${qs ? `?${qs}` : ""}`);
  },
  listAdminAudit: (params?: { limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    const qs = q.toString();
    return request<Paginated<AuditEntry>>(`/api/admin/audit-logs${qs ? `?${qs}` : ""}`);
  },

  // user portal — permissions
  getMyPermissions: () => request<{ permissions: PermissionRecord[] }>("/api/permissions"),
  updatePermission: (type: PermissionType, state: PermissionState) =>
    request<{ permission: PermissionRecord }>(`/api/permissions/${type}`, { method: "POST", body: JSON.stringify({ state }) }),

  // user portal — self summary + dashboard location session
  getSelfSummary: () => request<{ summary: UserSelfSummary }>("/api/users/me/summary"),
  locationSessionStart: (mode: TrackingMode = "NORMAL", intervalMs?: number) =>
    request<{ session: { id: string; mode: TrackingMode; intervalMs: number; startedAt: string } }>("/api/location/session/start", {
      method: "POST",
      body: JSON.stringify({ mode, ...(intervalMs ? { intervalMs } : {}) }),
    }),
  locationSessionStop: () => request<{ stopped: boolean }>("/api/location/session/stop", { method: "POST" }),
  locationUpdate: (fix: Omit<LocationFix, "id">) =>
    request<{ id: string; timestamp: string }>("/api/location/update", { method: "POST", body: JSON.stringify(fix) }),
  getUserLocationHistory: (userId: string, params: { range?: string; from?: string; to?: string; max?: number }) => {
    const q = new URLSearchParams();
    if (params.range) q.set("range", params.range);
    if (params.from) q.set("from", params.from);
    if (params.to) q.set("to", params.to);
    if (params.max) q.set("max", String(params.max));
    const qs = q.toString();
    return request<LocationHistory>(`/api/location/${userId}/history${qs ? `?${qs}` : ""}`);
  },

  // user portal — camera
  cameraStatus: () => request<{ session: CameraSession | null }>("/api/camera/me"),
  cameraHistory: (params?: { limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    const qs = q.toString();
    return request<Paginated<CameraSession>>(`/api/camera/history${qs ? `?${qs}` : ""}`);
  },
  cameraStart: (mode: CameraMode = "CAPTURE") =>
    request<{ session: CameraSession }>("/api/camera/start", { method: "POST", body: JSON.stringify({ mode }) }),
  cameraEnd: (id: string) => request<{ ended: boolean; session?: CameraSession }>(`/api/camera/${id}/end`, { method: "POST" }),

  // admin — camera oversight
  adminCameraSessions: (params?: { limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    const qs = q.toString();
    return request<Paginated<AdminCameraSession>>(`/api/camera/admin/camera-sessions${qs ? `?${qs}` : ""}`);
  },
  adminCameraStatus: (userId: string) => request<{ session: CameraSession | null }>(`/api/camera/admin/camera/${userId}/status`),
  adminCameraEnd: (userId: string, sessionId: string) =>
    request<{ ended: boolean; session?: CameraSession }>(`/api/camera/admin/camera/${userId}/${sessionId}/end`, { method: "POST" }),

  // admin — directory, profiles, live map
  listDirectory: (params?: {
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
  }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.role) q.set("role", params.role);
    if (params?.status) q.set("status", params.status);
    if (params?.online) q.set("online", params.online);
    if (params?.sharing) q.set("sharing", params.sharing);
    if (params?.permission) q.set("permission", params.permission);
    if (params?.recent) q.set("recent", params.recent);
    if (params?.sort) q.set("sort", params.sort);
    if (params?.order) q.set("order", params.order);
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    const qs = q.toString();
    return request<Paginated<DirectoryUser>>(`/api/users${qs ? `?${qs}` : ""}`);
  },
  getUserProfile: (id: string) => request<{ profile: UserProfile }>(`/api/users/${id}`),
  updateUserStatus: (id: string, status: "active" | "inactive") =>
    request<{ id: string; status: string; isActive: boolean }>(`/api/users/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  getLiveMap: () => request<{ users: LiveMapUser[] }>("/api/admin/live-map"),
  getLiveUsers: () => request<{ items: DirectoryUser[]; total: number }>("/api/admin/live-users"),

  // admin — control center
  monitorStart: (id: string) => request<{ status: string }>(`/api/admin/users/${id}/monitor/start`, { method: "POST" }),
  monitorStop: (id: string) => request<{ status: string }>(`/api/admin/users/${id}/monitor/stop`, { method: "POST" }),
  monitorSuspend: (id: string) => request<{ status: string }>(`/api/admin/users/${id}/suspend`, { method: "POST" }),
  monitorEnable: (id: string) => request<{ status: string }>(`/api/admin/users/${id}/monitor/enable`, { method: "POST" }),
  forceLogout: (id: string) => request<{ revoked: number }>(`/api/admin/users/${id}/logout`, { method: "POST" }),
  revokeAuthorization: (id: string) => request<{ revoked: boolean }>(`/api/admin/users/${id}/revoke`, { method: "POST" }),
  deleteLocationHistory: (id: string) =>
    request<{ deleted: number }>(`/api/admin/users/${id}/location/history`, { method: "DELETE" }),
  deleteSessionData: (id: string) =>
    request<{ sessions: number; locationSessions: number; events: number }>(`/api/admin/users/${id}/sessions`, { method: "DELETE" }),

  // devices & live location
  listDevices: () => request<{ devices: DeviceSummary[] }>("/api/devices"),
  enrollDevice: (name: string, platform: DevicePlatform, phone?: string) =>
    request<EnrolledDevice>("/api/devices", {
      method: "POST",
      body: JSON.stringify({ name, platform, ...(phone?.trim() ? { phone: phone.trim() } : {}) }),
    }),
  getDevice: (id: string) => request<{ device: DeviceSummary }>(`/api/devices/${id}`),
  updateDevice: (id: string, body: { name?: string; phone?: string | null; isActive?: boolean }) =>
    request<{ device: DeviceSummary }>(`/api/devices/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteDevice: (id: string) => request<void>(`/api/devices/${id}`, { method: "DELETE" }),

  deviceStatus: (id: string) => request<{ status: LocationStatus }>(`/api/devices/${id}/location/status`),
  deviceHistory: (id: string, params: { range?: string; from?: string; to?: string; max?: number }) => {
    const q = new URLSearchParams();
    if (params.range) q.set("range", params.range);
    if (params.from) q.set("from", params.from);
    if (params.to) q.set("to", params.to);
    if (params.max) q.set("max", String(params.max));
    const qs = q.toString();
    return request<LocationHistory>(`/api/devices/${id}/location/history${qs ? `?${qs}` : ""}`);
  },
  recordDeviceConsent: (id: string) =>
    request<{ consent: { consentVersion: string; grantedAt: string } }>(`/api/devices/${id}/location/consent`, {
      method: "POST",
      body: JSON.stringify({ consentVersion: "1.0" }),
    }),
  startLocation: (id: string, mode: TrackingMode) =>
    request<{ session: { id: string; mode: TrackingMode; intervalMs: number; startedAt: string } }>(
      `/api/devices/${id}/location/start`,
      { method: "POST", body: JSON.stringify({ mode }) }
    ),
  stopLocation: (id: string) =>
    request<{ stopped: boolean }>(`/api/devices/${id}/location/stop`, { method: "POST" }),

  // device client (mobile) endpoints — authenticated with the device token
  deviceMe: (token: string) => request<{ device: DeviceClientInfo }>("/api/devices/me", deviceHeaders(token)),
  deviceConsent: (token: string, id: string) =>
    request<{ consent: { consentVersion: string; grantedAt: string } }>(`/api/devices/${id}/location/consent`, {
      ...deviceHeaders(token),
      method: "POST",
      body: JSON.stringify({ consentVersion: "1.0" }),
    }),
  deviceStart: (token: string, id: string, mode: TrackingMode) =>
    request<{ session: { id: string; mode: TrackingMode; intervalMs: number; startedAt: string } }>(
      `/api/devices/${id}/location/start`,
      { ...deviceHeaders(token), method: "POST", body: JSON.stringify({ mode }) }
    ),
  deviceStop: (token: string, id: string) =>
    request<{ stopped: boolean }>(`/api/devices/${id}/location/stop`, { ...deviceHeaders(token), method: "POST" }),
  devicePermission: (token: string, id: string, status: "GRANTED" | "DENIED" | "REVOKED") =>
    request<{ permissionStatus: string; sharingStopped: boolean }>(`/api/devices/${id}/location/permission`, {
      ...deviceHeaders(token),
      method: "POST",
      body: JSON.stringify({ status }),
    }),
  /** Dashboard (JWT-authenticated) reset of a device's OS permission record. */
  setDevicePermission: (id: string, status: "GRANTED" | "DENIED" | "REVOKED") =>
    request<{ permissionStatus: string; sharingStopped: boolean }>(`/api/devices/${id}/location/permission`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),
  deviceDeleteHistory: (token: string, id: string) =>
    request<{ deleted: number }>(`/api/devices/${id}/location/history`, { ...deviceHeaders(token), method: "DELETE" }),
  devicePush: (token: string, id: string, fix: Omit<LocationFix, "id">) =>
    request<{ id: string; timestamp: string }>(`/api/devices/${id}/location`, {
      ...deviceHeaders(token),
      method: "POST",
      body: JSON.stringify(fix),
    }),
  deviceHeartbeat: (token: string, id: string) =>
    request<{ ok: boolean; sharingActive: boolean; timestamp: string }>(`/api/devices/${id}/heartbeat`, { ...deviceHeaders(token), method: "PUT" }),
  deviceDiagnostics: (token: string) =>
    request<{ deviceId: string; auth: boolean; backend: string; apiStatus: number; lastFix: any; lastSeenAt: string | null; serverTime: string }>("/api/devices/me/diagnostics", deviceHeaders(token)),

  // system
  health: () => request<ApiHealth>("/api/health"),

  // admin
  listUsers: () => request<{ users: User[] }>("/api/admin/users"),
  createUser: (body: { email: string; name: string; password: string; role: User["role"] }) =>
    request<{ user: User }>("/api/admin/users", { method: "POST", body: JSON.stringify(body) }),
  setUserActive: (id: string, isActive: boolean) =>
    request<{ id: string; isActive: boolean }>(`/api/admin/users/${id}/active`, { method: "PATCH", body: JSON.stringify({ isActive }) }),

  // enrollment (QR-based device pairing)
  createEnrollment: (body: { deviceName: string; platform?: string; phone?: string; ttlMinutes?: number }) =>
    request<{ enrollment: EnrollmentLink }>("/api/enrollments", { method: "POST", body: JSON.stringify(body) }),
  listEnrollments: () =>
    request<{ enrollments: EnrollmentSummary[] }>("/api/enrollments"),
  revokeEnrollment: (id: string) =>
    request<{ revoked: boolean }>(`/api/enrollments/${id}/revoke`, { method: "POST" }),
  getEnrollmentInfo: (token: string) =>
    request<{ enrollment: { id: string; purpose: string; deviceName: string | null; platform: string | null; expiresAt: string; createdAt: string } }>(`/api/enroll/${token}`),
  redeemEnrollment: (token: string, body: { deviceName?: string; platform?: string; browser?: string; os?: string }) =>
    request<{ deviceId: string; deviceToken: string; name: string; platform: string; isTestDevice: boolean }>(`/api/enroll/${token}`, { method: "POST", body: JSON.stringify(body) }),
};

/** Export helpers that download files straight from the browser. */
export function downloadBlob(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportInvestigationAsJson(id: string): Promise<void> {
  return fetch(`/api/investigations/${id}/export`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } })
    .then((r) => r.blob())
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sentinel-${id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
}

export function exportInvestigationAsCsv(id: string): Promise<void> {
  return fetch(`/api/investigations/${id}/export?format=csv`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } })
    .then((r) => r.blob())
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sentinel-${id}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
}
