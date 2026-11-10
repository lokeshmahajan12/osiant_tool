import { Card } from "../components/ui";
import { useAuth } from "../context/AuthContext";

export function Privacy() {
  const { user } = useAuth();
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-mono text-xl font-semibold text-slate-100">Privacy Controls</h1>
        <p className="mt-1 text-sm text-slate-500">
          Understanding what data is collected, why, and how to control it.
        </p>
      </div>

      <Card title="1 · Data collection & purpose">
        <div className="space-y-4 text-sm text-slate-300">
          <p>
            SENTINEL only records sensitive device data <strong>when the account owner explicitly consents</strong>.
            There are no silent tracking capabilities in this application.
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li><span className="text-slate-100 font-medium">Location:</span> GPS coordinates, accuracy, altitude, speed, heading and timestamp — recorded only while a sharing session is active and consent is granted.</li>
            <li><span className="text-slate-100 font-medium">Camera / Microphone:</span> streams are only activated by explicit user interaction in the browser during an active, consent-backed session. No media is uploaded.</li>
            <li><span className="text-slate-100 font-medium">Notifications:</span> opt-in browser notifications for account and monitoring alerts.</li>
            <li><span className="text-slate-100 font-medium">Account metadata:</span> name, email, username, mobile, location fields you provide at registration.</li>
          </ul>
        </div>
      </Card>

      <Card title="2 · Retention">
        <div className="space-y-3 text-sm text-slate-300">
          <ul className="list-disc space-y-2 pl-5">
            <li>Location history auto-purges after the configured retention window (default 24h, server-enforced by a retention sweeper).</li>
            <li>Location sharing sessions auto-expire after their session TTL.</li>
            <li>Admins can purge location history or all session data for any account at any time.</li>
            <li>An account owner can delete their own device history directly from the share page.</li>
          </ul>
        </div>
      </Card>

      <Card title="3 · Your controls">
        <div className="space-y-4 text-sm text-slate-300">
          <p>As an account owner or administrator you have complete control:</p>
          <div className="grid gap-4">
            <div className="rounded-lg border border-ink-700 bg-ink-850 p-4">
              <h3 className="font-semibold text-slate-100">1. Stop location sharing</h3>
              <p className="mt-1 text-xs text-slate-400">Instantly halt the transmission of new GPS coordinates from your dashboard or device page.</p>
            </div>
            <div className="rounded-lg border border-ink-700 bg-ink-850 p-4">
              <h3 className="font-semibold text-slate-100">2. Manage browser/OS permissions</h3>
              <p className="mt-1 text-xs text-slate-400">Open the <strong className="text-slate-200">Permission &amp; Privacy Center</strong> to grant or revoke location, camera, microphone and notification access. You can also manage site permissions in your browser settings.</p>
            </div>
            <div className="rounded-lg border border-ink-700 bg-ink-850 p-4">
              <h3 className="font-semibold text-slate-100">3. Delete device &amp; history</h3>
              <p className="mt-1 text-xs text-slate-400">Permanently purge the device identity and all recorded location points from the Devices page.</p>
            </div>
            <div className="rounded-lg border border-signal-danger/30 bg-signal-danger/10 p-4">
              <h3 className="font-semibold text-signal-danger">4. Revoke authorization (admin)</h3>
              <p className="mt-1 text-xs text-signal-danger/80">Administrators can revoke application-side monitoring authorization, forcing all permissions to REVOKED and stopping every sharing session. Users are notified in real time.</p>
            </div>
          </div>
        </div>
      </Card>

      <Card title="4 · Security">
        <ul className="list-disc space-y-2 pl-5 text-sm text-slate-300">
          <li>Passwords are hashed with bcrypt; sessions are revocable JWT sessions stored as hashes server-side.</li>
          <li>All actions are recorded in an append-only audit log and security event stream.</li>
          <li>Role-based access control: location data is only visible to the account owner and to ADMIN roles.</li>
          <li>TLS in production, helmet security headers, CORS origin allow-list and rate limiting.</li>
        </ul>
      </Card>

      <Card title="5 · Contact & versioning">
        <div className="space-y-2 text-sm text-slate-300">
          <p>
            For privacy questions, contact your organization's security administrator. Consent version:{" "}
            <code className="rounded bg-ink-850 px-1.5 py-0.5 font-mono text-xs text-accent-soft">1.0</code>
            {" · "}Signed in as <strong className="text-slate-200">{user?.email}</strong> ({user?.role}).
          </p>
        </div>
      </Card>
    </div>
  );
}