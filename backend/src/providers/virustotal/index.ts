import type { Env } from "../../config/env";
import { httpRequest } from "../../lib/httpClient";
import { providerLimiter } from "../../lib/rateLimiter";
import { providerContext } from "../../lib/providerMode";
import { fail, ok, type OSINTProvider, type ProviderResult, type InvestigationInput } from "../types";
import { mockProviderResult } from "../mock/generators";

interface VtResponse {
  data?: {
    id?: string;
    type?: string;
    attributes?: {
      last_analysis_stats?: Record<string, number>;
      reputation?: number;
      last_analysis_results?: Record<string, { category?: string; result?: string }>;
      last_https_certificate?: { validity_not_after?: string; validity_not_before?: string; issuer?: { CN?: string } };
      last_dns_records?: { type?: string; value?: string }[];
    };
  };
}

/** VirusTotal — third-party reputation scanning for domains and IPs. */
export const virustotalProvider: OSINTProvider = {
  name: "virustotal",
  category: "reputation",
  supports: ["DOMAIN", "IP"],
  enabled: () => true,

  describe() {
    return {
      name: "VirusTotal",
      category: "reputation",
      mode: (providerContext(process.env as unknown as Env, process.env.VIRUSTOTAL_API_KEY).live ? "live" : "mock") as "live" | "mock",
      enabled: true,
      supports: ["DOMAIN", "IP"],
      requiresKey: "VIRUSTOTAL_API_KEY",
      description: "Vendor reputation verdicts for domains and IP addresses.",
    };
  },

  async investigate(input: InvestigationInput): Promise<ProviderResult> {
    const ctx = providerContext(process.env as unknown as Env, process.env.VIRUSTOTAL_API_KEY);
    const started = Date.now();

    if (!ctx.live) {
      const m = mockProviderResult(input);
      return ok("virustotal", "reputation", "Vendor Reputation", {
        target: input.value,
        lastAnalysisStats: { malicious: input.type === "IP" ? 0 : 1, suspicious: 0, harmless: 12, undetected: 55 },
        reputation: 0,
        detectedEngines: input.type === "IP" ? [] : [{ engine: "MockSecure", result: "phishing" }],
      }, m.confidence, { mode: "mock", latencyMs: Date.now() - started, sources: ["mock://virustotal"] });
    }

    if (!(await providerLimiter.wait("virustotal", 4000))) {
      return fail("virustotal", "reputation", "Vendor Reputation", new Error("Provider rate limit exceeded"), { latencyMs: Date.now() - started });
    }

    try {
      const resource = input.type === "DOMAIN" ? "domains" : "ip_addresses";
      const res = await httpRequest<VtResponse>({
        url: `https://www.virustotal.com/api/v3/${resource}/${encodeURIComponent(input.value)}`,
        headers: { "x-apikey": process.env.VIRUSTOTAL_API_KEY ?? "" },
        maxRetries: 1,
      });

      const a = res.data?.data?.attributes;
      const engineHits = Object.entries(a?.last_analysis_results ?? {})
        .filter(([, v]) => v.category === "malicious")
        .slice(0, 20)
        .map(([engine, v]) => ({ engine, result: v.result }));

      const data: Record<string, unknown> = {
        target: input.value,
        reputation: a?.reputation,
        lastAnalysisStats: a?.last_analysis_stats,
        detectedEngines: engineHits,
        detectedCount: engineHits.length,
      };

      if (input.type === "DOMAIN") {
        data.sslCertificate = a?.last_https_certificate
          ? {
              issuer: a.last_https_certificate.issuer?.CN,
              validFrom: a.last_https_certificate.validity_not_before,
              validTo: a.last_https_certificate.validity_not_after,
            }
          : undefined;
        data.dnsRecords = a?.last_dns_records?.filter((r) => r.type === "MX" || r.type === "A").slice(0, 10);
      }

      return ok("virustotal", "reputation", "Vendor Reputation", data, 0.85, {
        mode: "live",
        latencyMs: Date.now() - started,
        sources: ["https://www.virustotal.com"],
      });
    } catch (err) {
      return fail("virustotal", "reputation", "Vendor Reputation", err, { latencyMs: Date.now() - started });
    }
  },
};
