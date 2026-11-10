import { httpRequest } from "../../lib/httpClient";
import { fail, ok, type OSINTProvider, type ProviderResult, type InvestigationInput } from "../types";

const SENSITIVE_HEADERS = ["set-cookie", "authorization", "proxy-authenticate", "www-authenticate"];
const SECURITY_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy",
];

interface ProbeResult {
  url: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
}

async function probe(url: string): Promise<ProbeResult | null> {
  try {
    const res = await httpRequest<unknown>({
      url,
      method: "HEAD",
      timeoutMs: 5000,
      maxRetries: 1,
      allowedStatuses: [200, 301, 302, 307, 308, 403, 404, 405, 429, 500, 502, 503],
      followRedirects: false,
    });
    return { url, status: res.status, ok: res.status >= 200 && res.status < 400, headers: res.headers as unknown as Record<string, string> };
  } catch {
    return null;
  }
}

/**
 * Lightweight HTTP probe against the investigated domain. Single HEAD request,
 * short timeout, redirects disabled (SSRF-safe; only the validated domain is
 * contacted). Reports HTTP status and the presence of security headers.
 */
export const httpProbeProvider: OSINTProvider = {
  name: "http",
  category: "security",
  supports: ["DOMAIN"],
  enabled: () => true,

  describe() {
    return {
      name: "Security Headers",
      category: "security",
      mode: "live",
      enabled: true,
      supports: ["DOMAIN"],
      description: "HTTP status and security header posture of the target domain (HEAD request).",
    };
  },

  async investigate(input: InvestigationInput): Promise<ProviderResult> {
    const started = Date.now();
    const https = await probe(`https://${input.value}/`);
    const http = https ? null : await probe(`http://${input.value}/`);
    const chosen = https ?? http;

    if (!chosen) {
      return fail("http", "security", "HTTP probe", new Error("Target did not respond to a HEAD request"), {
        latencyMs: Date.now() - started,
      });
    }

    const headers = Object.fromEntries(
      Object.entries(chosen.headers).filter(([k]) => !SENSITIVE_HEADERS.includes(k.toLowerCase()))
    );

    const present = SECURITY_HEADERS.filter((h) => headers[h]);
    const missing = SECURITY_HEADERS.filter((h) => !headers[h]);

    const tech: string[] = [];
    const server = headers["server"];
    if (server && !server.includes("cloudflare")) tech.push(server);
    if (headers["x-powered-by"]) tech.push(headers["x-powered-by"]);
    if (chosen.url.startsWith("https")) tech.push("TLS");

    const data: Record<string, unknown> = {
      url: chosen.url,
      httpStatus: chosen.status,
      httpsSupported: Boolean(https),
      redirect: chosen.status >= 300 && chosen.status < 400,
      headers,
      securityHeaders: {
        present,
        missing,
        score: Math.round((present.length / SECURITY_HEADERS.length) * 100),
      },
      tech,
    };

    return ok("http", "security", "Security Headers", data, 0.7, {
      mode: "live",
      latencyMs: Date.now() - started,
      sources: [chosen.url],
    });
  },
};
