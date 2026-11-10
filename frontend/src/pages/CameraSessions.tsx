import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { AdminCameraSession } from "../types";
import { Button, Card, ConfirmDialog, EmptyState, Spinner, formatDate } from "../components/ui";
import { useToast } from "../context/ToastContext";

const PAGE_SIZE = 20;

export function CameraSessions() {
  const { push: toast } = useToast();
  const [items, setItems] = useState<AdminCameraSession[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [endTarget, setEndTarget] = useState<AdminCameraSession | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.adminCameraSessions({ limit: PAGE_SIZE, offset: page * PAGE_SIZE });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to load camera sessions");
    } finally {
      setLoading(false);
    }
  }, [page, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const end = async (target: AdminCameraSession) => {
    setBusyId(target.id);
    try {
      await api.adminCameraEnd(target.userId, target.id);
      toast("success", `Camera session for ${target.user.name} ended`);
      setEndTarget(null);
      void load();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to end camera session");
    } finally {
      setBusyId(null);
    }
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeCount = items.filter((s) => s.status === "ACTIVE").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-xl font-semibold text-slate-100">Camera sessions</h1>
        <p className="mt-1 text-sm text-slate-500">{total} recorded sessions{activeCount > 0 && <>, {activeCount} active on this page</>}</p>
      </div>

      <Card title="Session registry">
        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner label="Loading sessions…" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState title="No camera sessions yet" hint="Sessions are created when users enable their camera from the portal." />
        ) : (
          <div className="divide-y divide-ink-800">
            {items.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-slate-200">{s.user.name}</span>
                    <span className={`badge ${s.status === "ACTIVE" ? "bg-signal/15 text-signal" : "bg-slate-500/15 text-slate-400"}`}>
                      {s.status}
                    </span>
                    <span className="badge bg-accent/15 text-accent-soft">{s.mode}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {s.user.email} · started {formatDate(s.startedAt)}
                    {s.endedAt ? ` · ended ${formatDate(s.endedAt)}` : ""}
                    {s.endedBy ? ` · ended by ${s.endedBy}` : ""}
                  </div>
                </div>
                {s.status === "ACTIVE" && (
                  <Button variant="danger" className="text-xs" loading={busyId === s.id} onClick={() => setEndTarget(s)}>
                    End session
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between border-t border-ink-700 pt-3 text-xs text-slate-400">
          <span>Page {page + 1} of {pages}</span>
          <div className="flex gap-2">
            <button className="btn-ghost text-xs" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              ← Prev
            </button>
            <button className="btn-ghost text-xs" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
              Next →
            </button>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={!!endTarget}
        title="End camera session"
        message={endTarget ? `End the ${endTarget.mode} camera session for ${endTarget.user.name}?` : ""}
        confirmLabel="End session"
        danger
        busy={busyId !== null}
        onCancel={() => setEndTarget(null)}
        onConfirm={() => endTarget && void end(endTarget)}
      />
    </div>
  );
}