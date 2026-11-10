import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Socket } from "socket.io-client";
import type { DeviceSummary, LocationFix, LocationHistory, LocationStatus, TrackingMode, WsLocationUpdate } from "../types";
import { api, getStoredDeviceToken } from "../lib/api";
import { connectLocationSocket, disconnectLocationSocket } from "../lib/socket";
import { useToast } from "../context/ToastContext";
import { Button, Card, EmptyState, Modal, Tabs } from "../components/ui";
import { LiveMap, type LivePoint } from "../components/LiveMap";
import { LiveStatusBadge, PresenceBadge } from "../components/LiveStatusBadge";

const RANGES = [
  { id: "15m", label: "15 min" },
  { id: "1h", label: "1 hour" },
  { id: "6h", label: "6 hours" },
  { id: "24h", label: "24 hours" },
  { id: "custom", label: "Custom" },
] as const;

const MODES: { id: TrackingMode; label: string; hint: string }[] = [
  { id: "NORMAL", label: "Normal", hint: "update every 10–30s" },
  { id: "HIGH_ACCURACY", label: "High accuracy", hint: "update every 5–10s" },
  { id: "BATTERY_SAVING", label: "Battery saving", hint: "update every 30–60s" },
];

export function LiveLocation() {
  const { push } = useToast();
  const [searchParams] = useSearchParams();
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<LocationStatus | null>(null);
  const [liveFixes, setLiveFixes] = useState<Record<string, WsLocationUpdate>>({});
  const [history, setHistory] = useState<LocationHistory | null>(null);
  const [range, setRange] = useState<string>("1h");
  const [wsConnected, setWsConnected] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [trackingMode, setTrackingMode] = useState<TrackingMode>("NORMAL");
  const [busy, setBusy] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [now, setNow] = useState(Date.now());
  const socketRef = useRef<Socket | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const deviceQueryRef = useRef<string | null>(searchParams.get("device"));

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadDevices = useCallback(async () => {
    try {
      const { devices: list } = await api.listDevices();
      setDevices(list);
      setSelectedId((prev) => {
        // Prefer the device explicitly opened from the Devices page (?device=id),
        // then keep the current selection, then fall back to the first live one.
        const fromQuery = deviceQueryRef.current;
        if (fromQuery && list.some((d) => d.id === fromQuery)) return fromQuery;
        if (prev && list.some((d) => d.id === prev)) return prev;
        const live = list.find((d) => d.presence === "LIVE");
        return live?.id ?? list[0]?.id ?? null;
      });
      // Pre-fetch the last-known fix for every sharing device (LIVE or STALE)
      // so all of them appear on the map immediately, not just the selected one.
      const sharing = list.filter((d) => d.sharing !== "OFF");
      await Promise.allSettled(
        sharing.map(async (d) => {
          const { status: s } = await api.deviceStatus(d.id);
          const known = s.lastKnown;
          if (known) {
            setLiveFixes((prev) => ({
              ...prev,
              [d.id]: { ...known, deviceId: d.id, timestamp: known.timestamp },
            }));
          }
        })
      );
    } catch (err) {
      push("error", (err as Error).message);
    }
  }, [push]);

  const loadStatus = useCallback(async (id: string) => {
    try {
      const { status: s } = await api.deviceStatus(id);
      setStatus(s);
      const known = s.lastKnown;
      if (known) {
        setLiveFixes((prev) => ({
          ...prev,
          [id]: { ...known, deviceId: id, timestamp: known.timestamp },
        }));
      }
    } catch (err) {
      push("error", (err as Error).message);
    }
  }, [push]);

  const loadHistory = useCallback(
    async (id: string, rng: string) => {
      try {
        const params: { range: string; from?: string; to?: string } = { range: rng };
        if (rng === "custom") {
          if (!customFrom || !customTo) return;
          params.from = new Date(customFrom).toISOString();
          params.to = new Date(customTo).toISOString();
        }
        const h = await api.deviceHistory(id, params);
        setHistory(h);
      } catch (err) {
        push("error", (err as Error).message);
      }
    },
    [customFrom, customTo, push]
  );

  // Initial device load
  useEffect(() => {
    void loadDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load status + history when the selection or range changes
  useEffect(() => {
    if (!selectedId) {
      setStatus(null);
      setHistory(null);
      return;
    }
    void loadStatus(selectedId);
    void loadHistory(selectedId, range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, range]);

  // WebSocket real-time feed
  useEffect(() => {
    const socket = connectLocationSocket({
      onReady: () => {
        setWsConnected(true);
        setWsError(null);
      },
      onDisconnect: () => setWsConnected(false),
      onError: (message) => {
        setWsConnected(false);
        setWsError(message);
      },
      onLocationUpdate: (payload) => {
        setLiveFixes((prev) => ({ ...prev, [payload.deviceId]: payload }));
        setDevices((prev) =>
          prev.map((d) =>
            d.id === payload.deviceId
              ? { ...d, online: true, sharing: "LIVE", presence: "LIVE", lastSeenAt: payload.timestamp }
              : d
          )
        );
        setStatus((prev) => {
          if (prev && prev.deviceId === payload.deviceId) {
            return {
              ...prev,
              online: true,
              sharing: "LIVE",
              presence: "LIVE",
              lastKnown: {
                latitude: payload.latitude,
                longitude: payload.longitude,
                accuracy: payload.accuracy,
                altitude: payload.altitude,
                speed: payload.speed,
                heading: payload.heading,
                timestamp: payload.timestamp,
              },
              lastUpdated: payload.timestamp,
            };
          }
          return prev;
        });
        setHistory((prev) => {
          if (!prev || selectedIdRef.current !== payload.deviceId) return prev;
          const item: LocationFix = {
            latitude: payload.latitude,
            longitude: payload.longitude,
            accuracy: payload.accuracy,
            altitude: payload.altitude,
            speed: payload.speed,
            heading: payload.heading,
            timestamp: payload.timestamp,
          };
          return { ...prev, items: [...prev.items, item], total: prev.total + 1 };
        });
      },
      onDeviceOnline: (payload) => {
        setDevices((prev) => prev.map((d) => (d.id === payload.deviceId ? { ...d, online: true, presence: "LIVE", sharing: "LIVE" } : d)));
        setStatus((prev) => (prev && prev.deviceId === payload.deviceId ? { ...prev, online: true, presence: "LIVE", sharing: "LIVE" } : prev));
      },
      onDeviceLive: (payload) => {
        setDevices((prev) => prev.map((d) => (d.id === payload.deviceId ? { ...d, online: true, presence: "LIVE", sharing: "LIVE" } : d)));
        setStatus((prev) => (prev && prev.deviceId === payload.deviceId ? { ...prev, online: true, presence: "LIVE", sharing: "LIVE" } : prev));
      },
      onDeviceStale: (payload) => {
        setDevices((prev) => prev.map((d) => (d.id === payload.deviceId ? { ...d, online: true, presence: "STALE", sharing: "STALE" } : d)));
        setStatus((prev) => (prev && prev.deviceId === payload.deviceId ? { ...prev, online: true, presence: "STALE", sharing: "STALE" } : prev));
      },
      onDeviceOffline: (payload) => {
        setDevices((prev) => prev.map((d) => (d.id === payload.deviceId ? { ...d, online: false, presence: "OFFLINE", sharing: "STALE" } : d)));
        setStatus((prev) => (prev && prev.deviceId === payload.deviceId ? { ...prev, online: false, presence: "OFFLINE", sharing: "STALE" } : prev));
      },
      onSessionExpired: (payload) => {
        setDevices((prev) => prev.map((d) => (d.id === payload.deviceId ? { ...d, online: false, presence: "OFFLINE", sharing: "OFF" } : d)));
        if (payload.deviceId === selectedIdRef.current) void loadStatus(payload.deviceId);
      },
      onStarted: (payload) => {
        setDevices((prev) => prev.map((d) => (d.id === payload.deviceId ? { ...d, sharing: "LIVE", presence: "LIVE" } : d)));
        if (payload.deviceId === selectedIdRef.current) void loadStatus(payload.deviceId);
        // Re-fetch the real list so an optimistic "LIVE" is corrected to the
        // actual presence stage if the device has not started streaming yet.
        void loadDevices();
      },
      onStopped: (payload) => {
        setDevices((prev) => prev.map((d) => (d.id === payload.deviceId ? { ...d, sharing: "OFF", online: false, presence: "OFFLINE" } : d)));
        if (payload.deviceId === selectedIdRef.current) void loadStatus(payload.deviceId);
      },
      onPermissionChanged: (payload) => {
        const denied = payload.permissionStatus === "DENIED" || payload.permissionStatus === "REVOKED";
        setDevices((prev) =>
          prev.map((d) =>
            d.id === payload.deviceId ? { ...d, sharing: denied ? "OFF" : d.sharing, presence: denied ? "OFFLINE" : d.presence } : d
          )
        );
        if (payload.deviceId === selectedIdRef.current) void loadStatus(payload.deviceId);
        if (denied) push("error", "Permission denied for device — location sharing stopped.");
        else push("success", "Location permission granted for device.");
      },
    });
    socketRef.current = socket;
    return () => {
      disconnectLocationSocket(socket);
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh: periodically re-fetch the device list, the selected device's
  // status and its history so the map and panels stay up to date even if a
  // realtime event is missed or the websocket is down. Polls faster when the
  // live feed is unavailable so fixes still appear.
  useEffect(() => {
    const intervalMs = wsConnected ? 15_000 : 8_000;
    const timer = setInterval(() => {
      void loadDevices();
      const sel = selectedIdRef.current;
      if (sel) {
        void loadStatus(sel);
        void loadHistory(sel, range);
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [wsConnected, loadDevices, loadStatus, loadHistory, range]);

  // Offline-duration / "last updated" ticking
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const selected = devices.find((d) => d.id === selectedId) ?? null;
  const currentFix = selectedId ? liveFixes[selectedId] ?? null : null;
  const effectiveFix: LocationFix | null = useMemo(
    () => (currentFix ? { ...currentFix } : status?.lastKnown ?? null),
    [currentFix, status?.lastKnown]
  );
  const shareToken = selectedId ? getStoredDeviceToken(selectedId) : null;

  // Every pin for the map: the selected device's position (live or last known)
  // plus the last-known fixes of every other device with an active session
  // (LIVE or STALE). OFFLINE/stopped devices are not shown.
  const livePoints: LivePoint[] = useMemo(() => {
    const points: LivePoint[] = devices
      .filter((d) => d.id !== selectedId && d.sharing !== "OFF" && liveFixes[d.id])
      .map((d) => {
        const f = liveFixes[d.id];
        return {
          id: d.id,
          label: d.name,
          latitude: f.latitude,
          longitude: f.longitude,
          accuracy: f.accuracy,
          isSelected: false,
        };
      });
    if (selectedId && effectiveFix) {
      points.unshift({
        id: selectedId,
        label: selected?.name ?? "Device",
        latitude: effectiveFix.latitude,
        longitude: effectiveFix.longitude,
        accuracy: effectiveFix.accuracy,
        isSelected: true,
      });
    }
    return points;
  }, [devices, selectedId, liveFixes, effectiveFix, selected]);

  const offlineDuration = useMemo(() => {
    if (!selected || selected.presence === "LIVE") return 0;
    if (status?.lastUpdated) {
      const ms = now - new Date(status.lastUpdated).getTime();
      return Math.max(0, ms);
    }
    return 0;
  }, [selected, status, now]);

  const startSharing = async () => {
    if (!selectedId) return;
    const token = getStoredDeviceToken(selectedId);
    if (token) {
      // The device's pairing token is known, so hand off to the share page on
      // the device itself: it will prompt for location permission, create/attach
      // the session and start streaming GPS immediately. That is the only way a
      // real location ever reaches the map.
      window.open(`/enroll/${token}`, "_blank", "noopener");
      push("info", "Share page opened — approve the location permission there to begin streaming.");
      setConsentOpen(false);
      setConsentChecked(false);
      await loadDevices();
      return;
    }
    setBusy(true);
    try {
      await api.recordDeviceConsent(selectedId);
      const result = await api.startLocation(selectedId, trackingMode);
      push("success", `Location sharing started (${result.session.mode.toLowerCase().replace("_", " ")}). Open the device's share page to stream GPS.`);
      setConsentOpen(false);
      setConsentChecked(false);
      await loadStatus(selectedId);
      await loadDevices();
    } catch (err) {
      push("error", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stopSharing = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const result = await api.stopLocation(selectedId);
      push("success", result.stopped ? "Location sharing stopped." : "Location sharing was already stopped.");
      await loadStatus(selectedId);
      await loadDevices();
    } catch (err) {
      push("error", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resetPermission = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      await api.setDevicePermission(selectedId, "GRANTED");
      push("success", "Device permission reset — the share page can start streaming again.");
      await loadStatus(selectedId);
      await loadDevices();
    } catch (err) {
      push("error", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-xl font-semibold text-slate-100">Live Location</h1>
          <p className="mt-1 text-sm text-slate-500">
            Real-time GPS of devices that are actively sharing — always with the owner's explicit consent.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`badge ${wsConnected ? "bg-signal/15 text-signal" : "bg-signal-warn/15 text-signal-warn"}`}>
            <span className={`h-2 w-2 rounded-full ${wsConnected ? "bg-signal" : "bg-signal-warn"}`} />
            Live feed {wsConnected ? "connected" : "reconnecting…"}
          </span>
          {wsError && <span className="text-[11px] text-signal-danger">{wsError}</span>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
        {/* Left — authorized device list */}
        <Card title="Authorized devices" className="max-h-[560px] overflow-y-auto scroll-thin">
          {devices.length === 0 ? (
            <EmptyState title="No devices" hint="Enroll a device on the Devices page to begin." />
          ) : (
            <div className="space-y-2">
              {devices.map((d) => (
                <button
                  key={d.id}
                  onClick={() => {
                    // Clicking a device must immediately refresh that device's
                    // status and history (even when it is already selected) so
                    // the map pin and panels always reflect the live location.
                    setSelectedId(d.id);
                    void loadStatus(d.id);
                    void loadHistory(d.id, range);
                  }}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    selectedId === d.id
                      ? "border-accent-dim bg-accent/5"
                      : "border-ink-700 bg-ink-850/50 hover:border-accent-dim/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-sm text-slate-200">{d.name}</span>
                    <LiveStatusBadge sharing={d.sharing} compact />
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <PresenceBadge stage={d.presence} />
                    <span className="text-[10px] text-slate-500">{d.platform}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* Center — live map */}
        <Card className="p-0" title={undefined}>
          <div className="h-[420px] lg:h-[560px]">
            <LiveMap points={livePoints} history={history?.items ?? []} fitKey={selectedId ?? ""} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-700 px-4 py-2.5">
            <div className="flex gap-1">
              <Tabs tabs={RANGES.map((r) => ({ id: r.id, label: r.label }))} active={range} onChange={(r) => setRange(r)} />
            </div>
            <div className="flex items-center gap-1.5">
              {range === "custom" && (
                <>
                  <input type="datetime-local" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="input w-44 py-1 text-xs" aria-label="From" />
                  <input type="datetime-local" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="input w-44 py-1 text-xs" aria-label="To" />
                </>
              )}
              <Button
                variant="ghost"
                className="text-xs"
                onClick={() => {
                  if (selectedId) {
                    void loadStatus(selectedId);
                    void loadHistory(selectedId, range);
                  }
                }}
              >
                Refresh
              </Button>
            </div>
          </div>
        </Card>

        {/* Right — device information */}
        <Card title="Device information">
          {!selected ? (
            <EmptyState title="Select a device" />
          ) : (
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="panel-title">Status</span>
                <PresenceBadge stage={selected.presence} />
              </div>
              <div className="flex items-center justify-between">
                <span className="panel-title">Location sharing</span>
                <LiveStatusBadge sharing={selected.sharing} />
              </div>
              {effectiveFix && (
                <div className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-xs text-slate-300">
                  <span className="panel-title">Last update</span>{" "}
                  <span className="font-mono text-signal">{timeAgo(effectiveFix.timestamp)}</span>
                </div>
              )}
              <InfoRow label="Device name" value={selected.name} mono />
              <InfoRow label="Device ID" value={selected.id} mono />
              <InfoRow label="Latitude" value={effectiveFix ? effectiveFix.latitude.toFixed(6) : "—"} mono />
              <InfoRow label="Longitude" value={effectiveFix ? effectiveFix.longitude.toFixed(6) : "—"} mono />
              <InfoRow label="GPS accuracy" value={effectiveFix ? `${effectiveFix.accuracy.toFixed(1)} m` : "—"} mono />
              <InfoRow label="Speed" value={effectiveFix?.speed != null ? `${(effectiveFix.speed * 3.6).toFixed(1)} km/h` : "—"} mono />
              <InfoRow label="Heading" value={effectiveFix?.heading != null ? `${effectiveFix.heading.toFixed(0)}°` : "—"} mono />
              <InfoRow label="Last updated" value={effectiveFix?.timestamp ? timeAgo(effectiveFix.timestamp) : "never"} />
              {status?.session && (
                <InfoRow label="Update interval" value={`${(status.session.intervalMs / 1000).toFixed(0)}s · ${status.session.mode.toLowerCase().replace("_", " ")}`} />
              )}
              {status?.consent && (
                <InfoRow label="Consent" value={`v${status.consent.consentVersion} · granted ${timeAgo(status.consent.grantedAt)}`} />
              )}

              {status?.session && !status.lastKnown && (
                <div className="rounded-lg border border-signal-warn/30 bg-signal-warn/10 p-3 text-xs text-signal-warn">
                  <div className="font-semibold">Session active — waiting for GPS</div>
                  <div className="mt-1 text-slate-300">
                    The sharing session is running, but the device has not sent a location fix yet. Open the{" "}
                    <span className="font-semibold">"Share My Live Location"</span> page on the device and tap{" "}
                    <span className="font-semibold">Allow Location &amp; Share</span> to begin streaming. Fixes arrive
                    every {status.session.intervalMs / 1000}s.
                  </div>
                  {shareToken && (
                    <button
                      className="mt-2 w-full text-center text-[11px] font-semibold text-accent hover:underline"
                      onClick={() => window.open(`/enroll/${shareToken}`, "_blank", "noopener")}
                    >
                      Open the share page on this device
                    </button>
                  )}
                </div>
              )}

              {selected.presence === "OFFLINE" && (
                <div className="rounded-lg border border-signal-danger/30 bg-signal-danger/10 p-3 text-xs text-signal-danger">
                  <div className="font-semibold">Device Offline</div>
                  <div className="mt-1 text-slate-300">
                    Last known location: {effectiveFix ? `${effectiveFix.latitude.toFixed(5)}, ${effectiveFix.longitude.toFixed(5)}` : "unknown"}
                  </div>
                  {effectiveFix && <div className="mt-0.5 text-slate-300">Last updated: {formatTime(effectiveFix.timestamp)}</div>}
                  <div className="mt-0.5 text-slate-300">Offline duration: {formatDuration(offlineDuration)}</div>
                  <div className="mt-1 text-[11px] text-slate-400">Sharing resumes automatically when the device reconnects — unless permissions were revoked.</div>
                </div>
              )}
              {selected.presence === "STALE" && (
                <div className="rounded-lg border border-signal-warn/30 bg-signal-warn/10 p-3 text-xs text-signal-warn">
                  <div className="font-semibold">Signal Stale</div>
                  <div className="mt-1 text-slate-300">
                    No GPS fix received for a while. The session is still active and will recover automatically when the next fix arrives.
                  </div>
                </div>
              )}

              {(status?.permissionStatus === "DENIED" || status?.permissionStatus === "REVOKED") && (
                <div className="rounded-lg border border-signal-danger/30 bg-signal-danger/10 p-3 text-xs text-signal-danger">
                  <div className="font-semibold">Location permission {status.permissionStatus.toLowerCase()}</div>
                  <div className="mt-1 text-slate-300">
                    The device reported that location permission was denied or revoked, so sharing is stopped. After the
                    owner re-allows location in the browser/OS, reset permission here and reopen the share page on the device.
                  </div>
                  <Button
                    variant="danger"
                    className="mt-2 w-full"
                    onClick={() => void resetPermission()}
                    loading={busy}
                  >
                    Reset permission &amp; allow sharing
                  </Button>
                </div>
              )}

              <div className="border-t border-ink-700 pt-3">
                {status?.session ? (
                  <Button variant="danger" className="w-full" onClick={() => void stopSharing()} loading={busy}>
                    STOP LIVE LOCATION
                  </Button>
                ) : shareToken ? (
                  <Button className="w-full" onClick={() => void startSharing()} loading={busy}>
                    START LIVE LOCATION
                  </Button>
                ) : (
                  <Button className="w-full" onClick={() => setConsentOpen(true)} loading={busy}>
                    START LIVE LOCATION
                  </Button>
                )}
                {shareToken && !status?.session && (
                  <button
                    className="mt-2 w-full text-center text-[11px] text-accent hover:underline"
                    onClick={() => void startSharing()}
                  >
                    Open the share page on this device
                  </button>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Bottom — history timeline */}
      <Card title={`Location history${history ? ` · ${history.total} point(s)` : ""}`}>
        {!selected ? (
          <EmptyState title="Select a device" />
        ) : history === null ? (
          <div className="py-6 text-center text-sm text-slate-500">Loading history…</div>
        ) : history.items.length === 0 ? (
          <EmptyState title="No location fixes in this window" hint="Start live location sharing to begin recording real GPS fixes." />
        ) : (
          <div className="max-h-64 overflow-y-auto scroll-thin">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-ink-900">
                <tr className="border-b border-ink-700 text-xs uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3">Time</th>
                  <th className="py-2 pr-3">Latitude</th>
                  <th className="py-2 pr-3">Longitude</th>
                  <th className="py-2 pr-3">Accuracy</th>
                  <th className="py-2 pr-3">Speed</th>
                  <th className="py-2 pr-3">Heading</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {[...history.items].reverse().map((f, i) => (
                  <tr key={`${f.timestamp}-${i}`} className="hover:bg-ink-850/50">
                    <td className="whitespace-nowrap py-2 pr-3 font-mono text-xs text-slate-400">{formatTime(f.timestamp)}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-slate-300">{f.latitude.toFixed(6)}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-slate-300">{f.longitude.toFixed(6)}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-slate-400">{f.accuracy.toFixed(1)} m</td>
                    <td className="py-2 pr-3 font-mono text-xs text-slate-400">{f.speed != null ? `${(f.speed * 3.6).toFixed(1)} km/h` : "—"}</td>
                    <td className="py-2 font-mono text-xs text-slate-400">{f.heading != null ? `${f.heading.toFixed(0)}°` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Consent modal — shown before starting dashboard-side sharing */}
      <Modal open={consentOpen} onClose={() => setConsentOpen(false)} title="Device consent required">
        <div className="space-y-4">
          <p className="text-sm font-medium text-slate-100">
            Your device is about to share its real-time location with the authorized security dashboard.
          </p>
          <ul className="space-y-2 text-sm text-slate-300">
            <li>
              <span className="text-accent-soft">Data collected:</span> latitude, longitude, GPS accuracy, and when available altitude, speed, heading and timestamp.
            </li>
            <li>
              <span className="text-accent-soft">Why:</span> so the security team can track this device in real time during authorized operations.
            </li>
            <li>
              <span className="text-accent-soft">Frequency:</span> every {MODE_INTERVALS[trackingMode]} seconds, using the OS location API.
            </li>
            <li>
              <span className="text-accent-soft">How to stop:</span> press STOP on the dashboard, on the device, or revoke the OS location permission at any time.
            </li>
          </ul>
          <div>
            <label className="panel-title mb-1 block">Tracking mode</label>
            <div className="grid gap-1">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setTrackingMode(m.id)}
                  className={`rounded-lg border p-2.5 text-left transition ${
                    trackingMode === m.id ? "border-accent-dim bg-accent/5" : "border-ink-700 bg-ink-850/50"
                  }`}
                >
                  <div className="text-sm text-slate-200">{m.label}</div>
                  <div className="text-[11px] text-slate-500">{m.hint}</div>
                </button>
              ))}
            </div>
          </div>
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-ink-600 bg-ink-800 accent-cyan-400"
            />
            <span className="text-sm text-slate-300">
              I confirm that this device's owner has been informed and explicitly consents to real-time location sharing.
            </span>
          </label>
          <Button className="w-full" disabled={!consentChecked} loading={busy} onClick={() => void startSharing()}>
            Start sharing location
          </Button>
        </div>
      </Modal>
    </div>
  );
}

const MODE_INTERVALS: Record<TrackingMode, number> = {
  NORMAL: 15,
  HIGH_ACCURACY: 8,
  BATTERY_SAVING: 45,
};

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="panel-title pt-0.5">{label}</span>
      <span className={`break-all text-right text-xs text-slate-300 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}
