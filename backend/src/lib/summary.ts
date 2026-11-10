import type { InputType } from "@prisma/client";
import type { ProviderResult } from "../providers/types";

export interface InvestigationSummary {
  exposureAlerts: string[];
  findings: string[];
  recommendations: string[];
  riskLevel: "low" | "medium" | "high";
}

function num(data: Record<string, unknown> | null | undefined, key: string): number {
  return typeof data?.[key] === "number" ? (data[key] as number) : 0;
}

function bool(data: Record<string, unknown> | null | undefined, key: string): boolean | undefined {
  const v = data?.[key];
  return typeof v === "boolean" ? v : undefined;
}

function firstResult(results: ProviderResult[], provider: string): Record<string, unknown> | null {
  return results.find((r) => r.provider === provider && r.status === "SUCCESS")?.data ?? null;
}

/** Build a concise, human-readable summary of exposure indicators per input type. */
export function buildSummary(type: InputType, results: ProviderResult[]): InvestigationSummary {
  const alerts: string[] = [];
  const findings: string[] = [];
  const recommendations: string[] = [];
  const okResults = results.filter((r) => r.status === "SUCCESS" && r.data);

  if (okResults.length === 0) {
    recommendations.push("All providers failed or returned no data — retry the investigation or check provider health.");
  }

  switch (type) {
    case "EMAIL": {
      const hibp = firstResult(results, "hibp");
      if (hibp && hibp.exposed === true) {
        const count = Array.isArray(hibp.breaches) ? hibp.breaches.length : 0;
        alerts.push(`Email appears in ${count} public breach${count === 1 ? "" : "es"} (names/dates only).`);
        recommendations.push("Rotate the password on the affected accounts and enable multi-factor authentication.");
      }
      const dns = firstResult(results, "dns");
      const dmarc = dns?.dmarc as { present?: boolean; record?: string } | undefined;
      if (dmarc && !dmarc.present) {
        findings.push("Domain publishes no DMARC record — spoofing of this sender is possible.");
        recommendations.push("Publish a DMARC policy (start with p=none, move to quarantine/reject).");
      }
      const abstract = firstResult(results, "abstract");
      if (bool(abstract, "isDisposable")) {
        alerts.push("Address uses a disposable email domain.");
      }
      if (bool(abstract, "isRole")) {
        findings.push("Address is a role-based mailbox (e.g. admin@, info@), not a personal one.");
      }
      break;
    }
    case "PHONE": {
      const abstract = firstResult(results, "abstract");
      if (abstract && bool(abstract, "valid") === false) {
        alerts.push("Phone number failed validation — format may be incorrect or unassigned.");
      }
      const risk = num(abstract, "riskScore");
      if (risk >= 60) {
        alerts.push(`Provider-reported risk/fraud score is elevated (${risk}/100).`);
      }
      findings.push("Only provider-returned metadata is shown; no subscriber or location data is exposed.");
      break;
    }
    case "DOMAIN": {
      const http = firstResult(results, "http");
      const score = num(http, "securityHeaders") === 0 ? 0 : (http?.securityHeaders as { score?: number } | undefined)?.score;
      if (typeof score === "number" && score < 50) {
        alerts.push(`Security header score is low (${score}%).`);
        recommendations.push("Add CSP, HSTS and X-Content-Type-Options headers; see Security Headers result.");
      }
      const vt = firstResult(results, "virustotal");
      if (num(vt, "detectedCount") > 0) {
        alerts.push(`VirusTotal shows ${num(vt, "detectedCount")} malicious vendor verdict(s).`);
        recommendations.push("Investigate domain reputation before trusting content from this domain.");
      }
      const dns = firstResult(results, "dns");
      const dmarc = dns?.dmarc as { present?: boolean } | undefined;
      if (dmarc && !dmarc.present) {
        findings.push("No DMARC record published.");
      }
      break;
    }
    case "IP": {
      const abuse = firstResult(results, "abuseipdb");
      const score = num(abuse, "abuseConfidenceScore");
      if (score >= 50) {
        alerts.push(`AbuseIPDB confidence score is high (${score}/100) with ${num(abuse, "totalReports")} report(s).`);
      }
      if (bool(abuse, "isTor")) {
        alerts.push("IP is associated with the Tor network.");
      }
      findings.push("Geolocation is approximate network-level metadata, not physical location.");
      break;
    }
    case "USERNAME": {
      const social = firstResult(results, "social");
      const matches = Array.isArray(social?.matches) ? (social.matches as { platform: string }[]) : [];
      if (matches.length > 0) {
        findings.push(`Username found on ${matches.length} platform(s): ${matches.map((m) => m.platform).join(", ")}.`);
        recommendations.push("Treat platform hits as identity indicators, not identity confirmation.");
      } else {
        findings.push("Username not found on the checked public platforms.");
      }
      break;
    }
  }

  if (alerts.length === 0) {
    alerts.push("No elevated exposure indicators detected from the sources queried.");
  }
  findings.push(`Queried ${results.length} source(s); ${okResults.length} returned data.`);

  const riskLevel: InvestigationSummary["riskLevel"] = alerts.some((a) => a.includes("breach") || a.includes("high") || a.includes("malicious") || a.includes("Tor"))
    ? "high"
    : alerts.some((a) => a.includes("risk/fraud") || a.includes("score") || a.includes("low"))
      ? "medium"
      : "low";

  return { exposureAlerts: alerts, findings, recommendations, riskLevel };
}
