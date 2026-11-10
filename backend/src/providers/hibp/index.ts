import type { Env } from "../../config/env";
import { httpRequest } from "../../lib/httpClient";
import { providerLimiter } from "../../lib/rateLimiter";
import { providerContext } from "../../lib/providerMode";
import { fail, ok, type OSINTProvider, type ProviderResult, type InvestigationInput } from "../types";
import { mockProviderResult } from "../mock/generators";

interface HibpBreach {
  Name?: string;
  Title?: string;
  Domain?: string;
  BreachDate?: string;
  AddedDate?: string;
  PwnCount?: number;
  DataClasses?: string[];
  IsVerified?: boolean;
}

/**
 * Have I Been Pwned — breach exposure status.
 * Only breach *names, dates and status flags* are surfaced. Never passwords,
 * hashes, or breach contents.
 */
export const hibpProvider: OSINTProvider = {
  name: "hibp",
  category: "breach",
  supports: ["EMAIL"],
  enabled: () => true,

  describe() {
    return {
      name: "Have I Been Pwned",
      category: "breach",
      mode: (providerContext(process.env as unknown as Env, process.env.HIBP_API_KEY).live ? "live" : "mock") as "live" | "mock",
      enabled: true,
      supports: ["EMAIL"],
      requiresKey: "HIBP_API_KEY",
      description: "Breach exposure status via the official HIBP v3 API (names/dates only).",
    };
  },

  async investigate(input: InvestigationInput): Promise<ProviderResult> {
    const ctx = providerContext(process.env as unknown as Env, process.env.HIBP_API_KEY);
    const started = Date.now();

    if (!ctx.live) {
      const m = mockProviderResult(input);
      return ok("hibp", "breach", "Breach Exposure", {
        email: input.value,
        exposed: true,
        breaches: [
          { name: "DemoMegaCorp Breach", domain: "demomegacorp.example", breachDate: "2023-04-12", dataClasses: ["Email addresses", "Names"], verified: true },
          { name: "MockForum Leak", domain: "mockforum.example", breachDate: "2019-08-27", dataClasses: ["Email addresses"], verified: false },
        ],
        notice: "Mock/demo data — no live HIBP query performed.",
      }, m.confidence * 0.8, { mode: "mock", latencyMs: Date.now() - started, sources: ["mock://hibp"] });
    }

    const email = encodeURIComponent(input.value);
    if (!(await providerLimiter.wait("hibp", 4000))) {
      return fail("hibp", "breach", "Breach Exposure", new Error("Provider rate limit exceeded"), { latencyMs: Date.now() - started });
    }

    try {
      const res = await httpRequest<HibpBreach[]>({
        url: `https://haveibeenpwned.com/api/v3/breachedaccount/${email}`,
        headers: { "hibp-api-key": process.env.HIBP_API_KEY ?? "" },
        params: { truncateResponse: "true" },
        allowedStatuses: [200, 404],
        maxRetries: 1,
      });

      if (res.status === 404) {
        return ok("hibp", "breach", "Breach Exposure", { email: input.value, exposed: false, breaches: [] }, 0.9, {
          mode: "live",
          latencyMs: Date.now() - started,
          sources: ["https://haveibeenpwned.com"],
        });
      }

      const breaches = res.data.map((b) => ({
        name: b.Title ?? b.Name,
        domain: b.Domain,
        breachDate: b.BreachDate,
        addedDate: b.AddedDate,
        pwnCount: b.PwnCount,
        dataClasses: b.DataClasses,
        verified: b.IsVerified,
      }));

      return ok("hibp", "breach", "Breach Exposure", { email: input.value, exposed: breaches.length > 0, breaches }, 0.95, {
        mode: "live",
        latencyMs: Date.now() - started,
        sources: ["https://haveibeenpwned.com"],
      });
    } catch (err) {
      return fail("hibp", "breach", "Breach Exposure", err, { latencyMs: Date.now() - started });
    }
  },
};
