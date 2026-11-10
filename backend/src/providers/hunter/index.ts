import type { Env } from "../../config/env";
import { httpRequest } from "../../lib/httpClient";
import { providerLimiter } from "../../lib/rateLimiter";
import { providerContext } from "../../lib/providerMode";
import { fail, ok, type OSINTProvider, type ProviderResult, type InvestigationInput } from "../types";
import { mockProviderResult } from "../mock/generators";

interface HunterResponse {
  data?: {
    status?: string;
    result?: string;
    score?: number;
    disposable?: boolean;
    webmail?: boolean;
    mx_records?: boolean;
    smtp_check?: boolean;
    accept_all?: boolean;
    pattern?: string;
    organization?: string;
  };
}

/** Hunter.io email verifier — legitimate domain/email verification only. */
export const hunterProvider: OSINTProvider = {
  name: "hunter",
  category: "identity",
  supports: ["EMAIL"],
  enabled: () => true,

  describe() {
    return {
      name: "Hunter",
      category: "identity",
      mode: (providerContext(process.env as unknown as Env, process.env.HUNTER_API_KEY).live ? "live" : "mock") as "live" | "mock",
      enabled: true,
      supports: ["EMAIL"],
      requiresKey: "HUNTER_API_KEY",
      description: "Email verification and deliverability signals (public metadata only).",
    };
  },

  async investigate(input: InvestigationInput): Promise<ProviderResult> {
    const ctx = providerContext(process.env as unknown as Env, process.env.HUNTER_API_KEY);
    const started = Date.now();

    if (!ctx.live) {
      const m = mockProviderResult(input);
      return ok("hunter", "identity", "Email Verification", {
        email: input.value,
        status: "valid",
        score: m.data.qualityScore,
        disposable: m.data.isDisposable,
        webmail: m.data.isFreeMail,
        mxRecords: m.data.mxRecords ? true : false,
        smtpChecked: false,
        acceptAll: false,
        verifiedBy: "mock",
      }, m.confidence * 0.8, { mode: "mock", latencyMs: Date.now() - started, sources: ["mock://hunter"] });
    }

    if (!(await providerLimiter.wait("hunter", 4000))) {
      return fail("hunter", "identity", "Email Verification", new Error("Provider rate limit exceeded"), { latencyMs: Date.now() - started });
    }

    try {
      const res = await httpRequest<HunterResponse>({
        url: "https://api.hunter.io/v2/email-verifier",
        params: { email: input.value, api_key: process.env.HUNTER_API_KEY ?? "" },
        maxRetries: 1,
      });

      const d = res.data?.data;
      return ok("hunter", "identity", "Email Verification", {
        email: input.value,
        status: d?.status,
        result: d?.result,
        score: d?.score,
        disposable: d?.disposable,
        webmail: d?.webmail,
        mxRecords: d?.mx_records,
        smtpCheck: d?.smtp_check,
        acceptAll: d?.accept_all,
        pattern: d?.pattern,
        organization: d?.organization,
      }, 0.7, { mode: "live", latencyMs: Date.now() - started, sources: ["https://api.hunter.io"] });
    } catch (err) {
      return fail("hunter", "identity", "Email Verification", err, { latencyMs: Date.now() - started });
    }
  },
};
