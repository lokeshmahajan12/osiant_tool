import { useEffect, useState } from "react";
import type { ProviderDescriptor } from "../types";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Badge, Button, Card, EmptyState, Toggle } from "../components/ui";
import { useToast } from "../context/ToastContext";

export function Providers() {
  const { user } = useAuth();
  const { push } = useToast();
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [canToggle, setCanToggle] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void api.listProviders().then(({ providers: rows }) => setProviders(rows));
    setCanToggle(user?.role === "ADMIN" || user?.role === "INVESTIGATOR");
  }, [user]);

  const toggle = async (p: ProviderDescriptor, enabled: boolean) => {
    setBusy(p.name);
    try {
      await api.toggleProvider(p.name, enabled);
      setProviders((prev) => prev.map((x) => (x.name === p.name ? { ...x, enabled } : x)));
      push("success", `${p.name} ${enabled ? "enabled" : "disabled"}`);
    } catch (err) {
      push("error", err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const test = async (p: ProviderDescriptor) => {
    setBusy(p.name);
    try {
      const { ok: isOk } = await api.testProvider(p.name);
      push(isOk ? "success" : "error", isOk ? `${p.name} responded OK` : `${p.name} returned an error`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-xl font-semibold text-slate-100">Providers</h1>
        <p className="mt-1 text-sm text-slate-500">
          Enable/disable OSINT sources independently. Providers without an API key run in mock mode.
        </p>
      </div>

      {providers.length === 0 ? (
        <EmptyState title="Loading providers…" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {providers.map((p) => (
            <Card key={p.name} title={p.name} className="flex flex-col">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge value={p.mode === "mock" ? "mock" : "live"} />
                <Badge value={p.enabled ? "COMPLETED" : "FAILED"} />
                <span className="text-[11px] text-slate-500">supports: {p.supports.join(", ")}</span>
              </div>
              <p className="mb-4 flex-1 text-sm text-slate-400">{p.description}</p>
              <div className="flex items-center justify-between border-t border-ink-800 pt-3">
                <div className="flex items-center gap-3">
                  <Toggle checked={p.enabled} disabled={!canToggle || busy === p.name} onChange={(v) => void toggle(p, v)} />
                  <span className="text-xs text-slate-500">{p.enabled ? "Active" : "Paused"}</span>
                  {p.requiresKey && (
                    <span className="text-[10px] text-slate-600">{p.requiresKey} {p.mode === "mock" ? "(not set)" : "configured"}</span>
                  )}
                </div>
                <Button variant="ghost" onClick={() => void test(p)} disabled={busy === p.name}>
                  Test
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
