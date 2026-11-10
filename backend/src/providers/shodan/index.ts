import type { Env } from "../../config/env";
import { httpRequest } from "../../lib/httpClient";
import { providerLimiter } from "../../lib/rateLimiter";
import { providerContext } from "../../lib/providerMode";
import { fail, ok, type OSINTProvider, type ProviderResult, type InvestigationInput } from "../types";
import { mockProviderResult } from "../mock/generators";

interface ShodanResponse {
  ip_str?: string;
  ports?: number[];
  hostnames?: string[];
  os?: string;
  isp?: string;
  org?: string;
  asn?: string;
  country_code?: string;
  city?: string;
  product?: string[];
  device_type?: string;
  tags?: string[];
  vulns?: Record<string, { summary?: string }>;
}

/** Shodan host lookup — open ports, products and public vulnerabilities. */
export const shodanProvider: OSINTProvider = {
  name: "shodan",
  category: "infrastructure",
  supports: ["IP"],
  enabled: () => true,

  describe() {
    return {
      name: "Shodan",
      category: "infrastructure",
      mode: (providerContext(process.env as unknown as Env, process.env.SHODAN_API_KEY).live ? "live" : "mock") as "live" | "mock",
      enabled: true,
      supports: ["IP"],
      requiresKey: "SHODAN_API_KEY",
      description: "Open ports, products and publicly recorded host metadata.",
    };
  },

  async investigate(input: InvestigationInput): Promise<ProviderResult> {
    const ctx = providerContext(process.env as unknown as Env, process.env.SHODAN_API_KEY);
    const started = Date.now();

    if (!ctx.live) {
      const m = mockProviderResult(input);
      return ok("shodan", "infrastructure", "Host Details", {
        ip: input.value,
        ports: m.data.ports,
        hostnames: [],
        os: undefined,
        isp: m.data.isp,
        org: m.data.org,
        asn: m.data.asn,
        product: [],
        vulnSummary: { critical: 0, high: 0, medium: 1, total: 1 },
      }, m.confidence, { mode: "mock", latencyMs: Date.now() - started, sources: ["mock://shodan"] });
    }

    if (!(await providerLimiter.wait("shodan", 4000))) {
      return fail("shodan", "infrastructure", "Host Details", new Error("Provider rate limit exceeded"), { latencyMs: Date.now() - started });
    }

    try {
      const res = await httpRequest<ShodanResponse>({
        url: `https://api.shodan.io/shodan/host/${encodeURIComponent(input.value)}`,
        params: { key: process.env.SHODAN_API_KEY ?? "" },
        maxRetries: 1,
      });
      const d = res.data;
      const vulns = d.vulns ? Object.keys(d.vulns) : [];

      return ok("shodan", "infrastructure", "Host Details", {
        ip: d.ip_str,
        ports: d.ports,
        hostnames: d.hostnames,
        os: d.os,
        isp: d.isp,
        org: d.org,
        asn: d.asn,
        countryCode: d.country_code,
        city: d.city,
        product: d.product,
        deviceType: d.device_type,
        tags: d.tags,
        cveCount: vulns.length,
        cvEs: vulns.slice(0, 30),
      }, 0.8, { mode: "live", latencyMs: Date.now() - started, sources: ["https://api.shodan.io"] });
    } catch (err) {
      return fail("shodan", "infrastructure", "Host Details", err, { latencyMs: Date.now() - started });
    }
  },
};
