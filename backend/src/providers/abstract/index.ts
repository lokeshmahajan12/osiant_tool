import type { Env } from "../../config/env";
import { httpRequest } from "../../lib/httpClient";
import { providerLimiter } from "../../lib/rateLimiter";
import { providerContext } from "../../lib/providerMode";
import { fail, ok, type OSINTProvider, type ProviderResult, type InvestigationInput } from "../types";
import { mockProviderResult } from "../mock/generators";

interface AbstractEmailResponse {
  email?: string;
  autodetect_valid?: boolean;
  is_smtp_valid?: boolean;
  is_free?: boolean;
  is_role?: boolean;
  is_catchall?: boolean;
  is_disposable?: boolean;
  quality_score?: number;
  deliverability?: string;
  valid?: boolean;
}

interface AbstractPhoneResponse {
  valid?: boolean;
  number?: string;
  local_format?: string;
  international_format?: string;
  country_prefix?: string;
  country_code?: string;
  country_name?: string;
  location?: string;
  carrier?: string;
  line_type?: string;
}

/** Abstract — email validation and phone number metadata (public metadata only). */
export const abstractProvider: OSINTProvider = {
  name: "abstract",
  category: "identity",
  supports: ["EMAIL", "PHONE"],
  enabled: () => true,

  describe() {
    return {
      name: "Abstract API",
      category: "identity",
      mode: (providerContext(process.env as unknown as Env, process.env.ABSTRACT_API_KEY).live ? "live" : "mock") as "live" | "mock",
      enabled: true,
      supports: ["EMAIL", "PHONE"],
      requiresKey: "ABSTRACT_API_KEY",
      description: "Email validity, phone carrier, country and line type metadata.",
    };
  },

  async investigate(input: InvestigationInput): Promise<ProviderResult> {
    const ctx = providerContext(process.env as unknown as Env, process.env.ABSTRACT_API_KEY);
    const started = Date.now();

    if (!ctx.live) {
      const m = mockProviderResult(input);
      const data =
        input.type === "PHONE"
          ? {
              valid: m.data.valid,
              number: m.data.number ?? input.value,
              internationalFormat: m.data.internationalFormat,
              nationalFormat: m.data.nationalFormat,
              countryPrefix: m.data.countryCode,
              countryCode: m.data.countryCodeISO,
              countryName: m.data.country,
              carrier: m.data.carrier,
              lineType: m.data.lineType,
              location: m.data.location,
            }
          : {
              email: input.value,
              valid: m.data.syntaxValid,
              deliverability: m.data.deliverability,
              isFree: m.data.isFreeMail,
              isRole: m.data.isRole,
              isDisposable: m.data.isDisposable,
              qualityScore: m.data.qualityScore,
            };
      return ok("abstract", "identity", input.type === "PHONE" ? "Phone Metadata" : "Email Validation", data, m.confidence, {
        mode: "mock",
        latencyMs: Date.now() - started,
        sources: ["mock://abstract"],
      });
    }

    if (!(await providerLimiter.wait("abstract", 4000))) {
      return fail("abstract", "identity", "Abstract lookup", new Error("Provider rate limit exceeded"), { latencyMs: Date.now() - started });
    }

    try {
      if (input.type === "PHONE") {
        const res = await httpRequest<AbstractPhoneResponse>({
          url: "https://phonevalidation.abstractapi.com/v1/",
          params: { api_key: process.env.ABSTRACT_API_KEY ?? "", phone: input.value },
          maxRetries: 1,
        });
        const d = res.data;
        return ok("abstract", "identity", "Phone Metadata", {
          valid: d.valid,
          number: d.number,
          localFormat: d.local_format,
          internationalFormat: d.international_format,
          countryPrefix: d.country_prefix,
          countryCode: d.country_code,
          countryName: d.country_name,
          carrier: d.carrier,
          lineType: d.line_type,
          location: d.location,
        }, 0.7, { mode: "live", latencyMs: Date.now() - started, sources: ["https://phonevalidation.abstractapi.com"] });
      }

      const res = await httpRequest<AbstractEmailResponse>({
        url: "https://emailvalidation.abstractapi.com/v1/",
        params: { api_key: process.env.ABSTRACT_API_KEY ?? "", email: input.value },
        maxRetries: 1,
      });
      const d = res.data;
      return ok("abstract", "identity", "Email Validation", {
        email: d.email,
        valid: d.valid ?? d.autodetect_valid,
        smtpValid: d.is_smtp_valid,
        isFree: d.is_free,
        isRole: d.is_role,
        isCatchall: d.is_catchall,
        isDisposable: d.is_disposable,
        qualityScore: d.quality_score,
        deliverability: d.deliverability,
      }, 0.75, { mode: "live", latencyMs: Date.now() - started, sources: ["https://emailvalidation.abstractapi.com"] });
    } catch (err) {
      return fail("abstract", "identity", "Abstract lookup", err, { latencyMs: Date.now() - started });
    }
  },
};
