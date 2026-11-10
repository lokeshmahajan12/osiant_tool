import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { LocationFix, PermissionState, TrackingMode, UserSelfSummary } from "../types";
import { Button, Card, EmptyState, Spinner, StatCard, formatDate, timeAgo } from "../components/ui";
import { PresenceBadge } from "../components/LiveStatusBadge";
import { ConsentBanner } from "../components/ConsentBanner";
import { LiveMap, type LivePoint } from "../components/LiveMap";
import { useToast } from "../context/ToastContext";

const PERMISSION_DENIED_MESSAGE = "Location unavailable — user device/browser permission is not currently granted.";

function sanitizeAccuracy(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, value), 10_000);
}

export function UserDashboard() {
  const { push: toast } = useToast();
  const [summary, setSummary] = useState<UserSelfSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [lastFix, setLastFix] = useState<LocationFix | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [mode, setMode] = useState<TrackingMode>("NORMAL");
  const [history, setHistory] = useState<LocationFix[]>([]);
  const [historyRange, setHistoryRange] = useState("24h");
  const watchRef = useRef<number | null>(null);

  const reload = useCallback(async () => {
    try {
      const { summary: s } = await api.getSelfSummary();
      setSummary(s);
      setSharing(s.webDevice?.locationSharing ?? false);
      setLastFix(
        s.webDevice?.lastFix
          ? { ...s.webDevice.lastFix, altitude: null, speed: null, heading: null }
          : null
      );
    } catch {
      /* surface via error state */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // The user's own recorded route. A non-ADMIN caller always resolves to their
  // own web device server-side, so this can never leak another user's history.
  useEffect(() => {
    if (!summary) return;
    let cancelled = false;
    void api
      .getUserLocationHistory(summary.id, { range: historyRange })
      .then((h) => {
        if (!cancelled) setHistory(h.items);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [summary, historyRange, sharing]);

  // The live watchPosition fix wins; otherwise fall back to the last fix the
  // server has on record so the pin shows up even before sharing starts.
  const points: LivePoint[] = useMemo(() => {
    const fix = lastFix ?? summary?.webDevice?.lastFix ?? null;
    if (!fix) return [];
    return [
      {
        id: summary?.webDevice?.id ?? "self",
        label: summary?.name ?? "This device",
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracy: fix.accuracy,
        isSelected: true,
      },
    ];
  }, [lastFix, summary]);

  useEffect(() => {
    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, []);

  const stopSharing = useCallback(async () => {
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    setSharing(false);
    setLastError(null);
    try {
      await api.locationSessionStop();
    } catch {
      /* best effort */
    }
  }, []);

  const startSharing = useCallback(async () => {
    setShareBusy(true);
    setLastError(null);
    try {
      await api.locationSessionStart(mode);
      setSharing(true);
      toast("success", "Location sharing started");
      const errorRef = watchRef;
      errorRef.current = navigator.geolocation.watchPosition(
        async (pos) => {
          const fix: LocationFix = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: sanitizeAccuracy(pos.coords.accuracy),
            altitude: pos.coords.altitude,
            speed: pos.coords.speed,
            heading: pos.coords.heading,
            timestamp: new Date(pos.timestamp).toISOString(),
          };
          setLastFix(fix);
          try {
            await api.locationUpdate(fix);
          } catch {
            /* transient push failure — watch continues */
          }
        },
        async (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            await api.updatePermission("LOCATION", "DENIED");
            await stopSharing();
            setLastError(PERMISSION_DENIED_MESSAGE);
          } else {
            setLastError("Location fix unavailable: " + err.message);
          }
        },
        { enableHighAccuracy: mode === "HIGH_ACCURACY", maximumAge: 15_000, timeout: 20_000 }
      );
    } catch (err) {
      setLastError(err instanceof Error ? err.message : "Failed to start location sharing");
    } finally {
      setShareBusy(false);
    }
  }, [mode, stopSharing, toast]);

  const toggleSharing = () => {
    if (sharing) void stopSharing();
    else void startSharing();
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner label="Loading your dashboard…" />
      </div>
    );
  }

  if (!summary) {
    return <EmptyState title="Unable to load your dashboard" hint="Refresh the page or sign in again." />;
  }

  const permissionState = (t: string): PermissionState =>
    summary.permissions.find((p) => p.type === t)?.state ?? "NOT_REQUESTED";
  const locationState = permissionState("LOCATION");
  const granted = locationState === "GRANTED";
  const denied = locationState === "DENIED" || locationState === "REVOKED" || locationState === "UNAVAILABLE";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-xl font-semibold text-slate-100">Welcome, {summary.name}</h1>
        <p className="mt-1 text-sm text-slate-500">Your consent-based monitoring portal · {summary.email}</p>
      </div>

      {!summary.settings?.consentAcknowledged && (
        <ConsentBanner
          onDismiss={() => {
            void api.updateSettings({ consentAcknowledged: true }).then(() => reload());
          }}
        />
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Account status" value={summary.isActive ? "ACTIVE" : "DISABLED"} tone={summary.isActive ? "accent" : "danger"} />
        <StatCard label="Last fix" value={summary.webDevice?.lastFix ? timeAgo(summary.webDevice.lastFix.timestamp) : "—"} />
        <StatCard label="Device" value={summary.webDevice ? summary.webDevice.status : "—"} />
        <StatCard label="Monitoring" value={summary.monitoring?.status ?? "INACTIVE"} tone={summary.monitoring?.status === "ACTIVE" ? "accent" : "default"} />
      </div>

      <Card title="My live location">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              {points.length > 0
                ? "Your most recent fix, with the route you have recorded while sharing."
                : "No fix recorded yet — start sharing to plot your position on the map."}
            </p>
            <select
              className="input max-w-[180px] py-1.5 text-xs"
              value={historyRange}
              onChange={(e) => setHistoryRange(e.target.value)}
              aria-label="Map history range"
            >
              <option value="1h">Last hour</option>
              <option value="6h">Last 6 hours</option>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
            </select>
          </div>
          <div className="h-[360px]">
            <LiveMap points={points} history={history} fitKey="self" />
          </div>
          <p className="text-[11px] text-slate-600">
            {history.length > 0
              ? `${history.length} recorded fix${history.length === 1 ? "" : "es"} in this window.`
              : "No recorded fixes in this window."}
          </p>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Location sharing">
          <div className="space-y-4 text-sm text-slate-300">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <PresenceBadge stage={sharing ? "LIVE" : summary.webDevice?.locationSharing ? "LIVE" : "OFFLINE"} />
                  <span className="text-xs text-slate-500">
                    {granted ? "Browser permission granted" : denied ? "Browser permission not granted" : "Browser permission not yet requested"}
                  </span>
                </div>
                {lastFix && (
                  <p className="mt-2 font-mono text-xs text-slate-400">
                    {lastFix.latitude.toFixed(5)}, {lastFix.longitude.toFixed(5)} · ±{lastFix.accuracy.toFixed(0)}m
                  </p>
                )}
                {summary.webDevice?.lastSeenAt && (
                  <p className="mt-1 text-[11px] text-slate-600">Last sync {timeAgo(summary.webDevice.lastSeenAt)}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <select className="input max-w-[180px] py-1.5 text-xs" value={mode} onChange={(e) => setMode(e.target.value as TrackingMode)} disabled={sharing}>
                  <option value="NORMAL">Normal accuracy</option>
                  <option value="HIGH_ACCURACY">High accuracy</option>
                  <option value="BATTERY_SAVING">Battery saving</option>
                </select>
                <Button variant={sharing ? "danger" : "primary"} onClick={toggleSharing} loading={shareBusy} disabled={denied}>
                  {sharing ? "Stop sharing" : "Start sharing"}
                </Button>
              </div>
            </div>
            {denied && (
              <div className="rounded-md border border-signal-danger/30 bg-signal-danger/10 px-3 py-2 text-xs text-red-300">
                {PERMISSION_DENIED_MESSAGE}
              </div>
            )}
            {lastError && !denied && (
              <div className="rounded-md border border-signal-warn/30 bg-signal-warn/10 px-3 py-2 text-xs text-signal-warn">{lastError}</div>
            )}
            <p className="text-[11px] leading-relaxed text-slate-500">
              Sharing is consent-based. A session and audited consent record is created server-side and visible to
              authorized administrators. You can stop sharing at any time.
            </p>
          </div>
        </Card>

        <Card title="Permissions & devices">
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              {(["LOCATION", "CAMERA", "MICROPHONE", "NOTIFICATIONS"] as const).map((t) => (
                <div key={t} className="flex items-center justify-between rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5">
                  <span className="text-xs text-slate-300">{t.charAt(0) + t.slice(1).toLowerCase()}</span>
                  <span
                    className={`badge ${
                      permissionState(t) === "GRANTED"
                        ? "bg-signal/15 text-signal"
                        : permissionState(t) === "DENIED" || permissionState(t) === "REVOKED"
                        ? "bg-signal-danger/15 text-signal-danger"
                        : "bg-slate-500/15 text-slate-400"
                    }`}
                  >
                    {permissionState(t)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <Link to="/permission-center" className="btn-primary text-xs">
                Open permission center
              </Link>
              <Link to="/camera" className="btn-ghost text-xs">
                Camera
              </Link>
              <Link to="/privacy" className="btn-ghost text-xs">
                Privacy policy
              </Link>
            </div>
          </div>
        </Card>

        <Card title="Identity & account">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div><dt className="panel-title">Name</dt><dd className="mt-0.5 text-slate-200">{summary.name}</dd></div>
            <div><dt className="panel-title">Email</dt><dd className="mt-0.5 text-slate-200">{summary.email}</dd></div>
            <div><dt className="panel-title">Username</dt><dd className="mt-0.5 text-slate-200">{summary.username ?? "—"}</dd></div>
            <div><dt className="panel-title">Mobile</dt><dd className="mt-0.5 text-slate-200">{summary.mobile ?? "—"}</dd></div>
            <div><dt className="panel-title">Location</dt><dd className="mt-0.5 text-slate-200">{[summary.country, summary.state, summary.city].filter(Boolean).join(", ") || "—"}</dd></div>
            <div><dt className="panel-title">Joined</dt><dd className="mt-0.5 text-slate-200">{formatDate(summary.createdAt)}</dd></div>
          </dl>
        </Card>

        <Card title="Camera status">
          {summary.camera && summary.camera.status === "ACTIVE" ? (
            <div className="space-y-3 text-sm text-slate-300">
              <div className="flex items-center justify-between">
                <span>Camera session is <strong className="text-signal">ACTIVE</strong></span>
                <span className="badge bg-signal/15 text-signal">LIVE</span>
              </div>
              <p className="text-xs text-slate-500">
                Started {timeAgo(summary.camera.startedAt)} · mode {summary.camera.mode}
              </p>
              <Link to="/camera" className="btn-danger text-xs">Manage camera session</Link>
            </div>
          ) : (
            <div className="flex items-center justify-between text-sm text-slate-300">
              <span>No active camera session</span>
              <Link to="/camera" className="btn-ghost text-xs">Open camera</Link>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}