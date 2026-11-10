import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button, Card } from "../components/ui";
import { useToast } from "../context/ToastContext";
import type { User } from "../types";

interface Policies {
  locationRetentionHours: number;
  locationSessionTtlHours: number;
  locationStaleThresholdMs: number;
  locationOfflineThresholdMs: number;
}

export function Settings() {
  const { user } = useAuth();
  const { push } = useToast();
  const isAdmin = user?.role === "ADMIN";

  const [retentionDays, setRetentionDays] = useState(90);
  const [autoPurge, setAutoPurge] = useState(false);
  const [consent, setConsent] = useState(false);
  const [policies, setPolicies] = useState<Policies | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [users, setUsers] = useState<User[]>([]);

  const [newUser, setNewUser] = useState({ email: "", name: "", password: "", role: "ANALYST" as User["role"] });

  useEffect(() => {
    void api.getSettings().then((s) => {
      setRetentionDays(s.retentionDays);
      setAutoPurge(s.autoPurge);
      setConsent(s.consentAcknowledged);
      setPolicies(s.policies ?? null);
    });
    if (isAdmin) void api.listUsers().then(({ users: rows }) => setUsers(rows));
  }, [isAdmin]);

  const saveSettings = async () => {
    try {
      await api.updateSettings({ retentionDays, autoPurge, consentAcknowledged: consent });
      push("success", "Settings saved");
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Save failed");
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      push("error", "New password must be at least 8 characters");
      return;
    }
    try {
      await api.changePassword(currentPassword, newPassword);
      push("success", "Password changed — other sessions were revoked");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Password change failed");
    }
  };

  const createUser = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const { user: created } = await api.createUser(newUser);
      push("success", `Created ${created.email}`);
      setNewUser({ email: "", name: "", password: "", role: "ANALYST" });
      const { users: rows } = await api.listUsers();
      setUsers(rows);
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Create failed");
    }
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    try {
      await api.setUserActive(id, !isActive);
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, isActive: !isActive } : u)));
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Update failed");
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-mono text-xl font-semibold text-slate-100">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Account, retention and privacy controls.</p>
      </div>

      <Card title="Data retention & privacy">
        <div className="space-y-4">
          {policies && (
            <div className="grid gap-2 rounded-lg border border-ink-700 bg-ink-850/60 p-3 text-xs sm:grid-cols-2">
              <div className="flex items-center justify-between">
                <span className="panel-title">Location history retention</span>
                <span className="font-mono text-slate-200">{policies.locationRetentionHours}h</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="panel-title">Location session TTL</span>
                <span className="font-mono text-slate-200">{policies.locationSessionTtlHours}h</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="panel-title">Stale threshold</span>
                <span className="font-mono text-slate-200">{(policies.locationStaleThresholdMs / 1000).toFixed(0)}s</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="panel-title">Offline threshold</span>
                <span className="font-mono text-slate-200">{(policies.locationOfflineThresholdMs / 1000).toFixed(0)}s</span>
              </div>
              <p className="sm:col-span-2 text-[11px] leading-relaxed text-slate-500">
                Location history is automatically deleted after the retention window and sharing sessions expire after
                the session TTL. These are server-side platform policies.
              </p>
            </div>
          )}
          <label className="flex items-center justify-between gap-4">
            <span className="text-sm text-slate-300">Retention period (days)</span>
            <input
              type="number"
              min={1}
              max={3650}
              value={retentionDays}
              onChange={(e) => setRetentionDays(Number(e.target.value))}
              className="input w-32"
            />
          </label>
          <label className="flex items-center justify-between gap-4">
            <span className="text-sm text-slate-300">Automatically purge expired investigations</span>
            <input type="checkbox" checked={autoPurge} onChange={(e) => setAutoPurge(e.target.checked)} className="h-4 w-4 accent-cyan-400" />
          </label>
          <label className="flex items-start justify-between gap-4">
            <span className="text-sm text-slate-300">
              I only investigate systems, accounts, domains and data I own or am authorized to investigate.
            </span>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 accent-cyan-400" />
          </label>
          <div className="flex justify-end"><Button onClick={saveSettings}>Save settings</Button></div>
        </div>
      </Card>

      <Card title="Change password">
        <form onSubmit={changePassword} className="grid gap-3 md:grid-cols-3">
          <input className="input" type="password" placeholder="Current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
          <input className="input" type="password" placeholder="New password (min 8 chars)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
          <Button type="submit">Update password</Button>
        </form>
      </Card>

      {isAdmin && (
        <Card title="User management (admin)">
          <form onSubmit={createUser} className="mb-5 grid gap-3 md:grid-cols-5">
            <input className="input" placeholder="name" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} required />
            <input className="input" type="email" placeholder="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} required />
            <input className="input" type="password" placeholder="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} required />
            <select className="input" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value as User["role"] })}>
              <option value="ANALYST">ANALYST</option>
              <option value="INVESTIGATOR">INVESTIGATOR</option>
              <option value="ADMIN">ADMIN</option>
            </select>
            <Button type="submit">Create user</Button>
          </form>
          <div className="divide-y divide-ink-800">
            {users.map((u) => (
              <div key={u.id} className="flex items-center justify-between py-2.5">
                <div>
                  <div className="text-sm text-slate-200">{u.name} <span className="text-xs text-slate-500">({u.email})</span></div>
                  <div className="text-[11px] text-slate-500">
                    {u.role.toLowerCase()} · active: {u.isActive ? "yes" : "no"}
                  </div>
                </div>
                <Button variant="ghost" onClick={() => void toggleActive(u.id, u.isActive ?? true)}>
                  {u.isActive ? "Disable" : "Enable"}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
