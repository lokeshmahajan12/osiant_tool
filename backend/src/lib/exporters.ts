import type { Investigation } from "@prisma/client";
import { buildReport } from "./report";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

/** Flatten an investigation's provider results into CSV rows. */
export function investigationToCsv(investigation: Investigation): string {
  const report = buildReport(investigation);
  const header = [
    "investigationId",
    "createdAt",
    "inputType",
    "input",
    "provider",
    "dataType",
    "status",
    "confidence",
    "timestamp",
    "mode",
    "error",
    "data",
  ];

  const rows = report.results.map((r) => [
    report.investigationId,
    investigation.createdAt.toISOString(),
    report.inputType,
    report.input,
    r.provider,
    r.dataType,
    r.status,
    r.confidence,
    r.timestamp,
    r.mode,
    r.error ?? "",
    r.data ? JSON.stringify(r.data) : "",
  ]);

  return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

export function investigationToJson(investigation: Investigation): string {
  return JSON.stringify(buildReport(investigation), null, 2);
}

export function historyToCsv(items: Investigation[]): string {
  const header = ["id", "createdAt", "inputType", "input", "status", "confidence", "riskLevel"];
  const rows = items.map((i) => {
    const s = (i.summary ?? {}) as { riskLevel?: string };
    return [i.id, i.createdAt.toISOString(), i.inputType, i.input, i.status, i.confidence ?? 0, s.riskLevel ?? "low"];
  });
  return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
}
