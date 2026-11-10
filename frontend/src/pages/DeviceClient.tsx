import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import type { DeviceClientInfo, LocationFix, TrackingMode } from "../types";
import { api, storeDeviceToken } from "../lib/api";
import { LiveStatusBadge } from "../components/LiveStatusBadge";

const TOKEN_STORAGE_KEY = "sentinel.deviceToken";

const MODES: { id: TrackingMode; label: string; hint: string }[] = [
  { id: "NORMAL", label: "Normal", hint: "update every 10–30s" },
  { id: "HIGH_ACCURACY", label: "High accuracy", hint: "update every 5–10s" },
  { id: "BATTERY_SAVING", label: "Battery saving", hint: "update every 30–60s" },
];

const MODE_INTERVALS_MS: Record<TrackingMode, number> = {
  NORMAL: 15_000,
  HIGH_ACCURACY: 8_000,
  BATTERY_SAVING: 45_000,
};

type Stage = "unpaired" | "consent" | "starting" | "live" | "stopped" | "error";

type AuditTone = "ok" | "warn" | "err" | "info";

interface AuditEvent {
  id: number;
  at: number;
  label: string;
  tone: AuditTone;
}

export function DeviceClient() {
  const { token: paramToken } = useParams<{ token: string }>();
  const [info, setInfo] = useState<DeviceClientInfo | null>(null);
  const [stage, setStage] = useState<Stage>("unpaired");
  const [consentChecked, setConsentChecked] = useState(false);
  const [mode, setMode] = useState<TrackingMode>("NORMAL");
  const [lastFix, setLastFix] = useState<LocationFix | null>(null);
  const [lastPushAt, setLastPushAt] = useState<number>(0);
  const [fixCount, setFixCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean>(navigator.onLine);
  const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null);
  const [network, setNetwork] = useState<{ downlink?: number; type?: string }>({});
  const [sensorAccuracy, setSensorAccuracy] = useState<number | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const watchRef = useRef<number | null>(null);
  const startingRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFixRef = useRef<GeolocationPosition | null>(null);
  const liveRef = useRef(false);
  const startWatcherRef = useRef<() => void>(() => {});
  const pairingRef = useRef<{ token: string; id: string } | null>(null);
  const nextPushAtRef = useRef(0);
  const auditIdRef = useRef(0);
  const modeRef = useRef<TrackingMode>("NORMAL");

  // Keep the effective tracking mode in a ref so the GPS watcher (created once)
  // always throttles pushes with the mode that was active when streaming began.
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const pushAudit = useCallback((label: string, tone: AuditTone = "info") => {
    setAudit((prev) => [{ id: ++auditIdRef.current, at: Date.now(), label, tone }, ...prev].slice(0, 60));
  }, []);

  // Load pairing info from URL param or session storage
  useEffect(() => {
    let t = paramToken ?? sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (!t) return;
    sessionStorage.setItem(TOKEN_STORAGE_KEY, t);
    pairingRef.current = { token: t, id: "" };

    api
      .deviceMe(t)
      .then(({ device }) => {
        pairingRef.current = { token: t, id: device.id };
        storeDeviceToken(device.id, t);
        setInfo(device);
        if (device.sharing) {
          // Resume an existing sharing session automatically. `deviceMe` only
          // proves the session exists server-side; the GPS watcher still has to
          // be (re)started on this page or no fixes are ever streamed. If this
          // attempt fails the polling effect below retries.
          void beginStreaming({ recordConsent: false, mode: device.session?.mode ?? "NORMAL" });
        } else {
          setStage(device.consentGranted ? "stopped" : "consent");
        }
        pushAudit(
          device.sharing ? "Session resumed — reconnecting GPS…" : "Device linked successfully",
          "info"
        );
      })
      .catch(() => {
        setError("Pairing token is invalid, expired, or the device has been removed. Contact the dashboard administrator.");
        pushAudit("Pairing failed — session invalid or expired", "err");
        setStage("error");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramToken]);

  // Network + battery telemetry (shown only when legitimately available)
  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      setError(null);
    };
    const onOffline = () => {
      setOnline(false);
      setError("Connection lost. Reconnecting…");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    if (navigator.onLine && "connection" in navigator) {
      const conn = (navigator as Navigator & { connection?: { downlink?: number; type?: string; onchange?: unknown } }).connection;
      if (conn) {
        setNetwork({ downlink: conn.downlink, type: conn.type });
      }
    }
    const batteryManager = (navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener: (ev: string, cb: () => void) => void }> }).getBattery;
    if (batteryManager) {
      batteryManager()
        .then((b) => {
          setBattery({ level: b.level, charging: b.charging });
          b.addEventListener("levelchange", () => setBattery({ level: b.level, charging: b.charging }));
          b.addEventListener("chargingchange", () => setBattery({ level: b.level, charging: b.charging }));
        })
        .catch(() => undefined);
    }
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // Clock for the "last update Xs ago" indicator
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const stopWatch = useCallback(() => {
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
  }, []);

  const handleGeoError = useCallback(
    (err: GeolocationPositionError) => {
      setSensorAccuracy(null);
      if (err.code === err.PERMISSION_DENIED) {
        setError("Location permission denied. Location sharing has stopped and will not restart until you re-grant permission on this device.");
        pushAudit("Location permission denied — sharing stopped", "err");
        setStage("stopped");
        liveRef.current = false;
        stopWatch();
        // Tell the backend the OS permission is denied so the dashboard never
        // shows this device as LIVE while it cannot legally share a location.
        const p = pairingRef.current;
        if (p && p.id) void api.devicePermission(p.token, p.id, "DENIED").catch(() => undefined);
      } else if (err.code === err.POSITION_UNAVAILABLE || err.code === err.TIMEOUT) {
        // Transient GPS loss. Never kill a live stream on this — re-arm the
        // watcher after a short pause so the session recovers by itself.
        if (!liveRef.current) return; // initial acquisition is handled by beginStreaming
        setError("GPS signal lost — re-acquiring location…");
        if (restartTimerRef.current == null) {
          restartTimerRef.current = setTimeout(() => {
            restartTimerRef.current = null;
            stopWatch();
            if (liveRef.current) startWatcherRef.current();
          }, 5_000);
        }
      }
    },
    [stopWatch, pushAudit]
  );

  // Heartbeat to keep device online even if stationary. Runs whenever a device
  // is paired (not just on "live") so a server-side session is never left
  // completely silent if the UI stalls.
  useEffect(() => {
    if (stage === "unpaired" || stage === "error") return;
    const t = setInterval(() => {
      const p = pairingRef.current;
      if (!p || !p.id || !navigator.onLine) return;
      api
        .deviceHeartbeat(p.token, p.id)
        .then((r) => {
          // The backend responds ok:false when no ACTIVE session exists (e.g.
          // stopped from the dashboard or expired). If we thought we were live,
          // stop the watcher and return to the consent card so the UI matches
          // reality instead of heartbeating into a 403 forever.
          if (r.ok === false && watchRef.current != null) {
            setStage("stopped");
            stopWatch();
            setError("The sharing session is no longer active on the server. Press Start to resume.");
            pushAudit("Sharing session ended — heartbeat rejected", "warn");
          }
        })
        .catch(() => undefined);
    }, 20_000);
    return () => clearInterval(t);
  }, [stage, stopWatch, pushAudit]);

  const pushFix = useCallback(
    async (position: GeolocationPosition) => {
      if (!pairingRef.current) return;
      const nowMs = Date.now();
      if (nowMs < nextPushAtRef.current) return; // respect the selected tracking interval
      nextPushAtRef.current = nowMs + MODE_INTERVALS_MS[modeRef.current];

      const coords = position.coords;
      const fix: Omit<LocationFix, "id"> = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: sanitizeAccuracy(coords.accuracy),
        altitude: coords.altitude ?? null,
        speed: coords.speed ?? null,
        heading: coords.heading ?? null,
        timestamp: safeFixTime(position.timestamp),
      };
      setLastFix(fix);
      setSensorAccuracy(fix.accuracy);
      try {
        await api.devicePush(pairingRef.current.token, pairingRef.current.id, fix);
        setLastPushAt(nowMs);
        setFixCount((c) => c + 1);
      } catch (err) {
        const message = (err as Error).message;
        if (message.includes("not active")) {
          setError("Sharing was stopped on the dashboard. Waiting for the OS permission remains active — press Start to resume.");
          pushAudit("Location sharing stopped by dashboard", "warn");
          setStage("stopped");
          liveRef.current = false;
          stopWatch();
        } else if (message.includes("session revoked") || message.includes("Invalid or expired")) {
          setError("Session expired. Please re-authenticate this device.");
          pushAudit("Session expired — sharing ended", "err");
          setStage("error");
          liveRef.current = false;
          stopWatch();
        } else {
          setError("Failed to deliver the GPS fix — will retry automatically.");
          pushAudit("GPS fix delivery failed — retrying", "warn");
          throw err; // let the caller retry
        }
      }
    },
    [stopWatch, pushAudit]
  );

  const startWatcher = useCallback(() => {
    const p = pairingRef.current;
    if (!p) return;
    const effMode = modeRef.current;
    watchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        lastFixRef.current = position;
        void pushFix(position).catch(() => undefined);
      },
      handleGeoError,
      { enableHighAccuracy: effMode === "HIGH_ACCURACY", maximumAge: 0, timeout: 20_000 }
    );
  }, [pushFix, handleGeoError]);
  startWatcherRef.current = startWatcher;

  // While live, keep re-pushing the latest known fix on a short timer. If the
  // browser stops firing watchPosition callbacks (flaky GPS, aggressive
  // power-saving), the backend still receives fresh fixes and the device stays
  // LIVE. pushFix throttles to the selected mode interval, so the effective
  // update cadence is max(5s, mode interval).
  useEffect(() => {
    if (stage !== "live") return;
    const t = setInterval(() => {
      const pos = lastFixRef.current;
      if (pos && pairingRef.current) void pushFix(pos).catch(() => undefined);
    }, 5_000);
    return () => clearInterval(t);
  }, [stage, pushFix]);

  /** Deliver the first captured fix with automatic retries so a lost first
   *  push (e.g. the phone backgrounding right after Start) never leaves a live
   *  session with zero fixes. */
  const deliverInitialFix = useCallback(
    async (position: GeolocationPosition) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) nextPushAtRef.current = 0; // clear throttle so the retry really pushes
        try {
          await pushFix(position);
          return; // delivered (or throttled intentionally — a watcher event will follow)
        } catch {
          // pushFix rethrows only on transient delivery failures
          await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
        }
      }
    },
    [pushFix]
  );

  const beginStreaming = useCallback(
    async (opts: { recordConsent?: boolean; mode?: TrackingMode } = {}) => {
      if (!pairingRef.current) return;
      if (watchRef.current != null) return; // already streaming
      if (startingRef.current) return; // already attempting — prevents double-start races
      const { token, id } = pairingRef.current;
      const effMode = opts.mode ?? mode;
      setError(null);
      setStage("starting");
      startingRef.current = true;
      try {
        if (!("geolocation" in navigator)) {
          setError("Browser does not support geolocation. Use a modern browser (Chrome, Safari, Edge, Firefox) over HTTPS or localhost.");
          pushAudit("Browser does not support geolocation", "err");
          setStage("error");
          return;
        }
        if (!window.isSecureContext) {
          setError(
            "Geolocation is blocked by the browser on insecure connections. Open this link on localhost (or serve the app over HTTPS) to stream live location."
          );
          pushAudit("Insecure context — geolocation blocked by browser", "err");
          setStage("error");
          return;
        }

        // 1. Request the OS location permission and capture a first real fix.
        //    GPS on laptops can take a while to lock, so retry a few times
        //    before falling back (a hard denial is never retried).
        let initialPosition: GeolocationPosition | null = null;
        let denied = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          initialPosition = await new Promise<GeolocationPosition | null>((resolve) => {
            navigator.geolocation.getCurrentPosition(resolve, (err) => {
              if (err.code === err.PERMISSION_DENIED) denied = true;
              resolve(null);
            }, {
              enableHighAccuracy: effMode === "HIGH_ACCURACY",
              maximumAge: 0,
              timeout: 15_000,
            });
          });
          if (initialPosition || denied) break;
          if (attempt < 2) await new Promise((r) => setTimeout(r, 2_000));
        }
        if (denied) {
          // Hard denial — revoke the session AND record the OS denial so the
          // dashboard reflects reality (never shows this device as live).
          setSensorAccuracy(null);
          setError("Location permission denied. Allow location access for this site to stream live location.");
          pushAudit("Location permission denied — sharing cannot start", "err");
          setStage("stopped");
          const p = pairingRef.current;
          if (p && p.id) void api.devicePermission(p.token, p.id, "DENIED").catch(() => undefined);
          return;
        }
        if (!initialPosition) {
          // Transient GPS failure (unavailable/timeout). Keep the page usable and
          // let the resume-polling effect retry — do not mark the session as failed.
          setError("Could not get a GPS fix. Make sure location services are enabled, then tap Start again.");
          pushAudit("GPS acquisition failed after retries", "warn");
          setStage("consent");
          return;
        }

        // 2. Record explicit consent when starting fresh (skipped on resume — the
        //    consent already exists), then open the sharing session.
        if (opts.recordConsent !== false) {
          await api.deviceConsent(token, id);
          pushAudit("Consent granted — location sharing authorized", "ok");
        }
        await api.deviceStart(token, id, effMode);
        pushAudit(`Location sharing started (${effMode.toLowerCase().replace("_", " ")})`, "ok");

        // 3. Stream real fixes from the OS location API. Go LIVE before pushing so
        //    the heartbeat keeps the session fresh even if a push is delayed.
        const firstFix = toFix(initialPosition);
        setMode(effMode);
        modeRef.current = effMode;
        setLastFix(firstFix);
        setSensorAccuracy(sanitizeAccuracy(initialPosition.coords.accuracy));
        setStage("live");
        setFixCount(1);
        nextPushAtRef.current = 0;
        liveRef.current = true;
        lastFixRef.current = initialPosition;
        setInfo((prev) => (prev ? { ...prev, sharing: true, consentGranted: true } : prev));
        void deliverInitialFix(initialPosition);
        startWatcher();
      } catch (err) {
        console.error("beginStreaming failed:", err);
        setError(`Could not start sharing: ${(err as Error).message}`);
        pushAudit("Failed to start location sharing", "err");
        setStage("error");
      } finally {
        startingRef.current = false;
      }
    },
    [mode, pushFix, handleGeoError, pushAudit, deliverInitialFix]
  );

  // While not sharing, watch for a session started from the dashboard and
  // automatically begin streaming. This makes dashboard-initiated sharing
  // actually deliver GPS: opening this page (or coming back to it) picks up the
  // active session within a few seconds instead of waiting for a manual Start.
  // Retries forever so a transient GPS failure never leaves a live session
  // silently unstreamed.
  useEffect(() => {
    if (stage === "unpaired" || stage === "live" || stage === "starting" || stage === "error") return;
    const t = setInterval(async () => {
      const p = pairingRef.current;
      if (!p || !p.id) return;
      try {
        const { device } = await api.deviceMe(p.token);
        if (device.sharing) {
          void beginStreaming({ recordConsent: false, mode: device.session?.mode ?? "NORMAL" });
        }
      } catch {
        /* transient failure — retry on the next tick */
      }
    }, 10_000);
    return () => clearInterval(t);
  }, [stage, beginStreaming]);

  const stopSharing = useCallback(async () => {
    if (!pairingRef.current) return;
    const { token, id } = pairingRef.current;
    stopWatch();
    try {
      await api.deviceStop(token, id);
      pushAudit("Location sharing stopped by user", "ok");
    } catch {
      /* even if the call fails we clear the local watcher */
    }
    setStage("stopped");
    setError(null);
    setInfo((prev) => (prev ? { ...prev, sharing: false } : prev));
  }, [stopWatch, pushAudit]);

  const deleteMyHistory = useCallback(async () => {
    if (!pairingRef.current) return;
    const { token, id } = pairingRef.current;
    setDeleting(true);
    try {
      const res = await api.deviceDeleteHistory(token, id);
      pushAudit(`Location history deleted (${res.deleted} point(s))`, "ok");
      setError(null);
      setConfirmDelete(false);
    } catch (err) {
      pushAudit("Failed to delete location history", "err");
      setError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  }, [pushAudit]);

  // Graceful stop when the user leaves the page while sharing.
  useEffect(() => {
    const handler = () => {
      stopWatch();
      if (pairingRef.current && info?.sharing) {
        void api.deviceStop(pairingRef.current.token, pairingRef.current.id).catch(() => undefined);
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      stopWatch();
    };
  }, [info, stopWatch]);

  if (stage === "unpaired") {
    return (
      <Shell>
        <p className="text-sm text-slate-300">Paste the pairing token to link this device to the security dashboard.</p>
        <TokenEntry
          onToken={(token) => {
            pairingRef.current = { token, id: "" };
            sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
            api
              .deviceMe(token)
              .then(({ device }) => {
                pairingRef.current = { token, id: device.id };
                setInfo(device);
                if (device.sharing) {
                  void beginStreaming({ recordConsent: false, mode: device.session?.mode ?? "NORMAL" });
                } else {
                  setStage(device.consentGranted ? "stopped" : "consent");
                }
              })
              .catch(() => {
                setError("Pairing token is invalid. Check the token with the dashboard administrator.");
                setStage("error");
              });
          }}
        />
      </Shell>
    );
  }

  if (stage === "error") {
    return (
      <Shell>
        <div className="rounded-lg border border-signal-danger/30 bg-signal-danger/10 p-4 text-sm text-signal-danger">{error}</div>
        <button
          className="btn-ghost mt-4 w-full text-xs"
          onClick={() => {
            pairingRef.current = null;
            setStage("unpaired");
            sessionStorage.clear();
          }}
        >
          Re-pair device
        </button>
      </Shell>
    );
  }

  const policy = info?.dataPolicy;
  const retentionLabel = policy
    ? policy.retentionHours >= 24
      ? `${policy.retentionHours / 24} day${policy.retentionHours / 24 === 1 ? "" : "s"}`
      : `${policy.retentionHours} hour${policy.retentionHours === 1 ? "" : "s"}`
    : "the configured retention period";

  return (
    <Shell>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="font-mono text-base font-semibold text-slate-100">{info?.name ?? "Device"}</div>
          <div className="text-[11px] text-slate-500">{info?.id}</div>
        </div>
        <LiveStatusBadge sharing={info?.sharing || stage === "live" ? "LIVE" : "OFF"} />
      </div>

      {info?.isTestDevice && (
        <div className="mb-3 rounded-lg border border-accent-dim/40 bg-accent/5 px-3 py-2 text-xs text-accent-soft">
          Authorized Security Demonstration mode — this device reports simulated test coordinates, never real GPS.
        </div>
      )}

      {!online && (
        <div className="mb-3 rounded-lg border border-signal-warn/30 bg-signal-warn/10 px-3 py-2 text-xs text-signal-warn">
          Connection lost. Reconnecting…
        </div>
      )}
      {error && (
        <div className="mb-3 rounded-lg border border-signal-danger/30 bg-signal-danger/10 px-3 py-2 text-xs text-signal-danger">{error}</div>
      )}

      {stage === "consent" && (
        <ConsentCard
          checked={consentChecked}
          onCheck={setConsentChecked}
          mode={mode}
          setMode={setMode}
          onStart={() => void beginStreaming({ recordConsent: true })}
          retentionLabel={retentionLabel}
          sessionTtlHours={policy?.sessionTtlHours}
        />
      )}

      {stage === "starting" && (
        <div className="rounded-lg border border-ink-700 bg-ink-850 p-4 text-center text-sm text-slate-300">
          Requesting GPS permission and opening the sharing session…
        </div>
      )}

      {stage === "live" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Metric label="GPS accuracy" value={sensorAccuracy != null ? `${sensorAccuracy.toFixed(1)} m` : "…"} />
            <Metric label="Update interval" value={`${(MODE_INTERVALS_MS[mode] / 1000).toFixed(0)}s`} />
            <Metric label="Battery" value={battery ? `${Math.round(battery.level * 100)}%${battery.charging ? " ⚡" : ""}` : "n/a"} />
            <Metric label="Network" value={network.type ? `${network.type}${network.downlink ? ` ${network.downlink}Mbps` : ""}` : "connected"} />
          </div>
          <div className="rounded-lg border border-ink-700 bg-ink-850 p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Last update</span>
              <span className="font-mono text-signal">{lastFix ? lastAgo(now, new Date(lastFix.timestamp).getTime()) : "waiting for first GPS fix…"}</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-slate-400">Latitude</span>
              <span className="font-mono text-slate-200">{lastFix ? lastFix.latitude.toFixed(6) : "…"}</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-slate-400">Longitude</span>
              <span className="font-mono text-slate-200">{lastFix ? lastFix.longitude.toFixed(6) : "…"}</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-slate-400">Speed</span>
              <span className="font-mono text-slate-200">{lastFix?.speed != null ? `${(lastFix.speed * 3.6).toFixed(1)} km/h` : "—"}</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-slate-400">Heading</span>
              <span className="font-mono text-slate-200">{lastFix?.heading != null ? `${lastFix.heading.toFixed(0)}°` : "—"}</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-slate-400">Fixes delivered</span>
              <span className="font-mono text-slate-200">{fixCount} {lastPushAt ? "✓" : "…"}</span>
            </div>
          </div>
          <button className="btn-danger w-full" onClick={() => void stopSharing()}>
            STOP SHARING LOCATION
          </button>
          <div className="flex items-center justify-center">
            <button className="text-[11px] text-slate-500 underline hover:text-slate-300" onClick={() => setConfirmDelete(true)}>
              Delete my location history
            </button>
          </div>
          <p className="text-center text-[11px] text-slate-500">
            Sharing is visible on the dashboard and can be stopped from here, from the dashboard, or by revoking the OS
            location permission at any time.
          </p>
        </div>
      )}

      {stage === "stopped" && (
        <div className="space-y-3">
          <div className="rounded-lg border border-ink-700 bg-ink-850 p-3 text-xs text-slate-400">
            Location sharing stopped. No GPS coordinates are being collected.
          </div>
          <button className="btn-primary w-full" onClick={() => setStage("consent")}>
            START LIVE LOCATION
          </button>
          <div className="flex items-center justify-center">
            <button className="text-[11px] text-slate-500 underline hover:text-slate-300" onClick={() => setConfirmDelete(true)}>
              Delete my location history
            </button>
          </div>
        </div>
      )}

      <AuditTrail audit={audit} />

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl border border-ink-700 bg-ink-900 p-5">
            <h3 className="font-mono text-sm font-semibold text-slate-100">Delete my location history?</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              This permanently deletes every recorded GPS point for this device. The device itself and any active session
              are kept. This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                Cancel
              </button>
              <button className="btn-danger px-3 py-1.5 text-xs" onClick={() => void deleteMyHistory()} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete history"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 border-t border-ink-700 pt-3 text-[11px] text-slate-500">
        Device: {info?.platform ?? "unknown"} · paired via secure device token · data retained for {retentionLabel}
        {policy ? ` · session auto-expires after ${policy.sessionTtlHours}h` : ""}
      </div>
    </Shell>
  );
}

function lastAgo(nowMs: number, thenMs: number): string {
  const diff = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ${diff % 60}s ago`;
  return new Date(thenMs).toLocaleTimeString();
}

function safeFixTime(rawTimestamp: number): string {
  const ts = Number.isFinite(rawTimestamp) && rawTimestamp > 0 ? rawTimestamp : Date.now();
  return new Date(ts).toISOString();
}

function toFix(position: GeolocationPosition): Omit<LocationFix, "id"> {
  const c = position.coords;
  return {
    latitude: c.latitude,
    longitude: c.longitude,
    accuracy: sanitizeAccuracy(c.accuracy),
    altitude: c.altitude ?? null,
    speed: c.speed ?? null,
    heading: c.heading ?? null,
    timestamp: safeFixTime(position.timestamp),
  };
}

export function sanitizeAccuracy(accuracy: number): number {
  if (!Number.isFinite(accuracy)) return 10_000;
  return Math.min(Math.max(accuracy, 0), 10_000);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-850 p-2.5">
      <div className="panel-title">{label}</div>
      <div className="mt-1 font-mono text-slate-200">{value}</div>
    </div>
  );
}

function AuditTrail({ audit }: { audit: AuditEvent[] }) {
  const toneClass: Record<AuditTone, string> = {
    ok: "text-signal",
    warn: "text-signal-warn",
    err: "text-signal-danger",
    info: "text-slate-400",
  };
  const dotClass: Record<AuditTone, string> = {
    ok: "bg-signal",
    warn: "bg-signal-warn",
    err: "bg-signal-danger",
    info: "bg-slate-500",
  };
  return (
    <div className="mt-6 rounded-lg border border-ink-700 bg-ink-850/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="panel-title">Authorized Security Demonstration</span>
        <span className="text-[10px] uppercase tracking-wider text-slate-500">Consent &amp; data audit trail</span>
      </div>
      {audit.length === 0 ? (
        <p className="text-[11px] text-slate-500">No events yet. No location has been shared.</p>
      ) : (
        <ol className="space-y-1.5">
          {audit.map((e) => (
            <li key={e.id} className="flex items-center gap-2 text-[11px]">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass[e.tone]}`} />
              <span className={`flex-1 ${toneClass[e.tone]}`}>{e.label}</span>
              <span className="font-mono text-slate-600">{new Date(e.at).toLocaleTimeString()}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ConsentCard({
  checked,
  onCheck,
  mode,
  setMode,
  onStart,
  retentionLabel,
  sessionTtlHours,
}: {
  checked: boolean;
  onCheck: (v: boolean) => void;
  mode: TrackingMode;
  setMode: (m: TrackingMode) => void;
  onStart: () => void;
  retentionLabel: string;
  sessionTtlHours?: number;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-accent-dim/40 bg-accent/5 p-3">
        <div className="font-mono text-sm font-semibold text-slate-100">Share My Live Location</div>
        <p className="mt-1 text-xs leading-relaxed text-slate-300">
          Your device is about to share its real-time location with the authorized security dashboard. Sharing starts
          only after you confirm below and approve the browser's location permission prompt.
        </p>
      </div>
      <ul className="space-y-2 text-sm text-slate-300">
        <li>
          <span className="text-accent-soft">What is collected:</span> latitude, longitude, GPS accuracy, and when
          available altitude, speed, heading and timestamp — from the OS location API.
        </li>
        <li>
          <span className="text-accent-soft">Why:</span> so the authorized security dashboard can track this device in
          real time.
        </li>
        <li>
          <span className="text-accent-soft">How long it is retained:</span> {retentionLabel}, then automatically
          deleted. {sessionTtlHours ? `The sharing session also auto-expires after ${sessionTtlHours}h.` : ""}
        </li>
        <li>
          <span className="text-accent-soft">How often:</span> every {MODE_INTERVALS_MS[mode] / 1000}s while sharing is
          active.
        </li>
        <li>
          <span className="text-accent-soft">How to stop:</span> press STOP here or on the dashboard, or revoke the
          location permission in your OS settings — sharing never restarts silently.
        </li>
      </ul>
      <div>
        <label className="panel-title mb-1 block">Tracking mode</label>
        <div className="grid gap-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`rounded-lg border p-2.5 text-left transition ${mode === m.id ? "border-accent-dim bg-accent/5" : "border-ink-700 bg-ink-850/50"}`}
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
          checked={checked}
          onChange={(e) => onCheck(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-ink-600 bg-ink-800 accent-cyan-400"
        />
        <span className="text-sm text-slate-300">
          I own or am authorized to use this device, and I consent to sharing its real-time location with the dashboard.
        </span>
      </label>
      <button className="btn-primary w-full" disabled={!checked} onClick={onStart}>
        Allow Location &amp; Share
      </button>
    </div>
  );
}

function TokenEntry({ onToken }: { onToken: (token: string) => void }) {
  const [token, setToken] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (token.trim()) onToken(token.trim());
      }}
    >
      <input
        className="input font-mono text-xs"
        placeholder="Paste device token here"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        autoComplete="off"
      />
      <button className="btn-primary w-full" type="submit" disabled={!token.trim()}>
        Link this device
      </button>
      <p className="text-[11px] leading-relaxed text-slate-500">
        The token is stored only in this browser tab (session storage) and is never sent to any server except as the
        device's authentication header.
      </p>
    </form>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ink-950">
      <div className="mx-auto max-w-md px-4 py-8">
        <div className="mb-6 text-center">
          <div className="font-mono text-lg font-semibold text-slate-100">Share My Live Location</div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-accent-dim">Sentinel Authorized Device</div>
        </div>
        <div className="panel p-5">{children}</div>
        <div className="mt-4 text-center">
          <Link to="/device/diagnostics" className="text-[11px] text-accent hover:underline">
            View Connection Diagnostics
          </Link>
          <p className="mt-2 text-[11px] text-slate-600">
            Authorized device pairing only. Location sharing requires explicit consent and is always visible to the device owner.
          </p>
        </div>
      </div>
    </div>
  );
}
