import { httpRequest } from "../../lib/httpClient";
import { fail, ok, type OSINTProvider, type ProviderResult, type InvestigationInput } from "../types";

interface RdapEntity {
  vcardArray?: [string, string[][]];
  roles?: string[];
}

interface RdapResponse {
  handle?: string;
  startAddress?: string;
  endAddress?: string;
  ipVersion?: string;
  name?: string;
  status?: string[];
  events?: { eventAction: string; eventDate: string }[];
  nameservers?: { ldhName: string }[];
  entities?: RdapEntity[];
  port43?: string;
}

/** Extract vcard fields from RDAP entities, filtering out private contact data. */
function vcardFields(entity: RdapEntity): Record<string, string | string[] | undefined> {
  const vcard = entity.vcardArray?.[1] ?? [];
  const out: Record<string, string | string[] | undefined> = { roles: entity.roles };
  for (const line of vcard) {
    const prop = String(line[0] ?? "").toLowerCase();
    const value = line[3];
    if (typeof value !== "string") continue;
    switch (prop) {
      case "fn":
      case "org":
        out[prop] = value;
        break;
      case "tel":
        out.tel = value;
        break;
      // addr, email, geo, and other PII fields are deliberately not surfaced.
      default:
        break;
    }
  }
  return out;
}

/**
 * RDAP lookup via rdap.org (public, keyless). Only public registration metadata
 * is kept; postal addresses / personal emails inside vcards are filtered out.
 */
export const rdapProvider: OSINTProvider = {
  name: "rdap",
  category: "infrastructure",
  supports: ["DOMAIN", "IP"],
  enabled: () => true,

  describe() {
    return {
      name: "RDAP / WHOIS",
      category: "infrastructure",
      mode: "live",
      enabled: true,
      supports: ["DOMAIN", "IP"],
      description: "Public domain/IP registration metadata from the RDAP bootstrap.",
    };
  },

  async investigate(input: InvestigationInput): Promise<ProviderResult> {
    const started = Date.now();
    const url = input.type === "DOMAIN" ? `https://rdap.org/domain/${encodeURIComponent(input.value)}` : `https://rdap.org/ip/${input.value}`;

    try {
      const res = await httpRequest<RdapResponse>({ url, followRedirects: true, timeoutMs: 6000, maxRetries: 1 });

      const r = res.data;
      const data: Record<string, unknown> = {
        handle: r.handle,
        status: r.status,
        events: r.events,
        nameservers: r.nameservers?.map((n) => n.ldhName) ?? [],
        port43: r.port43,
        entities: r.entities?.map(vcardFields).filter((e) => Object.keys(e).length > 0),
      };
      if (input.type === "IP") {
        data.addressRange = { start: r.startAddress, end: r.endAddress };
        data.ipVersion = r.ipVersion;
      } else {
        data.registrar = r.entities
          ?.map(vcardFields)
          .filter((e) => Array.isArray(e.roles) && e.roles.includes("registrar"));
      }

      const present = Boolean(r.handle || r.entities?.length || r.nameservers?.length);
      return ok("rdap", "infrastructure", input.type === "DOMAIN" ? "Registration (RDAP)" : "IP Registration (RDAP)", data, present ? 0.75 : 0.35, {
        mode: "live",
        latencyMs: Date.now() - started,
        sources: [url],
      });
    } catch (err) {
      return fail("rdap", "infrastructure", "RDAP lookup", err, { latencyMs: Date.now() - started });
    }
  },
};
