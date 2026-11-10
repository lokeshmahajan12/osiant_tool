import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useState } from "react";

export function Spinner({ label = "Working…" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-400" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent-dim border-t-accent" />
      {label}
    </span>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "danger";
  loading?: boolean;
}

export function Button({ variant = "primary", loading, className = "", children, disabled, ...rest }: ButtonProps) {
  const cls = variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-danger" : "btn-ghost";
  return (
    <button className={`${cls} ${className}`} disabled={disabled || loading} {...rest}>
      {loading && <Spinner label="" />}
      {children}
    </button>
  );
}

export function Card({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`panel p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="panel-title">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

const badgeStyles: Record<string, string> = {
  SUCCESS: "bg-signal/15 text-signal",
  ERROR: "bg-signal-danger/15 text-signal-danger",
  RATE_LIMITED: "bg-signal-warn/15 text-signal-warn",
  PENDING: "bg-slate-500/15 text-slate-400",
  RUNNING: "bg-accent/15 text-accent-soft",
  COMPLETED: "bg-signal/15 text-signal",
  PARTIAL: "bg-signal-warn/15 text-signal-warn",
  FAILED: "bg-signal-danger/15 text-signal-danger",
  live: "bg-accent/15 text-accent-soft",
  mock: "bg-slate-500/15 text-slate-400",
  High: "bg-signal-danger/15 text-signal-danger",
  Medium: "bg-signal-warn/15 text-signal-warn",
  Low: "bg-slate-500/15 text-slate-400",
  high: "bg-signal-danger/15 text-signal-danger",
  medium: "bg-signal-warn/15 text-signal-warn",
  low: "bg-signal/15 text-signal",
};

export function Badge({ value }: { value: string }) {
  return <span className={`badge ${badgeStyles[value] ?? "bg-slate-500/15 text-slate-300"}`}>{value}</span>;
}

export function StatCard({ label, value, tone = "default", icon }: { label: string; value: ReactNode; tone?: "default" | "accent" | "warn" | "danger"; icon?: ReactNode }) {
  const toneCls =
    tone === "accent" ? "text-accent-soft" : tone === "warn" ? "text-signal-warn" : tone === "danger" ? "text-signal-danger" : "text-slate-200";
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between">
        <span className="panel-title">{label}</span>
        {icon}
      </div>
      <div className={`mt-2 font-mono text-2xl font-semibold ${toneCls}`}>{value}</div>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-ink-700 p-10 text-center">
      <div className="text-sm font-medium text-slate-400">{title}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="no-print fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={onClose} role="dialog" aria-label={title}>
      <div className="panel max-h-[85vh] w-full max-w-lg overflow-y-auto p-6 scroll-thin" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="panel-title">{title}</h3>
          <button className="text-slate-500 hover:text-slate-300" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="no-print fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={onCancel} role="alertdialog" aria-label={title}>
      <div className="panel w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-mono text-base font-semibold text-slate-100">{title}</h3>
        <div className="mt-2 text-sm text-slate-400">{message}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost text-xs" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className={danger ? "btn-danger text-xs" : "btn-primary text-xs"} onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, active, onChange }: { tabs: { id: T; label: string }[]; active: T; onChange: (id: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-ink-700 bg-ink-850 p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
            active === t.id ? "bg-accent text-ink-950" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? "bg-signal" : pct >= 40 ? "bg-signal-warn" : "bg-signal-danger";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded bg-ink-700">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs text-slate-400">{pct}%</span>
    </div>
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const [optimistic, setOptimistic] = useState(checked);
  const value = optimistic;
  return (
    <button
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => {
        setOptimistic(!value);
        onChange(!value);
      }}
      className={`relative h-6 w-11 rounded-full transition ${value ? "bg-accent" : "bg-ink-700"} ${disabled ? "opacity-40" : ""}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${value ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
