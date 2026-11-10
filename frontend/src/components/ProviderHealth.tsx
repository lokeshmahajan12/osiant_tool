import { useEffect, useState } from "react";
import type { ApiHealth } from "../types";
import { api } from "../lib/api";
import { Badge, EmptyState } from "./ui";

export function ProviderHealth() {
  const [health, setHealth] = useState<ApiHealth | null>(null);

  useEffect(() => {
    let alive = true;
    api.health().then((h) => {
      if (alive) setHealth(h);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!health) {
    return <div className="panel p-4 text-sm text-slate-500">Loading provider health…</div>;
  }

  const down = health.providers.filter((p) => !p.healthy);

  return (
    <div className="panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="panel-title">API health</h3>
        <div className="flex items-center gap-2">
          <Badge value={health.status === "ok" ? "COMPLETED" : "PARTIAL"} />
          <Badge value={health.mode === "mock" ? "mock" : "live"} />
        </div>
      </div>

      {health.providers.length === 0 ? (
        <EmptyState title="No providers registered" />
      ) : (
        <div className="space-y-2">
          {health.providers.map((p) => (
            <div key={p.name} className="flex items-center justify-between rounded-lg border border-ink-800 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${p.healthy ? "bg-signal" : "bg-signal-warn"}`} />
                <span className="font-mono text-xs text-slate-300">{p.name}</span>
                <span className="text-[10px] text-slate-500">
                  {p.mode} · {p.enabled ? "enabled" : "disabled"} · last {p.lastStatus?.toLowerCase()}
                </span>
              </div>
              {!p.healthy && <Badge value="key missing" />}
            </div>
          ))}
          {down.length > 0 && (
            <p className="pt-1 text-[11px] text-slate-500">
              {down.length} provider(s) will fall back to mock data until an API key is configured.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
