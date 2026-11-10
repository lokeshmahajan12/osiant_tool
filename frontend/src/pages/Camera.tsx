import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { CameraMode, CameraSession } from "../types";
import { Button, Card, EmptyState, Spinner, formatDate } from "../components/ui";
import { useToast } from "../context/ToastContext";

export function Camera() {
  const { push: toast } = useToast();
  const [active, setActive] = useState<CameraSession | null>(null);
  const [history, setHistory] = useState<CameraSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<CameraMode>("LIVE");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const load = useCallback(async () => {
    try {
      const [statusRes, historyRes] = await Promise.all([api.cameraStatus(), api.cameraHistory({ limit: 20 })]);
      setActive(statusRes.session);
      setHistory(historyRes.items);
    } catch {
      /* errors surfaced via buttons */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, [load]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const start = async () => {
    setBusy(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        await api.updatePermission("CAMERA", "UNAVAILABLE");
        toast("error", "Camera is not available in this browser.");
        return;
      }
      let mediaStream: MediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
      } catch (err) {
        if (err instanceof DOMException && err.name === "NotAllowedError") {
          await api.updatePermission("CAMERA", "DENIED");
          toast("error", "Camera permission was denied by the browser.");
        } else {
          await api.updatePermission("CAMERA", "UNAVAILABLE");
          toast("error", "Camera unavailable on this device.");
        }
        return;
      }
      await api.updatePermission("CAMERA", "GRANTED");
      const { session } = await api.cameraStart(mode);
      streamRef.current = mediaStream;
      setStream(mediaStream);
      setActive(session);
      toast("success", "Camera session started");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to start camera");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setStream(null);
      if (active) await api.cameraEnd(active.id);
      setActive(null);
      await load();
      toast("info", "Camera session ended");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to stop camera");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner label="Checking camera session…" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="font-mono text-xl font-semibold text-slate-100">Camera</h1>
        <p className="mt-1 text-sm text-slate-500">
          Consent-backed camera sessions. The camera is only activated by your explicit action in this browser.
        </p>
      </div>

      <Card title={active ? "Active camera session" : "No active session"}>
        <div className="space-y-4">
          {active ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="relative aspect-video overflow-hidden rounded-lg border border-ink-700 bg-black">
                {stream ? (
                  <video ref={videoRef} className="h-full w-full object-cover" autoPlay muted playsInline />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-slate-500">Stream unavailable</div>
                )}
                <span className="absolute left-2 top-2 badge bg-signal-danger/90 text-white">● REC</span>
              </div>
              <div className="space-y-3 text-sm text-slate-300">
                <div className="grid grid-cols-2 gap-3">
                  <div><div className="panel-title">Session</div><div className="mt-0.5 font-mono text-xs text-slate-200">{active.id.slice(0, 8)}…</div></div>
                  <div><div className="panel-title">Mode</div><div className="mt-0.5 text-slate-200">{active.mode}</div></div>
                  <div><div className="panel-title">Started</div><div className="mt-0.5 text-xs text-slate-200">{formatDate(active.startedAt)}</div></div>
                  <div><div className="panel-title">Status</div><div className="mt-0.5 text-signal">ACTIVE</div></div>
                </div>
                <Button variant="danger" onClick={() => void stop()} loading={busy}>
                  Stop & close camera
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-slate-400">
                Starting a session will prompt your browser for camera access. Granting it records a{" "}
                <strong className="text-slate-200">CAMERA permission GRANTED</strong> audit event. Nothing is captured
                until you explicitly start a session.
              </p>
              <div className="flex items-center gap-3">
                <select className="input max-w-[200px] py-1.5 text-xs" value={mode} onChange={(e) => setMode(e.target.value as CameraMode)}>
                  <option value="LIVE">Live streaming</option>
                  <option value="CAPTURE">Frame capture</option>
                </select>
                <Button onClick={() => void start()} loading={busy}>
                  Enable camera
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card title="Recent camera sessions">
        {history.length === 0 ? (
          <EmptyState title="No camera sessions yet" hint="Start a session above to record your first camera activity." />
        ) : (
          <div className="divide-y divide-ink-800">
            {history.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="font-mono text-xs text-slate-300">{s.id.slice(0, 8)}… · {s.mode}</div>
                  <div className="text-[11px] text-slate-500">
                    Started {formatDate(s.startedAt)}
                    {s.endedAt ? ` · ended ${formatDate(s.endedAt)}` : ""}
                  </div>
                </div>
                <span className={`badge ${s.status === "ACTIVE" ? "bg-signal/15 text-signal" : "bg-slate-500/15 text-slate-400"}`}>
                  {s.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}