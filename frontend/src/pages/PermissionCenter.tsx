import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { PermissionRecord, PermissionState, PermissionType } from "../types";
import { Button, Card, Spinner, formatDate } from "../components/ui";
import { useToast } from "../context/ToastContext";

const PERMISSION_DENIED_MESSAGE = "Location unavailable — user device/browser permission is not currently granted.";

const PERMISSION_LABELS: Record<PermissionType, string> = {
  LOCATION: "Location",
  CAMERA: "Camera",
  MICROPHONE: "Microphone",
  NOTIFICATIONS: "Notifications",
};

const PERMISSION_DESCRIPTIONS: Record<PermissionType, string> = {
  LOCATION: "Share GPS coordinates, accuracy and timestamps during active sessions. Never collected without an explicit grant.",
  CAMERA: "Allow the browser to capture video frames for an active, consent-backed camera session.",
  MICROPHONE: "Allow the browser to capture audio for an active, consent-backed camera session.",
  NOTIFICATIONS: "Allow SENTINEL to surface real-time alerts about your account and monitoring state.",
};

function requestGeolocation(): Promise<PermissionState> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve("UNAVAILABLE");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      () => resolve("GRANTED"),
      (err) => resolve(err.code === err.PERMISSION_DENIED ? "DENIED" : "UNAVAILABLE")
    );
  });
}

async function requestMedia(kind: "camera" | "microphone"): Promise<PermissionState> {
  if (!navigator.mediaDevices?.getUserMedia) return "UNAVAILABLE";
  try {
    const stream = await navigator.mediaDevices.getUserMedia(kind === "camera" ? { video: true } : { audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return "GRANTED";
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotAllowedError") return "DENIED";
    return "UNAVAILABLE";
  }
}

async function requestNotifications(): Promise<PermissionState> {
  if (!("Notification" in window)) return "UNAVAILABLE";
  try {
    const state = await Notification.requestPermission();
    if (state === "granted") return "GRANTED";
    if (state === "denied") return "DENIED";
    return "NOT_REQUESTED";
  } catch {
    return "UNAVAILABLE";
  }
}

const REQUESTERS: Record<PermissionType, () => Promise<PermissionState>> = {
  LOCATION: requestGeolocation,
  CAMERA: () => requestMedia("camera"),
  MICROPHONE: () => requestMedia("microphone"),
  NOTIFICATIONS: requestNotifications,
};

export function PermissionCenter() {
  const { push: toast } = useToast();
  const [records, setRecords] = useState<PermissionRecord[] | null>(null);
  const [busyType, setBusyType] = useState<PermissionType | null>(null);

  const reload = useCallback(async () => {
    try {
      const { permissions } = await api.getMyPermissions();
      setRecords(permissions);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to load permissions");
    }
  }, [toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const recordFor = (t: PermissionType): PermissionRecord | undefined => records?.find((r) => r.type === t);

  const requestPermission = async (type: PermissionType) => {
    setBusyType(type);
    try {
      const state = await REQUESTERS[type]();
      const { permission } = await api.updatePermission(type, state);
      setRecords((prev) => (prev ? prev.map((r) => (r.type === type ? permission : r)) : prev));
      toast("success", `${PERMISSION_LABELS[type]} permission: ${state}`);
      if (type === "LOCATION" && state === "DENIED") {
        toast("error", PERMISSION_DENIED_MESSAGE);
      }
    } catch (err) {
      toast("error", err instanceof Error ? err.message : `Failed to record ${PERMISSION_LABELS[type].toLowerCase()} permission`);
    } finally {
      setBusyType(null);
    }
  };

  const revokePermission = async (type: PermissionType) => {
    setBusyType(type);
    try {
      const { permission } = await api.updatePermission(type, "REVOKED");
      setRecords((prev) => (prev ? prev.map((r) => (r.type === type ? permission : r)) : prev));
      toast("info", `${PERMISSION_LABELS[type]} permission revoked`);
      if (type === "LOCATION") toast("error", PERMISSION_DENIED_MESSAGE);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to revoke permission");
    } finally {
      setBusyType(null);
    }
  };

  const acknowledgeConsent = async () => {
    try {
      await api.updateSettings({ consentAcknowledged: true });
      toast("success", "Consent acknowledged. Thank you.");
      void reload();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to update consent");
    }
  };

  if (!records) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner label="Loading permission state…" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="font-mono text-xl font-semibold text-slate-100">Permission & Privacy Center</h1>
        <p className="mt-1 text-sm text-slate-500">
          Review exactly what your device is authorized to share with SENTINEL. You control every grant.
        </p>
      </div>

      <Card title="Browser & OS permissions">
        <div className="space-y-3">
          {(["LOCATION", "CAMERA", "MICROPHONE", "NOTIFICATIONS"] as PermissionType[]).map((type) => {
            const record = recordFor(type);
            const state = record?.state ?? "NOT_REQUESTED";
            const stateCls =
              state === "GRANTED"
                ? "bg-signal/15 text-signal"
                : state === "DENIED" || state === "REVOKED"
                ? "bg-signal-danger/15 text-signal-danger"
                : state === "UNAVAILABLE"
                ? "bg-signal-warn/15 text-signal-warn"
                : "bg-slate-500/15 text-slate-400";
            return (
              <div key={type} className="rounded-lg border border-ink-700 bg-ink-850 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-slate-100">{PERMISSION_LABELS[type]}</span>
                      <span className={`badge ${stateCls}`}>{state}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{PERMISSION_DESCRIPTIONS[type]}</p>
                    {record && (
                      <p className="mt-1 text-[10px] text-slate-600">
                        {record.consentVersion && <>consent v{record.consentVersion}</>}
                        {record.grantedAt && <> · granted {formatDate(record.grantedAt)}</>}
                        {record.deniedAt && <> · denied {formatDate(record.deniedAt)}</>}
                        {!record.grantedAt && !record.deniedAt && <>last updated {formatDate(record.updatedAt)}</>}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {state !== "GRANTED" ? (
                      <Button variant="primary" className="text-xs" loading={busyType === type} onClick={() => void requestPermission(type)}>
                        Request access
                      </Button>
                    ) : (
                      <Button variant="danger" className="text-xs" loading={busyType === type} onClick={() => void revokePermission(type)}>
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {recordFor("LOCATION")?.state === "DENIED" || recordFor("LOCATION")?.state === "REVOKED" ? (
            <div className="rounded-md border border-signal-danger/30 bg-signal-danger/10 px-3 py-2 text-xs text-red-300">
              {PERMISSION_DENIED_MESSAGE}
            </div>
          ) : null}
        </div>
      </Card>

      <Card
        title="Consent acknowledgement"
        action={
          <Button variant="ghost" className="text-xs" onClick={() => void acknowledgeConsent()}>
            Acknowledge consent
          </Button>
        }
      >
        <p className="text-sm text-slate-300">
          Acknowledging consent confirms you understand SENTINEL records location, camera, microphone and notification
          permissions as audited events, and that administrators can only view this data while monitoring is active and
          consent is granted. You may revoke any permission at any time from this page.
        </p>
      </Card>

      <Card title="What is collected & retention">
        <ul className="list-disc space-y-2 pl-5 text-sm text-slate-300">
          <li><strong className="text-slate-100">Location:</strong> GPS coordinates, accuracy, altitude, speed, heading and timestamps — only while a sharing session is active.</li>
          <li><strong className="text-slate-100">Camera / Microphone:</strong> media streams are only ever activated by your explicit browser interaction during an active session.</li>
          <li><strong className="text-slate-100">Retention:</strong> location history auto-purges after the configured retention window; sessions auto-expire after their TTL.</li>
          <li><strong className="text-slate-100">Deletion:</strong> you can stop sharing or delete history at any time; administrators can also purge records manually.</li>
        </ul>
      </Card>
    </div>
  );
}