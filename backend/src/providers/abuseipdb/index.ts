import type { Env } from "../../config/env";
import { httpRequest } from "../../lib/httpClient";
import { providerLimiter } from "../../lib/rateLimiter";
import { providerContext } from "../../lib/providerMode";
import { fail, ok, type OSINTProvider, type ProviderResult, type InvestigationInput } from "../types";
import { mockProviderResult } from "../mock/generators";

interface AbuseIpdResponse {
  data?: {
    ipAddress?: string;
    isPublic?: boolean;
    ipVersion?: number;
    isWhitelisted?: boolean;
    abuseConfidenceScore?: number;
    countryCode?: string;
    countryName?: string;
    usageType?: string;
    isp?: string;
    domain?: string;
    hostnames?: string[];
    totalReports?: number;
    numDistinctUsers?: number;
    lastReportedAt?: string;
    isTor?: boolean;
  };
}

/** AbuseIPDB — IP reputation/abuse scoring from the public API. */
export const abuseipdbProvider: OSINTProvider = {
  name: "abuseipdb",
  category: "reputation",
  supports: ["IP"],
  enabled: () => true,

  describe() {
    return {
      name: "AbuseIPDB",
      category: "reputation",
      mode: (providerContext(process.env as unknown as Env, process.env.ABUSEIPDB_API_KEY).live ? "live" : "mock") as "live" | "mock",
      enabled: true,
      supports: ["IP"],
      requiresKey: "ABUSEIPDB_API_KEY",
      description: "IP abuse reports, confidence score and ISP metadata.",
    };
  },

  async investigate(input: InvestigationInput): Promise<ProviderResult> {
    const ctx = providerContext(process.env as unknown as Env, process.env.ABUSEIPDB_API_KEY);
    const started = Date.now();

    if (!ctx.live) {
      const m = mockProviderResult(input);
      return ok("abuseipdb", "reputation", "IP Reputation", {
        ip: input.value,
        abuseConfidenceScore: m.data.abuseConfidenceScore,
        isp: m.data.isp,
        isTor: m.data.isTor,
        totalReports: m.data.totalReports,
        usageType: m.data.usageType,
        isPublic: true,
      }, m.confidence, { mode: "mock", latencyMs: Date.now() - started, sources: ["mock://abuseipdb"] });
    }

    if (!(await providerLimiter.wait("abuseipdb", 4000))) {
      return fail("abuseipdb", "reputation", "IP Reputation", new Error("Provider rate limit exceeded"), { latencyMs: Date.now() - started });
    }

    try {
      const res = await httpRequest<AbuseIpdResponse>({
        url: "https://api.abuseipdb.com/api/v2/check",
        headers: { Key: process.env.ABUSEIPDB_API_KEY ?? "" },
        params: { ipAddress: input.value, maxAgeInDays: 90 },
        maxRetries: 1,
      });
      const d = res.data?.data;
      return ok("abuseipdb", "reputation", "IP Reputation", {
        ip: d?.ipAddress,
        isPublic: d?.isPublic,
        ipVersion: d?.ipVersion,
        isWhitelisted: d?.isWhitelisted,
        abuseConfidenceScore: d?.abuseConfidenceScore,
        countryCode: d?.countryCode,
        countryName: d?.countryName,
        usageType: d?.usageType,
        isp: d?.isp,
        domain: d?.domain,
        hostnames: d?.hostnames,
        totalReports: d?.totalReports,
        distinctUsers: d?.numDistinctUsers,
        lastReportedAt: d?.lastReportedAt,
        isTor: d?.isTor,
      }, 0.8, { mode: "live", latencyMs: Date.now() - started, sources: ["https://api.abuseipdb.com"] });
    } catch (err) {
      return fail("abuseipdb", "reputation", "IP Reputation", err, { latencyMs: Date.now() - started });
    }
  },
};
