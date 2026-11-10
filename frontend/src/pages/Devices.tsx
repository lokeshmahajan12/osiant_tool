import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import type { DevicePlatform, DeviceSummary, EnrolledDevice } from "../types";
import { api, storeDeviceToken } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { Badge, Button, Card, EmptyState, Modal, timeAgo } from "../components/ui";
import { LiveStatusBadge, PresenceBadge } from "../components/LiveStatusBadge";

const PLATFORMS: DevicePlatform[] = ["ANDROID", "IOS", "WEB", "OTHER"];

export function Devices() {
  const { push } = useToast();
  const { user } = useAuth();
  const canEnroll = user?.role === "ADMIN" || user?.role === "INVESTIGATOR";
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEnroll, setShowEnroll] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [platform, setPlatform] = useState<DevicePlatform>("WEB");
  const [enrolling, setEnrolling] = useState(false);
  const [enrolled, setEnrolled] = useState<EnrolledDevice | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(() => {
    void api
      .listDevices()
      .then(({ devices: list }) => setDevices(list))
      .catch((err) => push("error", err.message))
      .finally(() => setLoading(false));
  }, [push]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleEnroll = async () => {
    if (!name.trim()) {
      push("error", "Device name is required");
      return;
    }
    setEnrolling(true);
    try {
      const result = await api.enrollDevice(name.trim(), platform, phone);
      storeDeviceToken(result.deviceId, result.deviceToken);
      setEnrolled(result);
      setShowEnroll(false);
      setName("");
      setPhone("");
      void load();
    } catch (err) {
      push("error", (err as Error).message);
    } finally {
      setEnrolling(false);
    }
  };

  const handleToggleActive = async (d: DeviceSummary) => {
    try {
      await api.updateDevice(d.id, { isActive: !d.isActive });
      push("success", d.isActive ? "Device deactivated — sharing stopped." : "Device re-enabled.");
      void load();
    } catch (err) {
      push("error", (err as Error).message);
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      await api.deleteDevice(deletingId);
      push("success", "Device and its location history deleted.");
      setDeletingId(null);
      void load();
    } catch (err) {
      push("error", (err as Error).message);
    }
  };

  const pairUrl = enrolled
    ? `${window.location.origin}/enroll/${enrolled.deviceToken}`
    : "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-xl font-semibold text-slate-100">Devices</h1>
          <p className="mt-1 text-sm text-slate-500">
            Enrolled devices. Live location is only ever shared after the owner grants explicit consent on the device.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/live-location" className="btn-ghost text-xs">
            Open live map
          </Link>
          {canEnroll && <Button onClick={() => setShowEnroll(true)}>Enroll device</Button>}
        </div>
      </div>

      <Card>
        {loading ? (
          <div className="py-8 text-center text-sm text-slate-500">Loading devices…</div>
        ) : devices.length === 0 ? (
          <EmptyState title="No devices enrolled" hint="Enroll a phone or tablet to enable authorized live location sharing." />
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-700 text-xs uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 pr-3">Device</th>
                  <th className="py-2.5 pr-3">Platform</th>
                  <th className="py-2.5 pr-3">Status</th>
                  <th className="py-2.5 pr-3">Sharing</th>
                  <th className="py-2.5 pr-3">Last seen</th>
                  <th className="py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {devices.map((d) => (
                  <tr key={d.id} className="hover:bg-ink-850/50">
                    <td className="py-3 pr-3">
                      <Link to={`/live-location?device=${encodeURIComponent(d.id)}`} className="font-mono text-sm text-slate-200 hover:text-accent-soft">
                        {d.name}
                      </Link>
                      <div className="mt-0.5 text-[11px] text-slate-500">{d.id}</div>
                      {d.phone && <div className="mt-0.5 text-[11px] text-slate-500">{d.phone}</div>}
                    </td>
                    <td className="py-3 pr-3">
                      <Badge value={d.platform} />
                    </td>
                    <td className="py-3 pr-3">
                      {d.isActive ? <PresenceBadge stage={d.presence} /> : <span className="badge bg-slate-500/15 text-slate-400">Disabled</span>}
                    </td>
                    <td className="py-3 pr-3">
                      <LiveStatusBadge sharing={d.sharing} compact />
                    </td>
                    <td className="py-3 pr-3 text-xs text-slate-500">{d.lastSeenAt ? timeAgo(d.lastSeenAt) : "never"}</td>
                    <td className="py-3">
                      <div className="flex gap-2">
                        <button className="btn-ghost px-2 py-1 text-[11px]" onClick={() => void handleToggleActive(d)}>
                          {d.isActive ? "Disable" : "Enable"}
                        </button>
                        <button className="btn-danger px-2 py-1 text-[11px]" onClick={() => setDeletingId(d.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={showEnroll} onClose={() => setShowEnroll(false)} title="Enroll a device">
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-slate-300">
            The device owner must confirm an on-screen consent before any location data can be shared. No location is
            captured until the owner starts sharing.
          </p>
          <div>
            <label className="panel-title mb-1 block">Device name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Field phone #1" maxLength={80} />
          </div>
          <div>
            <label className="panel-title mb-1 block">Owner's mobile number (for the pairing invite)</label>
            <input
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. +919876543210"
              maxLength={20}
              inputMode="tel"
            />
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              The device owner opens the pairing link on their phone and explicitly consents before any location is shared.
            </p>
          </div>
          <div>
            <label className="panel-title mb-1 block">Platform</label>
            <div className="flex flex-wrap gap-1">
              {PLATFORMS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlatform(p)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    platform === p ? "bg-accent text-ink-950" : "bg-ink-850 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <Button onClick={() => void handleEnroll()} loading={enrolling} className="w-full">
            Enroll device
          </Button>
        </div>
      </Modal>

      <Modal open={Boolean(enrolled)} onClose={() => setEnrolled(null)} title="Device enrolled">
        {enrolled && (
          <div className="space-y-4">
            <div className="rounded-lg border border-accent-dim/40 bg-accent/5 p-3 text-sm text-slate-200">
              <span className="mb-1 block text-xs text-slate-400">Device token (shown once — treat like a password)</span>
              <code className="block break-all font-mono text-xs text-accent-soft">{enrolled.deviceToken}</code>
            </div>
            <p className="text-sm text-slate-300">
              Scan this QR code or open the link on the phone/tablet to finish pairing. It embeds the secure token.
            </p>
            <div className="flex justify-center bg-white p-4 rounded-lg w-fit mx-auto">
              <QRCodeSVG value={pairUrl} size={180} />
            </div>
            <div className="flex items-center gap-2">
              <input readOnly value={pairUrl} className="input font-mono text-[11px]" onFocus={(e) => e.target.select()} />
              <Button
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard?.writeText(pairUrl);
                  push("success", "Pairing link copied to clipboard.");
                }}
              >
                Copy
              </Button>
            </div>
            <Button
              onClick={() => {
                window.open(pairUrl, "_blank");
              }}
              className="w-full"
            >
              Open pairing link
            </Button>
            {enrolled.phone && (
              <a
                href={`https://wa.me/${enrolled.phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(
                  `Open this link on your device and confirm the request to start sharing live location: ${pairUrl}`
                )}`}
                target="_blank"
                rel="noreferrer"
                className="btn-primary w-full text-center"
              >
                Send pairing invite on WhatsApp
              </a>
            )}
          </div>
        )}
      </Modal>

      <Modal open={Boolean(deletingId)} onClose={() => setDeletingId(null)} title="Delete device?">
        <p className="text-sm text-slate-300">
          This permanently deletes the device and every recorded location fix for it. This cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeletingId(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void handleDelete()}>
            Delete device &amp; history
          </Button>
        </div>
      </Modal>
    </div>
  );
}

