import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Investigation } from "../types";
import { api, exportInvestigationAsCsv, exportInvestigationAsJson, downloadBlob } from "../lib/api";
import { Badge, Button, Card, ConfidenceBar, EmptyState, Modal, Spinner, formatDate } from "../components/ui";
import { ResultCard } from "../components/ResultCard";
import { useToast } from "../context/ToastContext";

const REPORT_RE = /passwordHash|secret|api[_-]?key|Bearer /i;

export function InvestigationDetail() {
  const { id = "" } = useParams();
  const { push } = useToast();
  const [inv, setInv] = useState<Investigation | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [markdown, setMarkdown] = useState("");

  const poll = useCallback(async () => {
    try {
      const data = await api.getInvestigation(id);
      setInv(data);
      if (data.status === "PENDING" || data.status === "RUNNING") {
        setTimeout(() => void poll(), 1500);
      }
    } catch {
      setNotFound(true);
    }
  }, [id]);

  useEffect(() => {
    setInv(null);
    setNotFound(false);
    void poll();
  }, [poll]);

  const running = inv?.status === "PENDING" || inv?.status === "RUNNING";

  const openPdfReport = async () => {
    try {
      const md = await api.investigationReportMarkdown(id);
      setMarkdown(md);
      setPrintOpen(true);
    } catch {
      push("error", "Failed to generate report");
    }
  };

  const riskTone = useMemo(() => {
    const r = inv?.summary?.riskLevel;
    return r === "high" ? "danger" : r === "medium" ? "warn" : "default";
  }, [inv]);

  const results = inv?.results ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/history" className="text-xs text-slate-500 hover:text-accent-soft">← Back to history</Link>
          <h1 className="mt-1 font-mono text-lg font-semibold text-slate-100">
            {inv ? `${inv.inputType} · ${inv.input}` : "Loading…"}
          </h1>
          {inv && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-mono">#{inv.id.slice(-8)}</span>
              <Badge value={inv.status} />
              <span>{formatDate(inv.createdAt)}</span>
            </div>
          )}
        </div>
        {inv && (
          <div className="flex flex-wrap gap-2 no-print">
            <Button variant="ghost" onClick={() => exportInvestigationAsJson(id)}>Export JSON</Button>
            <Button variant="ghost" onClick={() => exportInvestigationAsCsv(id)}>Export CSV</Button>
            <Button onClick={openPdfReport}>PDF Report</Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirm("Delete this investigation?")) return;
                await api.deleteInvestigation(id);
                push("info", "Investigation deleted");
                location.href = "/history";
              }}
            >
              Delete
            </Button>
          </div>
        )}
      </div>

      {notFound && <EmptyState title="Investigation not found" hint="It may have been deleted or you lack access." />}

      {running && (
        <Card title="Investigating">
          <Spinner label="Querying enabled providers… this can take a few seconds." />
        </Card>
      )}

      {inv && (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card title="Confidence">
              <div className="flex items-center gap-3">
                <ConfidenceBar value={inv.confidence ?? 0} />
              </div>
            </Card>
            <Card title="Risk level">
              <Badge value={inv.summary?.riskLevel ?? "low"} />
            </Card>
            <Card title="Sources queried">
              <span className="font-mono text-2xl text-slate-200">{results.length}</span>
            </Card>
            <Card title="Successful">
              <span className="font-mono text-2xl text-signal">{results.filter((r) => r.status === "SUCCESS").length}</span>
            </Card>
          </div>

          {inv.summary && (
            <Card title="Exposure summary">
              <div className="grid gap-5 md:grid-cols-3">
                <div>
                  <h4 className="panel-title mb-2">Exposure indicators</h4>
                  <ul className="space-y-1.5 text-sm text-slate-300">
                    {inv.summary.exposureAlerts.map((a, i) => (
                      <li key={i} className="flex gap-2"><span className={riskTone === "danger" ? "text-signal-danger" : "text-signal-warn"}>◆</span>{a}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="panel-title mb-2">Findings</h4>
                  <ul className="space-y-1.5 text-sm text-slate-300">
                    {inv.summary.findings.map((f, i) => (
                      <li key={i} className="flex gap-2"><span className="text-accent-dim">◦</span>{f}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="panel-title mb-2">Recommendations</h4>
                  <ul className="space-y-1.5 text-sm text-slate-300">
                    {inv.summary.recommendations.map((r, i) => (
                      <li key={i} className="flex gap-2"><span className="text-signal">→</span>{r}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            {results.map((r) => (
              <ResultCard key={r.provider} result={r} />
            ))}
          </div>

          {results.length === 0 && !running && (
            <EmptyState title="No provider results" hint="All enabled sources failed or were unavailable." />
          )}
        </>
      )}

      <Modal open={printOpen} onClose={() => setPrintOpen(false)} title="Report — print or save as PDF">
        <div className="mb-4 flex justify-end gap-2">
          <Button onClick={() => downloadBlob(`sentinel-${id}.md`, markdown, "text/markdown")}>Download .md</Button>
          <Button onClick={() => window.print()}>Print / Save as PDF</Button>
        </div>
        <div className="print-area rounded-lg border border-ink-700 bg-white p-6 text-black">
          <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed font-mono">
            {markdown.replace(REPORT_RE, "[REDACTED]")}
          </pre>
        </div>
      </Modal>
    </div>
  );
}
