import { useEffect, useState } from "react";
import type { AuditEntry } from "../types";
import { api } from "../lib/api";
import { Badge, Card, EmptyState, formatDate } from "../components/ui";

export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api
      .listAudit({ limit: 100 })
      .then(({ items, total: count }) => {
        setEntries(items);
        setTotal(count);
      })
      .finally(() => setLoading(false));
  }, []);

  const actionTone = (action: string) => {
    if (action.includes("login") || action.includes("password")) return "accent";
    if (action.includes("delete") || action.includes("failed")) return "danger";
    if (action.includes("provider") || action.includes("enabled") || action.includes("disabled")) return "warn";
    return "default";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-xl font-semibold text-slate-100">Audit Log</h1>
        <p className="mt-1 text-sm text-slate-500">{total} recorded action(s) — administrative and security events.</p>
      </div>

      <Card>
        {loading ? (
          <div className="py-8 text-center text-sm text-slate-500">Loading audit log…</div>
        ) : entries.length === 0 ? (
          <EmptyState title="No audit entries yet" />
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-700 text-xs uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 pr-3">Time</th>
                  <th className="py-2.5 pr-3">Action</th>
                  <th className="py-2.5 pr-3">Actor</th>
                  <th className="py-2.5 pr-3">Details</th>
                  <th className="py-2.5">Source IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {entries.map((e) => (
                  <tr key={e.id} className="align-top hover:bg-ink-850/50">
                    <td className="whitespace-nowrap py-3 pr-3 text-xs text-slate-500">{formatDate(e.createdAt)}</td>
                    <td className="py-3 pr-3">
                      <Badge value={e.action.includes("failed") ? "ERROR" : actionTone(e.action) === "danger" ? "FAILED" : e.action.toUpperCase()} />
                      <div className="mt-1 font-mono text-xs text-slate-300">{e.action}</div>
                    </td>
                    <td className="py-3 pr-3 text-xs text-slate-400">{e.user?.email ?? "system"}</td>
                    <td className="max-w-xs truncate py-3 pr-3 text-xs text-slate-500">
                      {e.details ? JSON.stringify(e.details) : "—"}
                    </td>
                    <td className="py-3 font-mono text-xs text-slate-500">{e.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
