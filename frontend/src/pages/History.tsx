import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { InputType, Investigation } from "../types";
import { api, downloadBlob } from "../lib/api";
import { Badge, Button, Card, ConfidenceBar, EmptyState, Tabs, formatDate } from "../components/ui";
import { useToast } from "../context/ToastContext";

const TYPES: InputType[] = ["EMAIL", "PHONE", "USERNAME", "DOMAIN", "IP"];

export function History() {
  const { push } = useToast();
  const [items, setItems] = useState<Investigation[]>([]);
  const [total, setTotal] = useState(0);
  const [type, setType] = useState<InputType | "ALL">("ALL");
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (filter: InputType | "ALL") => {
      setLoading(true);
      try {
        const { items: rows, total: count } = await api.listInvestigations({
          limit: 100,
          ...(filter === "ALL" ? {} : { type: filter }),
        });
        setItems(rows);
        setTotal(count);
      } catch {
        push("error", "Failed to load history");
      } finally {
        setLoading(false);
      }
    },
    [push]
  );

  useEffect(() => {
    void load(type);
  }, [load, type]);

  const exportHistory = async () => {
    try {
      const res = await fetch("/api/investigations/export", { headers: { Authorization: `Bearer ${localStorage.getItem("sentinel.token") ?? ""}` } });
      const text = await res.text();
      downloadBlob("sentinel-history.csv", text, "text/csv");
    } catch {
      push("error", "Export failed");
    }
  };

  const wipeAll = async () => {
    if (!confirm("Delete ALL investigation history? This cannot be undone.")) return;
    const { deleted } = await api.deleteAllInvestigations();
    push("info", `Deleted ${deleted} investigation(s)`);
    void load(type);
  };

  const counts = items.reduce<Record<string, number>>((acc, i) => {
    acc[i.inputType] = (acc[i.inputType] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-xl font-semibold text-slate-100">History</h1>
          <p className="mt-1 text-sm text-slate-500">{total} investigation(s) · retention applies</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={exportHistory}>Export CSV</Button>
          <Button variant="danger" onClick={wipeAll}>Delete all</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs<InputType | "ALL">
          tabs={[{ id: "ALL", label: "All" }, ...TYPES.map((t) => ({ id: t, label: `${t} (${counts[t] ?? 0})` }))]}
          active={type}
          onChange={setType}
        />
      </div>

      <Card>
        {loading ? (
          <div className="py-8 text-center text-sm text-slate-500">Loading history…</div>
        ) : items.length === 0 ? (
          <EmptyState title="No investigations match this filter" />
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-700 text-xs uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 pr-3">Input</th>
                  <th className="py-2.5 pr-3">Type</th>
                  <th className="py-2.5 pr-3">Status</th>
                  <th className="py-2.5 pr-3">Confidence</th>
                  <th className="py-2.5 pr-3">Created</th>
                  <th className="py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {items.map((inv) => (
                  <tr key={inv.id} className="hover:bg-ink-850/50">
                    <td className="max-w-[280px] truncate py-3 pr-3 font-mono text-slate-200">{inv.input}</td>
                    <td className="py-3 pr-3"><Badge value={inv.inputType} /></td>
                    <td className="py-3 pr-3"><Badge value={inv.status} /></td>
                    <td className="py-3 pr-3"><ConfidenceBar value={inv.confidence ?? 0} /></td>
                    <td className="py-3 pr-3 text-slate-500">{formatDate(inv.createdAt)}</td>
                    <td className="py-3 text-right">
                      <Link to={`/investigation/${inv.id}`} className="text-xs text-accent-soft hover:underline">
                        Open →
                      </Link>
                    </td>
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
