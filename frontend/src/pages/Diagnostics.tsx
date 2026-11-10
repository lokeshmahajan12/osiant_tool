import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

export function Diagnostics() {
  const [diag, setDiag] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // We expect the token to be stored in sessionStorage by DeviceClient
    const token = sessionStorage.getItem("sentinel.deviceToken");
    if (!token) {
      setError("Device not paired. Missing token.");
      setLoading(false);
      return;
    }
    
    api.deviceDiagnostics(token)
      .then(d => setDiag(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-ink-950 p-6 text-slate-200 font-mono text-sm">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-100">Connection Diagnostics</h1>
        <p className="text-slate-500 text-xs">Troubleshoot mobile device connectivity</p>
      </div>

      {loading ? (
        <div className="text-slate-500">Loading diagnostics...</div>
      ) : error ? (
        <div className="rounded border border-signal-danger/30 bg-signal-danger/10 p-4 text-signal-danger">
          {error}
        </div>
      ) : (
        <div className="space-y-4">
          <DiagRow label="Internet connection" value={navigator.onLine ? "🟢 Connected" : "🔴 Offline"} />
          <DiagRow label="Backend API" value={diag.apiStatus === 200 ? "🟢 Connected" : "🔴 Error"} />
          <DiagRow label="Device Authentication" value={diag.auth ? "🟢 Granted" : "🔴 Denied"} />
          <DiagRow label="GPS Availability" value={"geolocation" in navigator ? "🟢 Available" : "🔴 Unavailable"} />
          
          <div className="mt-8 border-t border-ink-800 pt-4">
            <h2 className="text-slate-400 mb-2">Backend Records</h2>
            <DiagRow label="Device ID" value={diag.deviceId} />
            <DiagRow label="Server Time" value={new Date(diag.serverTime).toLocaleString()} />
            <DiagRow label="Last Seen At" value={diag.lastSeenAt ? new Date(diag.lastSeenAt).toLocaleString() : "Never"} />
            <DiagRow label="Last GPS Fix" value={diag.lastFix ? `${diag.lastFix.latitude.toFixed(5)}, ${diag.lastFix.longitude.toFixed(5)} (${diag.lastFix.accuracy}m)` : "None recorded"} />
            <DiagRow label="Last Fix Time" value={diag.lastFix ? new Date(diag.lastFix.timestamp).toLocaleString() : "N/A"} />
          </div>
        </div>
      )}

      <div className="mt-8">
        <Link to="/" className="text-accent hover:underline">← Back to Dashboard</Link>
      </div>
    </div>
  );
}

function DiagRow({ label, value }: { label: string; value: string | React.ReactNode }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-ink-800/50">
      <span className="text-slate-400">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
