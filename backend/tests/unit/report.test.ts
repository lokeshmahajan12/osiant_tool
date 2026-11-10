import { describe, expect, it } from "vitest";
import type { Investigation } from "@prisma/client";
import { buildReport, renderMarkdown } from "../../src/lib/report";
import { investigationToCsv, investigationToJson } from "../../src/lib/exporters";

function fakeInvestigation(overrides: Partial<Investigation> = {}): Investigation {
  return {
    id: "test-123",
    userId: "user-1",
    inputType: "EMAIL",
    input: "analyst@example.com",
    normalized: "analyst@example.com",
    status: "COMPLETED",
    confidence: 0.75,
    summary: {
      exposureAlerts: ["Email appears in 2 public breaches."],
      findings: ["Queried 4 source(s); 3 returned data."],
      recommendations: ["Rotate password and enable MFA."],
      riskLevel: "high",
    },
    results: [
      {
        provider: "hibp",
        category: "breach",
        status: "SUCCESS",
        dataType: "Breach Exposure",
        confidence: 0.95,
        timestamp: "2026-01-01T00:00:00.000Z",
        data: { exposed: true, breaches: [{ name: "DemoBreach", domain: "demo.example", breachDate: "2023-01-01" }] },
        mode: "mock",
        sources: ["mock://hibp"],
      },
    ],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    completedAt: new Date("2026-01-01T00:00:01.000Z"),
    expiresAt: null,
    error: null,
    ...overrides,
  };
}

describe("report", () => {
  it("builds a report with sources, findings and exposure alerts", () => {
    const report = buildReport(fakeInvestigation());
    expect(report.investigationId).toBe("test-123");
    expect(report.sources).toContain("mock://hibp");
    expect(report.exposureAlerts.length).toBeGreaterThan(0);
    expect(report.providerCount).toBe(1);
    expect(report.successfulProviders).toBe(1);
  });

  it("renders markdown without leaking credential-like data", () => {
    const md = renderMarkdown(buildReport(fakeInvestigation()));
    expect(md).toContain("OSINT Investigation Report");
    expect(md).toContain("test-123");
    expect(md).not.toContain("passwordHash");
    expect(md).not.toContain("Bearer ");
    expect(md).not.toContain("api_key");
  });
});

describe("exporters", () => {
  it("exports JSON", () => {
    const json = investigationToJson(fakeInvestigation());
    const parsed = JSON.parse(json);
    expect(parsed.input).toBe("analyst@example.com");
    expect(parsed.results[0].provider).toBe("hibp");
  });

  it("exports CSV with header and escaped values", () => {
    const csv = investigationToCsv(fakeInvestigation());
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain("investigationId");
    expect(lines.length).toBe(2);
    expect(csv).toContain("test-123");
  });
});
