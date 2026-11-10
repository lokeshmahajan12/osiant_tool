import type { Investigation } from "@prisma/client";
import type { ProviderResult } from "../providers/types";

export interface ReportData {
  investigationId: string;
  generatedAt: string;
  inputType: string;
  input: string;
  status: string;
  confidence: number;
  sources: string[];
  providerCount: number;
  successfulProviders: number;
  exposureAlerts: string[];
  findings: string[];
  recommendations: string[];
  riskLevel: string;
  results: ProviderResult[];
}

function parseResults(investigation: Investigation): ProviderResult[] {
  const r = investigation.results as unknown;
  return Array.isArray(r) ? (r as ProviderResult[]) : [];
}

function parseSummary(investigation: Investigation): {
  exposureAlerts: string[];
  findings: string[];
  recommendations: string[];
  riskLevel: string;
} {
  const s = (investigation.summary ?? {}) as Record<string, unknown>;
  return {
    exposureAlerts: Array.isArray(s.exposureAlerts) ? (s.exposureAlerts as string[]) : [],
    findings: Array.isArray(s.findings) ? (s.findings as string[]) : [],
    recommendations: Array.isArray(s.recommendations) ? (s.recommendations as string[]) : [],
    riskLevel: typeof s.riskLevel === "string" ? s.riskLevel : "low",
  };
}

export function buildReport(investigation: Investigation): ReportData {
  const results = parseResults(investigation);
  const summary = parseSummary(investigation);
  const sources = new Set<string>();
  for (const r of results) for (const s of r.sources ?? []) sources.add(s);

  return {
    investigationId: investigation.id,
    generatedAt: new Date().toISOString(),
    inputType: investigation.inputType,
    input: investigation.input,
    status: investigation.status,
    confidence: investigation.confidence ?? 0,
    sources: [...sources],
    providerCount: results.length,
    successfulProviders: results.filter((r) => r.status === "SUCCESS").length,
    exposureAlerts: summary.exposureAlerts,
    findings: summary.findings,
    recommendations: summary.recommendations,
    riskLevel: summary.riskLevel,
    results,
  };
}

const DATA_BLOCKS: Record<string, { title: string; keys: string[] }> = {
  "hibp": { title: "Breach Exposure", keys: ["exposed", "breaches"] },
  "dns": { title: "DNS Records", keys: ["mx", "spf", "dmarc", "ns", "a"] },
  "rdap": { title: "Registration (RDAP)", keys: ["handle", "nameservers", "status"] },
  "http": { title: "Security Headers", keys: ["httpStatus", "securityHeaders"] },
  "abstract": { title: "Identity / Metadata", keys: ["valid", "carrier", "lineType", "countryName", "isDisposable", "deliverability"] },
  "hunter": { title: "Email Verification", keys: ["status", "score", "disposable"] },
  "abuseipdb": { title: "IP Reputation", keys: ["abuseConfidenceScore", "isp", "totalReports", "isTor"] },
  "ipinfo": { title: "IP Metadata", keys: ["org", "country", "region", "city", "hostname"] },
  "virustotal": { title: "Vendor Reputation", keys: ["reputation", "lastAnalysisStats", "detectedCount"] },
  "shodan": { title: "Host Details", keys: ["ports", "asn", "isp", "cveCount"] },
  "social": { title: "Username Presence", keys: ["matches"] },
};

function flatten(obj: unknown, prefix = ""): string[] {
  const lines: string[] = [];
  if (obj === null || obj === undefined) return lines;
  if (Array.isArray(obj)) {
    if (obj.length === 0) return lines;
    if (obj.every((v) => typeof v === "string" || typeof v === "number")) {
      lines.push(`${prefix}: ${obj.join(", ")}`);
      return lines;
    }
    obj.forEach((v, i) => lines.push(...flatten(v, `${prefix}[${i}]`)));
    return lines;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v === null || v === undefined || v === "") continue;
      lines.push(...flatten(v, prefix ? `${prefix}.${k}` : k));
    }
    return lines;
  }
  lines.push(`${prefix}: ${String(obj)}`);
  return lines;
}

/** Render a printable Markdown report (used by the frontend PDF generator). */
export function renderMarkdown(report: ReportData): string {
  const lines: string[] = [];
  lines.push(`# OSINT Investigation Report`);
  lines.push(`\n> Authorized defensive OSINT. Public data only.`);
  lines.push(`\n- **Investigation ID:** \`${report.investigationId}\``);
  lines.push(`- **Generated:** ${new Date(report.generatedAt).toLocaleString()}`);
  lines.push(`- **Input type:** ${report.inputType}`);
  lines.push(`- **Input:** ${report.input}`);
  lines.push(`- **Status:** ${report.status} · **Confidence:** ${(report.confidence * 100).toFixed(0)}%`);
  lines.push(`- **Risk level:** ${report.riskLevel}`);
  lines.push(`- **Sources queried (${report.sources.length}):** ${report.sources.join(", ") || "none"}`);

  lines.push(`\n## Exposure indicators`);
  for (const a of report.exposureAlerts) lines.push(`- ${a}`);

  lines.push(`\n## Findings`);
  for (const f of report.findings) lines.push(`- ${f}`);

  lines.push(`\n## Recommendations`);
  for (const r of report.recommendations) lines.push(`- ${r}`);

  lines.push(`\n## Provider results`);
  for (const r of report.results) {
    const block = DATA_BLOCKS[r.provider];
    lines.push(`\n### ${r.provider} — ${block?.title ?? r.dataType} [${r.status}${r.mode === "mock" ? " (mock)" : ""}]`);
    lines.push(`- Data type: ${r.dataType} · Confidence: ${(r.confidence * 100).toFixed(0)}% · ${new Date(r.timestamp).toLocaleString()}`);
    if (r.error) lines.push(`- Error: ${r.error}`);
    if (r.data) {
      const keys = block?.keys ?? [];
      for (const line of flatten(r.data).filter((l) => !keys.length || keys.some((k) => l.startsWith(k)))) {
        lines.push(`- ${line}`);
      }
    }
  }

  lines.push(`\n---\n*Generated by SENTINEL. This report contains only publicly available metadata returned by legitimate APIs.*`);
  return lines.join("\n");
}
