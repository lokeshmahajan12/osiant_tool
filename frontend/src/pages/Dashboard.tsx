import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Investigation } from "../types";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Badge, Card, ConfidenceBar, EmptyState, StatCard, timeAgo } from "../components/ui";
import { ProviderHealth } from "../components/ProviderHealth";

export function Dashboard() {
  const { user } = useAuth();
  const [recent, setRecent] = useState<Investigation[]>([]);
  const [counts, setCounts] = useState({ total: 0, EMAIL: 0, PHONE: 0, DOMAIN: 0, IP: 0, alerts: 0 });

  useEffect(() => {
    void api
      .listInvestigations({ limit: 8 })
      .then(({ items, total }) => {
        setRecent(items);
        const base = { total, EMAIL: 0, PHONE: 0, USERNAME: 0, DOMAIN: 0, IP: 0, alerts: 0 };
        for (const it of items) {
          base[it.inputType] = (base[it.inputType] ?? 0) + 1;
          const alerts = it.summary?.exposureAlerts ?? [];
          if (alerts.some((a) => !a.startsWith("No elevated"))) base.alerts += 1;
        }
        setCounts(base);
      })
      .catch(() => undefined);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-xl font-semibold text-slate-100">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">Authorized OSINT operations · welcome back, {user?.name}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
        <StatCard label="Total" value={counts.total} tone="accent" />
        <StatCard label="Email" value={counts.EMAIL} />
        <StatCard label="Phone" value={counts.PHONE} />
        <StatCard label="Domain" value={counts.DOMAIN} />
        <StatCard label="IP" value={counts.IP} />
        <StatCard label="Exposure alerts" value={counts.alerts} tone={counts.alerts > 0 ? "warn" : "default"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Recent investigations" className="lg:col-span-2">
          {recent.length === 0 ? (
            <EmptyState title="No investigations yet" hint="Run your first investigation from the Investigate page." />
          ) : (
            <div className="divide-y divide-ink-800">
              {recent.map((inv) => (
                <Link key={inv.id} to={`/investigation/${inv.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-ink-850/50">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge value={inv.inputType} />
                      <span className="truncate font-mono text-sm text-slate-200">{inv.input}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {timeAgo(inv.createdAt)} · {inv.results?.length ?? 0} sources · {inv.status}
                    </div>
                  </div>
                  <div className="shrink-0"><ConfidenceBar value={inv.confidence ?? 0} /></div>
                </Link>
              ))}
            </div>
          )}
        </Card>
        <ProviderHealth />
      </div>

      <Card title="Security posture — summary of recent findings">
        {recent.length === 0 ? (
          <EmptyState title="No findings yet" />
        ) : (
          <ul className="space-y-2 text-sm text-slate-300">
            {recent.slice(0, 5).map((inv) => (
              <li key={inv.id} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-dim" />
                <span className="min-w-0">
                  <span className="font-mono text-xs text-slate-400">{inv.input}</span> —{" "}
                  {inv.summary?.findings[0] ?? "No findings recorded."}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
