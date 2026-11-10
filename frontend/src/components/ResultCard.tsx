import { useState } from "react";
import type { ProviderResult } from "../types";
import { Badge, ConfidenceBar, formatDate } from "./ui";

function DataLine({ k, v }: { k: string; v: unknown }) {
  const key = k.replace(/\.\d+\./g, ".");
  return (
    <div className="flex items-start gap-2 border-b border-ink-800 py-1.5 last:border-0">
      <span className="w-36 shrink-0 truncate font-mono text-xs text-accent-dim" title={key}>
        {key}
      </span>
      <span className="min-w-0 flex-1 break-all font-mono text-xs text-slate-300">{formatValue(v)}</span>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function flatten(obj: unknown, prefix = ""): [string, unknown][] {
  const out: [string, unknown][] = [];
  if (Array.isArray(obj)) {
    if (obj.every((x) => typeof x === "string" || typeof x === "number" || typeof x === "boolean")) {
      out.push([prefix, obj.join(", ")]);
      return out;
    }
    obj.forEach((item, i) => out.push(...flatten(item, `${prefix}[${i}]`)));
    return out;
  }
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v === null || v === undefined || v === "") continue;
      out.push(...flatten(v, prefix ? `${prefix}.${k}` : k));
    }
    return out;
  }
  out.push([prefix, obj]);
  return out;
}

const HIDDEN_KEYS = /password|passwd|token|secret|api[_ ]?key|authorization|cookie/i;

export function ResultCard({ result }: { result: ProviderResult }) {
  const [expanded, setExpanded] = useState(false);
  const lines = flatten(result.data).filter(([k]) => !HIDDEN_KEYS.test(k));

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-700 px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-slate-100">{result.provider}</span>
            <Badge value={result.mode === "mock" ? "mock" : "live"} />
            <Badge value={result.status} />
          </div>
          <div className="mt-1 text-xs text-slate-500">{result.dataType}</div>
        </div>
        <div className="text-right">
          <div className="flex justify-end"><ConfidenceBar value={result.confidence} /></div>
          <div className="mt-1 text-[11px] text-slate-500">{formatDate(result.timestamp)}</div>
        </div>
      </div>

      {result.error ? (
        <div className="px-5 py-4 text-sm text-signal-danger">{result.error}</div>
      ) : result.data ? (
        <>
          <div className="max-h-56 overflow-y-auto px-5 scroll-thin">
            {lines.length === 0 ? (
              <div className="py-4 text-sm text-slate-500">No metadata returned.</div>
            ) : (
              lines.map(([k, v], i) => <DataLine key={`${k}-${i}`} k={k} v={v} />)
            )}
          </div>
          <button onClick={() => setExpanded((v) => !v)} className="w-full border-t border-ink-800 px-5 py-2 text-left text-xs text-slate-500 hover:text-accent-soft">
            {expanded ? "Collapse raw data ▴" : "Expand raw data ▾"}
          </button>
        </>
      ) : (
        <div className="px-5 py-4 text-sm text-slate-500">No data available for this source.</div>
      )}

      {expanded && (
        <div className="border-t border-ink-800 px-5 py-3">
          <pre className="max-h-80 overflow-auto text-[11px] leading-relaxed text-slate-400 scroll-thin">
            {JSON.stringify(result.data, null, 2).replace(/("[^"]*password[^"]*")\s*:\s*"[^"]*"/gi, "$1: \"[REDACTED]\"")}
          </pre>
        </div>
      )}
    </div>
  );
}
