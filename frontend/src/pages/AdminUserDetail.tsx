import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Socket } from "socket.io-client";
import { api } from "../lib/api";
import type { LocationFix, PermissionState, UserProfile } from "../types";
import { Button, Card, ConfirmDialog, EmptyState, Spinner, formatDate, timeAgo } from "../components/ui";
import { LiveMap, type LivePoint, type MapStyle } from "../components/LiveMap";
import { connectLocationSocket, disconnectLocationSocket } from "../lib/socket";
import { useToast } from "../context/ToastContext";

function permissionBadge(state: PermissionState) {
  if (state === "GRANTED") return "bg-signal/15 text-signal";
  if (state === "DENIED" || state === "REVOKED") return "bg-signal-danger/15 text-signal-danger";
  if (state === "UNAVAILABLE") return "bg-signal-warn/15 text-signal-warn";
  return "bg-slate-500/15 text-slate-400";
}

interface ConfirmState {
  kind: "monitor-stop" | "monitor-suspend" | "logout" | "revoke" | "delete-history" | "delete-sessions" | "disable" | "enable" | "camera-end";
  title: string;
  message: string;
  label: string;
}

export function AdminUserDetail() {
  const { id } = useParams<{ id: string }>();
  const { push: toast } = useToast();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [history, setHistory] = useState<LocationFix[]>([]);
  const [liveFix, setLiveFix] = useState<LocationFix | null>(null);
  const [range, setRange] = useState("24h");
  const [mapStyle, setMapStyle] = useState<MapStyle>("voyager");
  const socketRef = useRef<Socket | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { profile: p } = await api.getUserProfile(id);
      setProfile(p);
      setLiveFix(p.location.current ? { ...p.location.current, altitude: null, speed: null, heading: null, timestamp: p.location.current.timestamp } : null);
      const h = await api.getUserLocationHistory(id, { range });
      setHistory(h.items.map((f) => ({ ...f, timestamp: f.timestamp })));
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to load user profile");
    } finally {
      setLoading(false);
    }
  }, [id, range, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Follow live location updates for this user's web device via Socket.IO.
  useEffect(() => {
    if (!id || !profile?.device?.id) return;
    const socket = connectLocationSocket({
      onLocationUpdate: (payload) => {
        if (payload.deviceId !== profile.device?.id) return;
        setLiveFix({ latitude: payload.latitude, longitude: payload.longitude, accuracy: payload.accuracy, altitude: payload.altitude, speed: payload.speed, heading: payload.heading, timestamp: payload.timestamp });
      },
    });
    socketRef.current = socket;
    return () => {
      disconnectLocationSocket(socket);
      socketRef.current = null;
    };
  }, [id, profile?.device?.id]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusyAction(key);
    try {
      const res = await fn();
      const note = (res as { message?: string } | null)?.message;
      toast("success", note ?? "Action completed");
      void load();
      return res;
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Action failed");
      return null;
    } finally {
      setBusyAction(null);
    }
  };

  // The pin comes from the live fix while the device streams, otherwise from
  // the newest recorded fix — so the map still plots a position (and still fits
  // the route) after sharing stops, instead of rendering an empty box.
  const newestFix = useMemo(
    () =>
      history.reduce<LocationFix | null>(
        (acc, f) => (!acc || new Date(f.timestamp).getTime() > new Date(acc.timestamp).getTime() ? f : acc),
        null
      ),
    [history]
  );
  const effectiveFix: LocationFix | null = liveFix ?? newestFix;
  const points: LivePoint[] = useMemo(() => {
    if (!effectiveFix || !profile) return [];
    return [
      {
        id: profile.identity.id,
        label: profile.identity.name,
        latitude: effectiveFix.latitude,
        longitude: effectiveFix.longitude,
        accuracy: effectiveFix.accuracy,
        isSelected: true,
      },
    ];
  }, [effectiveFix, profile]);

  if (loading || !profile) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner label="Loading user intelligence…" />
      </div>
    );
  }

  const { identity, account, device, permissions, monitoring, dataPolicy } = profile;

  const monitoringActive = monitoring?.status === "ACTIVE";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <Link to="/admin/users" className="btn-ghost text-xs">← Directory</Link>
            <h1 className="font-mono text-xl font-semibold text-slate-100">{identity.name}</h1>
            <span className={`badge ${identity.isActive ? "bg-signal/15 text-signal" : "bg-signal-danger/15 text-signal-danger"}`}>
              {identity.isActive ? "ACTIVE" : "DISABLED"}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">{identity.email} · {identity.role}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" className="text-xs" disabled={monitoringActive} onClick={() => run("monitor-start", () => api.monitorStart(identity.id))}>
            Start monitoring
          </Button>
          {monitoringActive && (
            <Button variant="ghost" className="text-xs" onClick={() => setConfirm({ kind: "monitor-stop", title: "Stop monitoring", message: `Stop monitoring for ${identity.name}? Active location sharing sessions will be stopped.`, label: "Stop monitoring" })}>
              Stop monitoring
            </Button>
          )}
          <Button variant="ghost" className="text-xs" onClick={() => setConfirm({ kind: "monitor-suspend", title: "Suspend monitoring", message: `Suspend monitoring for ${identity.name}? Sharing sessions will be stopped until re-enabled.`, label: "Suspend" })}>
            Suspend
          </Button>
          {monitoring?.status === "SUSPENDED" && (
            <Button variant="ghost" className="text-xs" onClick={() => run("monitor-enable", () => api.monitorEnable(identity.id))}>
              Re-enable
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card title="Joined"><div className="font-mono text-sm text-slate-200">{formatDate(identity.createdAt)}</div></Card>
        <Card title="Last login"><div className="text-sm text-slate-300">{identity.lastLoginAt ? timeAgo(identity.lastLoginAt) : "never"}</div></Card>
        <Card title="Sessions"><div className="font-mono text-sm text-slate-200">{account.activeSessions} active / {account.totalSessions}</div></Card>
        <Card title="Monitoring"><div className={`font-mono text-sm ${monitoringActive ? "text-signal" : monitoring?.status === "SUSPENDED" ? "text-signal-warn" : "text-slate-400"}`}>{monitoring?.status ?? "INACTIVE"}</div></Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Identity">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div><dt className="panel-title">Name</dt><dd className="mt-0.5 text-slate-200">{identity.name}</dd></div>
            <div><dt className="panel-title">Email</dt><dd className="mt-0.5 text-slate-200">{identity.email}</dd></div>
            <div><dt className="panel-title">Username</dt><dd className="mt-0.5 text-slate-200">{identity.username ?? "—"}</dd></div>
            <div><dt className="panel-title">Mobile</dt><dd className="mt-0.5 text-slate-200">{identity.mobile ?? "—"}</dd></div>
            <div><dt className="panel-title">Location</dt><dd className="mt-0.5 text-slate-200">{[identity.country, identity.state, identity.city].filter(Boolean).join(", ") || "—"}</dd></div>
            <div><dt className="panel-title">Account ID</dt><dd className="mt-0.5 font-mono text-[11px] text-slate-500">{identity.accountId}</dd></div>
          </dl>
        </Card>

        <Card title="Browser device">
          {device ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div><dt className="panel-title">Device</dt><dd className="mt-0.5 text-slate-200">{device.name}</dd></div>
              <div><dt className="panel-title">Platform</dt><dd className="mt-0.5 text-slate-200">{device.platform}</dd></div>
              <div><dt className="panel-title">Browser / OS</dt><dd className="mt-0.5 truncate text-xs text-slate-300">{[device.browser, device.os].filter(Boolean).join(" · ") || "—"}</dd></div>
              <div><dt className="panel-title">Permission</dt><dd className="mt-0.5">
                <span className={`badge ${permissionBadge(device.permissionStatus as PermissionState)}`}>{device.permissionStatus}</span>
              </dd></div>
              <div><dt className="panel-title">Status</dt><dd className="mt-0.5 text-slate-200">{device.status}</dd></div>
              <div><dt className="panel-title">Last seen</dt><dd className="mt-0.5 text-slate-200">{device.lastSeenAt ? timeAgo(device.lastSeenAt) : "never"}</dd></div>
            </dl>
          ) : (
            <EmptyState title="No web device registered" hint="This account has no browser device." />
          )}
        </Card>

        <Card title="Permissions">
          <div className="grid grid-cols-2 gap-3">
            {permissions.map((p) => (
              <div key={p.type} className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-300">{p.type.charAt(0) + p.type.slice(1).toLowerCase()}</span>
                  <span className={`badge ${permissionBadge(p.state)}`}>{p.state}</span>
                </div>
                <div className="mt-1 text-[10px] text-slate-600">
                  {p.consentVersion && <>consent v{p.consentVersion}</>}
                  {p.grantedAt && <> · {timeAgo(p.grantedAt)}</>}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Admin control center">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" className="text-xs" onClick={() => setConfirm({ kind: "logout", title: "Force logout", message: `Revoke every session for ${identity.name}? They will be signed out immediately.`, label: "Force logout" })}>
                Force logout
              </Button>
              <Button variant="ghost" className="text-xs" onClick={() => setConfirm({ kind: "revoke", title: "Revoke authorization", message: `Revoke application-side monitoring authorization for ${identity.name}? All permissions become REVOKED and sharing stops.`, label: "Revoke authorization", })}>
                Revoke authorization
              </Button>
              <Button variant="ghost" className="text-xs" onClick={() => setConfirm({ kind: "delete-history", title: "Delete location history", message: `Permanently delete all recorded location history for ${identity.name}. This cannot be undone.`, label: "Delete history", })}>
                Delete history
              </Button>
              <Button variant="ghost" className="text-xs" onClick={() => setConfirm({ kind: "delete-sessions", title: "Delete session data", message: `Delete all sessions, location sessions and events for ${identity.name}. This cannot be undone.`, label: "Delete session data", })}>
                Delete session data
              </Button>
              <Button variant="ghost" className="text-xs" onClick={() => setConfirm({ kind: "camera-end", title: "End camera session", message: "End this user's active camera session immediately?", label: "End camera session" })}>
                End camera
              </Button>
              <Button variant={identity.isActive ? "danger" : "primary"} className="text-xs" onClick={() => setConfirm({ kind: identity.isActive ? "disable" : "enable", title: identity.isActive ? "Disable account" : "Enable account", message: identity.isActive ? `Disable ${identity.name}'s account and revoke all sessions?` : `Re-enable ${identity.name}'s account?`, label: identity.isActive ? "Disable account" : "Enable account" })}>
                {identity.isActive ? "Disable account" : "Enable account"}
              </Button>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-600">
              All actions are recorded in the audit log and emit real-time events to the affected user's portal.
            </p>
          </div>
        </Card>
      </div>

      <Card
        title="Location intelligence"
        action={
          <div className="flex items-center gap-2">
            <select
              aria-label="Basemap"
              className="input max-w-[130px] py-1.5 text-xs"
              value={mapStyle}
              onChange={(e) => setMapStyle(e.target.value as MapStyle)}
            >
              <option value="voyager">Voyager</option>
              <option value="dark">Dark</option>
            </select>
            <select className="input max-w-[140px] py-1.5 text-xs" value={range} onChange={(e) => setRange(e.target.value)}>
              <option value="1h">Last hour</option>
              <option value="6h">Last 6 hours</option>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="all">All time</option>
            </select>
          </div>
        }
      >
        <div className="h-[420px]">
          <LiveMap points={points} history={history} fitKey={identity.id} style={mapStyle} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-400 md:grid-cols-4">
          <div><span className="panel-title">Current fix</span><div className="mt-0.5 font-mono text-slate-300">{effectiveFix ? `${effectiveFix.latitude.toFixed(5)}, ${effectiveFix.longitude.toFixed(5)}` : "none"}</div></div>
          <div><span className="panel-title">Accuracy</span><div className="mt-0.5 text-slate-300">{effectiveFix ? `±${effectiveFix.accuracy.toFixed(0)}m` : "—"}</div></div>
          <div><span className="panel-title">Fix time</span><div className="mt-0.5 text-slate-300">{effectiveFix ? timeAgo(effectiveFix.timestamp) : "—"}</div></div>
          <div><span className="panel-title">History points</span><div className="mt-0.5 text-slate-300">{history.length}</div></div>
        </div>
      </Card>

      <Card title="Data policy">
        <div className="grid grid-cols-2 gap-3 text-sm text-slate-300 md:grid-cols-4">
          <div><span className="panel-title">Retention</span><div className="mt-0.5">{dataPolicy.retentionHours}h</div></div>
          <div><span className="panel-title">Session TTL</span><div className="mt-0.5">{dataPolicy.sessionTtlHours}h</div></div>
          <div><span className="panel-title">Consent version</span><div className="mt-0.5 font-mono">{dataPolicy.consentVersion}</div></div>
          <div><span className="panel-title">Privacy policy</span><div className="mt-0.5 font-mono">{dataPolicy.privacyPolicyVersion}</div></div>
        </div>
      </Card>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ""}
        message={confirm?.message ?? ""}
        confirmLabel={confirm?.label ?? "Confirm"}
        danger={confirm?.kind === "disable" || confirm?.kind === "delete-history" || confirm?.kind === "delete-sessions" || confirm?.kind === "revoke" || confirm?.kind === "camera-end"}
        busy={busyAction !== null}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (!c) return;
          switch (c.kind) {
            case "monitor-stop": void run("monitor-stop", () => api.monitorStop(identity.id)); break;
            case "monitor-suspend": void run("monitor-suspend", () => api.monitorSuspend(identity.id)); break;
            case "logout": void run("logout", () => api.forceLogout(identity.id)); break;
            case "revoke": void run("revoke", () => api.revokeAuthorization(identity.id)); break;
            case "delete-history": void run("delete-history", () => api.deleteLocationHistory(identity.id)); break;
            case "delete-sessions": void run("delete-sessions", () => api.deleteSessionData(identity.id)); break;
            case "disable": void run("disable", () => api.updateUserStatus(identity.id, "inactive")); break;
            case "enable": void run("enable", () => api.updateUserStatus(identity.id, "active")); break;
            case "camera-end":
              void run("camera-end", async () => {
                const { session } = await api.adminCameraStatus(identity.id);
                if (!session) return { message: "No active camera session for this user" };
                await api.adminCameraEnd(identity.id, session.id);
              });
              break;
          }
        }}
      />
    </div>
  );
}