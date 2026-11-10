export type Role = "ANALYST" | "INVESTIGATOR" | "ADMIN" | "USER";
export type InputType = "EMAIL" | "PHONE" | "USERNAME" | "DOMAIN" | "IP";
export type InvestigationStatus = "PENDING" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED";
export type ProviderStatus = "SUCCESS" | "ERROR" | "RATE_LIMITED" | "DISABLED" | "SKIPPED" | "TIMEOUT" | "MOCK";
export type ProviderCategory = "identity" | "breach" | "dns" | "infrastructure" | "reputation" | "security" | "social";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive?: boolean;
  createdAt?: string;
  lastLoginAt?: string | null;
  username?: string | null;
  mobile?: string | null;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  accountId?: string;
  webDevice?: { id: string; deviceToken?: string; name: string } | null;
}

export interface InvestigationSummary {
  exposureAlerts: string[];
  findings: string[];
  recommendations: string[];
  riskLevel: "low" | "medium" | "high";
}

export interface ProviderResult {
  provider: string;
  category: ProviderCategory;
  status: ProviderStatus;
  dataType: string;
  confidence: number;
  timestamp: string;
  data: Record<string, unknown> | null;
  error?: string;
  latencyMs?: number;
  sources?: string[];
  mode: "live" | "mock";
}

export interface Investigation {
  id: string;
  userId: string;
  inputType: InputType;
  input: string;
  normalized: string;
  status: InvestigationStatus;
  confidence: number | null;
  summary: InvestigationSummary | null;
  results: ProviderResult[] | null;
  error?: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
}

export interface ProviderDescriptor {
  name: string;
  category: ProviderCategory;
  mode: "live" | "mock";
  enabled: boolean;
  supports: InputType[];
  requiresKey?: string;
  description: string;
  lastStatus?: string;
  healthy?: boolean;
  quota?: { used: number; rejected: number };
}

export interface ApiHealth {
  status: string;
  db: string;
  uptimeSeconds: number;
  mode: "mock" | "live";
  version: string;
  providers: ProviderDescriptor[];
  providerHealth: string;
  mockProviders: string[];
}

export interface AuditEntry {
  id: string;
  action: string;
  details?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: string;
  user?: { email: string } | null;
  investigationId?: string | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
}

export type DevicePlatform = "ANDROID" | "IOS" | "WEB" | "OTHER";
export type TrackingMode = "NORMAL" | "HIGH_ACCURACY" | "BATTERY_SAVING";

/** LIVE = fresh fix stream, STALE = no fix for a while, OFFLINE = expired. */
export type PresenceStage = "LIVE" | "STALE" | "OFFLINE";
export type SharingStatus = "LIVE" | "STALE" | "OFF";

export interface DeviceSummary {
  id: string;
  name: string;
  phone: string | null;
  platform: DevicePlatform;
  isActive: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  sharing: SharingStatus;
  online: boolean;
  presence: PresenceStage;
}

export interface EnrolledDevice {
  deviceId: string;
  deviceToken: string;
  name: string;
  phone: string | null;
}

export interface LocationFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: string;
}

export interface LocationStatus {
  deviceId: string;
  deviceName: string;
  ownerId: string;
  sharing: SharingStatus;
  online: boolean;
  presence: PresenceStage;
  permissionStatus: "GRANTED" | "DENIED" | "REVOKED" | "UNKNOWN";
  isTestDevice: boolean;
  lastKnown: LocationFix | null;
  lastUpdated: string | null;
  offlineDurationMs: number;
  session: {
    id: string;
    mode: TrackingMode;
    intervalMs: number;
    startedAt: string;
  } | null;
  consent: {
    consentVersion: string;
    locationPermission: boolean;
    grantedAt: string;
    revokedAt: string | null;
  } | null;
}

export interface LocationHistory {
  items: LocationFix[];
  total: number;
  range: string;
  from: string;
  to: string;
}

export interface DeviceClientInfo {
  id: string;
  name: string;
  platform: DevicePlatform;
  sharing: boolean;
  session: { mode: TrackingMode; intervalMs: number; startedAt: string } | null;
  consentGranted: boolean;
  isTestDevice: boolean;
  dataPolicy: {
    consentVersion: string;
    retentionHours: number;
    sessionTtlHours: number;
    staleThresholdMs: number;
    offlineThresholdMs: number;
  };
}

/** WebSocket payloads emitted by the backend. */
export interface WsLocationUpdate extends LocationFix {
  deviceId: string;
}

export interface WsDeviceEvent {
  deviceId: string;
  timestamp?: string;
  lastSeenAt?: string;
  sessionId?: string;
  stage?: PresenceStage;
}

export interface WsSessionEvent {
  deviceId: string;
  sessionId: string;
  mode?: TrackingMode;
  intervalMs?: number;
  startedAt?: string;
  stoppedAt?: string;
  timestamp?: string;
}

export interface WsPermissionEvent {
  deviceId: string;
  permissionStatus: "GRANTED" | "DENIED" | "REVOKED";
  sharingStopped: boolean;
  timestamp?: string;
}

export interface DataPolicies {
  locationRetentionHours: number;
  locationSessionTtlHours: number;
  locationStaleThresholdMs: number;
  locationOfflineThresholdMs: number;
}

export type EnrollmentStatus = "ACTIVE" | "USED" | "EXPIRED" | "REVOKED";

export interface EnrollmentLink {
  id: string;
  url: string;
  token: string;
  purpose: string;
  deviceName: string | null;
  platform: string | null;
  phone: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface EnrollmentSummary {
  id: string;
  purpose: string;
  deviceName: string | null;
  platform: string | null;
  phone: string | null;
  status: EnrollmentStatus;
  expiresAt: string;
  createdAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  deviceId: string | null;
}

/* ── User Portal (consent-based monitoring) DTOs ─────────────────────────── */

export type PermissionType = "LOCATION" | "CAMERA" | "MICROPHONE" | "NOTIFICATIONS";
export type PermissionState = "NOT_REQUESTED" | "GRANTED" | "DENIED" | "REVOKED" | "UNAVAILABLE";

export interface PermissionRecord {
  type: PermissionType;
  state: PermissionState;
  consentVersion: string;
  privacyPolicyVersion: string;
  requestedAt: string | null;
  grantedAt: string | null;
  deniedAt: string | null;
  browser: string | null;
  os: string | null;
  updatedAt: string;
}

export interface UserSelfSummary {
  id: string;
  accountId: string;
  name: string;
  email: string;
  username: string | null;
  mobile: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  createdAt: string;
  role: Role;
  isActive: boolean;
  settings: {
    consentAcknowledged: boolean;
    retentionDays: number;
    autoPurge: boolean;
  };
  permissions: PermissionRecord[];
  webDevice: {
    id: string;
    status: string;
    permissionStatus: string;
    locationSharing: boolean;
    lastSeenAt: string | null;
    lastFix: { latitude: number; longitude: number; accuracy: number; timestamp: string } | null;
    session: { id: string; mode: TrackingMode; intervalMs: number; startedAt: string; status?: string } | null;
  } | null;
  camera: CameraSession | null;
  monitoring: { status: string; startedAt: string | null; stoppedAt: string | null } | null;
}

export type CameraMode = "CAPTURE" | "LIVE";
export type CameraSessionStatus = "ACTIVE" | "ENDED";

export interface CameraSession {
  id: string;
  userId: string;
  status: CameraSessionStatus;
  mode: CameraMode;
  startedAt: string;
  endedAt: string | null;
  endedBy: "USER" | "ADMIN" | null;
}

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
  locationPermission: PermissionState;
  cameraPermission: PermissionState;
  microphonePermission: PermissionState;
  notificationPermission: PermissionState;
  lastSeen: string | null;
  lastLocationUpdate: string | null;
  browser: string | null;
  os: string | null;
  deviceCount: number;
  activeSessions: number;
  monitoringStatus: "INACTIVE" | "ACTIVE" | "SUSPENDED" | string;
}

export interface LiveMapUser {
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

export interface UserProfile {
  identity: {
    id: string;
    accountId: string;
    name: string;
    email: string;
    username: string | null;
    mobile: string | null;
    country: string | null;
    state: string | null;
    city: string | null;
    role: Role;
    isActive: boolean;
    createdAt: string;
    lastLoginAt: string | null;
  };
  account: {
    registrationDate: string;
    settings: {
      consentAcknowledged: boolean;
      retentionDays: number;
      autoPurge: boolean;
    } | null;
    activeSessions: number;
    totalSessions: number;
    recentLogins: unknown[];
    securityEvents: unknown[];
  };
  device: {
    id: string;
    name: string;
    platform: string;
    browser: string | null;
    os: string | null;
    permissionStatus: string;
    status: string;
    lastSeenAt: string | null;
    sessions: { id: string; mode: TrackingMode; status: string; startedAt: string; stoppedAt: string | null }[];
  } | null;
  location: {
    current: { latitude: number; longitude: number; accuracy: number; timestamp: string; isTest: boolean } | null;
    history: { latitude: number; longitude: number; accuracy: number; timestamp: string; isTest: boolean }[];
    session: { id: string; mode: TrackingMode; intervalMs: number; startedAt: string; status: string; stoppedAt: string | null } | null;
  };
  permissions: {
    type: PermissionType;
    state: PermissionState;
    consentVersion: string;
    grantedAt: string | null;
    deniedAt: string | null;
  }[];
  monitoring: { status: string; startedAt: string | null; stoppedAt: string | null } | null;
  dataPolicy: {
    retentionHours: number;
    sessionTtlHours: number;
    consentVersion: string;
    privacyPolicyVersion: string;
  };
}

export interface AdminCameraSession extends CameraSession {
  user: { id: string; name: string; email: string };
}

export interface WsUserEvent {
  userId: string;
  timestamp?: string;
}

export interface WsMonitorEvent {
  userId: string;
  status: string;
  timestamp?: string;
}

export interface WsCameraEvent {
  userId: string;
  sessionId: string;
  mode?: CameraMode;
  startedAt?: string;
  endedAt?: string;
  timestamp?: string;
}
