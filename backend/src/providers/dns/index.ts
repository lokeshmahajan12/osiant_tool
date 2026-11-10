import dns from "node:dns";
import { ok, type OSINTProvider, type ProviderResult, type InvestigationInput } from "../types";
import { isDisposableDomain, isRoleAccount, classifyEmailProvider } from "../../utils/input";

// Uses the system-configured resolvers (portable across networks where
// public resolvers may be unavailable).
const resolver = new dns.promises.Resolver();

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("DNS lookup timed out")), ms)),
  ]);
}

async function resolveSafe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await withTimeout(fn(), 2000);
  } catch {
    return null;
  }
}

/**
 * Real, keyless DNS intelligence via Node's resolver.
 * Returns MX, TXT (SPF/DMARC), NS, CNAME, A/AAAA and best-effort email-domain
 * classification. Domain hints are completed with public record lookups.
 */
export const dnsProvider: OSINTProvider = {
  name: "dns",
  category: "dns",
  supports: ["EMAIL", "DOMAIN"],
  enabled: () => true,

  describe() {
    return {
      name: "DNS Records",
      category: "dns",
      mode: "live",
      enabled: true,
      supports: ["EMAIL", "DOMAIN"],
      description: "Public DNS records (MX, SPF, DMARC, NS, A/AAAA) via system resolver.",
    };
  },

  async investigate(input: InvestigationInput): Promise<ProviderResult> {
    const started = Date.now();
    const domain = input.type === "EMAIL" ? input.related ?? input.value.split("@")[1] : input.value;

    const [mx, txt, ns, cname, a, aaaa] = await Promise.all([
      resolveSafe(() => resolver.resolveMx(domain)),
      resolveSafe(() => resolver.resolveTxt(domain)),
      resolveSafe(() => resolver.resolveNs(domain)),
      resolveSafe(() => resolver.resolveCname(domain)),
      resolveSafe(() => resolver.resolve4(domain)),
      resolveSafe(() => resolver.resolve6(domain)),
    ]);

    const txtRecords = txt?.flat() ?? [];
    const spf = txtRecords.find((r) => r.toLowerCase().startsWith("v=spf1"));
    const dmarcRecords = await resolveSafe(() => resolver.resolveTxt(`_dmarc.${domain}`));
    const dmarc = dmarcRecords?.flat().find((r) => r.toLowerCase().startsWith("v=dmarc1"));

    const data: Record<string, unknown> = {
      domain,
      mx: mx?.map((m) => ({ exchange: m.exchange, priority: m.priority })) ?? [],
      spf: { present: Boolean(spf), record: spf ?? null },
      dmarc: { present: Boolean(dmarc), record: dmarc ?? null },
      ns: ns ?? [],
      cname: cname ?? null,
      a: a ?? [],
      aaaa: aaaa ?? [],
    };

    if (input.type === "EMAIL") {
      const localPart = input.value.split("@")[0] ?? "";
      data.emailDomain = {
        disposable: isDisposableDomain(domain),
        roleBased: isRoleAccount(localPart),
        provider: classifyEmailProvider(domain),
      };
    }

    const hasDns = Boolean(mx?.length || ns?.length || a?.length || spf || dmarc);
    return ok("dns", "dns", "DNS & Email Security", data, hasDns ? 0.85 : 0.4, {
      mode: "live",
      latencyMs: Date.now() - started,
      sources: [`dns://${domain}`],
    });
  },
};
