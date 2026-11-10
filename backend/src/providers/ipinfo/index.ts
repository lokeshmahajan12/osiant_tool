import type { Env } from "../../config/env";
import { httpRequest } from "../../lib/httpClient";
import { providerLimiter } from "../../lib/rateLimiter";
import { providerContext } from "../../lib/providerMode";
import { fail, ok, type OSINTProvider, type ProviderResult, type InvestigationInput } from "../types";
import { mockProviderResult } from "../mock/generators";

interface IpinfoResponse {
  ip?: string;
  hostname?: string;
  city?: string;
  region?: string;
  country?: string;
  org?: string;
  timezone?: string;
}

/**
 * ipinfo.io — coarse IP network metadata. `loc` (lat/lng) and `postal` are
 * deliberately dropped: results describe a network, never an exact location.
 */
export const ipinfoProvider: OSINTProvider = {
  name: "ipinfo",
  category: "infrastructure",
  supports: ["IP"],
  enabled: () => true,

  describe() {
    return {
      name: "ipinfo",
      category: "infrastructure",
      mode: (providerContext(process.env as unknown as Env, process.env.IPINFO_API_KEY).live ? "live" : "mock") as "live" | "mock",
      enabled: true,
      supports: ["IP"],
      requiresKey: "IPINFO_API_KEY",
      description: "ASN/ISP, hostname and coarse region metadata for an IP.",
    };
  },

  async investigate(input: InvestigationInput): Promise<ProviderResult> {
    const ctx = providerContext(process.env as unknown as Env, process.env.IPINFO_API_KEY);
    const started = Date.now();

    if (!ctx.live) {
      const m = mockProviderResult(input);
      return ok("ipinfo", "infrastructure", "IP Metadata", {
        ip: input.value,
        hostname: m.data.reverseDns,
        city: m.data.city,
        region: m.data.region,
        country: m.data.countryCode,
        org: m.data.org,
        isApproximateLocation: true,
      }, m.confidence, { mode: "mock", latencyMs: Date.now() - started, sources: ["mock://ipinfo"] });
    }

    if (!(await providerLimiter.wait("ipinfo", 4000))) {
      return fail("ipinfo", "infrastructure", "IP Metadata", new Error("Provider rate limit exceeded"), { latencyMs: Date.now() - started });
    }

    try {
      const res = await httpRequest<IpinfoResponse>({
        url: `https://ipinfo.io/${encodeURIComponent(input.value)}/json`,
        headers: { Authorization: `Bearer ${process.env.IPINFO_API_KEY ?? ""}` },
        maxRetries: 1,
      });
      const d = res.data;
      return ok("ipinfo", "infrastructure", "IP Metadata", {
        ip: d.ip,
        hostname: d.hostname,
        city: d.city,
        region: d.region,
        country: d.country,
        org: d.org,
        timezone: d.timezone,
        isApproximateLocation: true,
      }, 0.8, { mode: "live", latencyMs: Date.now() - started, sources: ["https://ipinfo.io"] });
    } catch (err) {
      return fail("ipinfo", "infrastructure", "IP Metadata", err, { latencyMs: Date.now() - started });
    }
  },
};
