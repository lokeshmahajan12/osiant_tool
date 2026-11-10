import { io, type Socket } from "socket.io-client";
import type { WsCameraEvent, WsDeviceEvent, WsLocationUpdate, WsMonitorEvent, WsPermissionEvent, WsSessionEvent, WsUserEvent } from "../types";
import { getToken } from "./api";

export interface LocationSocketEvents {
  onLocationUpdate?: (payload: WsLocationUpdate) => void;
  onDeviceOnline?: (payload: WsDeviceEvent) => void;
  onDeviceOffline?: (payload: WsDeviceEvent) => void;
  onDeviceStale?: (payload: WsDeviceEvent) => void;
  onDeviceLive?: (payload: WsDeviceEvent) => void;
  onSessionExpired?: (payload: WsDeviceEvent) => void;
  onStarted?: (payload: WsSessionEvent) => void;
  onStopped?: (payload: WsSessionEvent) => void;
  onPermissionChanged?: (payload: WsPermissionEvent) => void;
  onPermissionUpdated?: (payload: WsPermissionEvent) => void;
  onUserConnected?: (payload: WsUserEvent) => void;
  onUserDisconnected?: (payload: WsUserEvent) => void;
  onMonitorStarted?: (payload: WsMonitorEvent) => void;
  onMonitorStopped?: (payload: WsMonitorEvent) => void;
  onUserSuspended?: (payload: WsMonitorEvent) => void;
  onUserLoggedOut?: (payload: WsUserEvent) => void;
  onAuthorizationRevoked?: (payload: WsUserEvent) => void;
  onCameraStarted?: (payload: WsCameraEvent) => void;
  onCameraEnded?: (payload: WsCameraEvent) => void;
  onReady?: () => void;
  onDisconnect?: () => void;
  onError?: (message: string) => void;
}

/**
 * Open an authenticated Socket.IO connection to the backend. The JWT is sent
 * during the handshake so only authorized dashboard users receive location
 * events for the devices they manage.
 */
export function connectLocationSocket(events: LocationSocketEvents): Socket {
  const token = getToken();
  const metaEnv = (import.meta as unknown as { env?: { VITE_WEBSOCKET_URL?: string; DEV?: boolean } }).env;
  const backendWsUrl = metaEnv?.VITE_WEBSOCKET_URL ?? undefined;
  const socket = io(backendWsUrl, { path: "/socket.io", auth: { token } });

  socket.on("connect", () => {
    events.onReady?.();
  });
  socket.on("connection:ready", () => {
    events.onReady?.();
  });
  socket.on("disconnect", () => {
    events.onDisconnect?.();
  });
  socket.on("connect_error", (err) => {
    events.onError?.(err.message === "unauthorized" ? "Live feed: session expired, please sign in again." : "Live feed: connection failed.");
  });

  socket.on("location:update", (payload: WsLocationUpdate) => events.onLocationUpdate?.(payload));
  socket.on("device:online", (payload: WsDeviceEvent) => events.onDeviceOnline?.(payload));
  socket.on("device:offline", (payload: WsDeviceEvent) => events.onDeviceOffline?.(payload));
  socket.on("device:stale", (payload: WsDeviceEvent) => events.onDeviceStale?.(payload));
  socket.on("device:live", (payload: WsDeviceEvent) => events.onDeviceLive?.(payload));
  socket.on("session:expired", (payload: WsDeviceEvent) => events.onSessionExpired?.(payload));
  socket.on("session:live", (payload: WsDeviceEvent) => events.onDeviceLive?.(payload));
  socket.on("session:stale", (payload: WsDeviceEvent) => events.onDeviceStale?.(payload));
  socket.on("session:offline", (payload: WsDeviceEvent) => events.onDeviceOffline?.(payload));
  socket.on("session:started", (payload: WsSessionEvent) => events.onStarted?.(payload));
  socket.on("location:started", (payload: WsSessionEvent) => events.onStarted?.(payload));
  socket.on("session:ended", (payload: WsSessionEvent) => events.onStopped?.(payload));
  socket.on("location:stopped", (payload: WsSessionEvent) => events.onStopped?.(payload));
  socket.on("permission:changed", (payload: WsPermissionEvent) => events.onPermissionChanged?.(payload));
  socket.on("permission:updated", (payload: WsPermissionEvent) => events.onPermissionUpdated?.(payload));
  socket.on("user:connected", (payload: WsUserEvent) => events.onUserConnected?.(payload));
  socket.on("user:disconnected", (payload: WsUserEvent) => events.onUserDisconnected?.(payload));
  socket.on("admin:monitor-started", (payload: WsMonitorEvent) => events.onMonitorStarted?.(payload));
  socket.on("admin:monitor-stopped", (payload: WsMonitorEvent) => events.onMonitorStopped?.(payload));
  socket.on("admin:user-suspended", (payload: WsMonitorEvent) => events.onUserSuspended?.(payload));
  socket.on("admin:user-logged-out", (payload: WsUserEvent) => events.onUserLoggedOut?.(payload));
  socket.on("admin:authorization-revoked", (payload: WsUserEvent) => events.onAuthorizationRevoked?.(payload));
  socket.on("camera:started", (payload: WsCameraEvent) => events.onCameraStarted?.(payload));
  socket.on("camera:ended", (payload: WsCameraEvent) => events.onCameraEnded?.(payload));

  return socket;
}

export function disconnectLocationSocket(socket: Socket | null): void {
  if (socket) socket.disconnect();
}