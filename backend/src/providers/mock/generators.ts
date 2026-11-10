/**
 * Deterministic mock generators used when a provider has no API key or when
 * MOCK_MODE=true. Output is clearly synthetic and only used for development /
 * demo purposes — never mistaken for real intelligence.
 */
import type { InputType } from "@prisma/client";
import type { InvestigationInput } from "../types";

function hashOf(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function pick<T>(seed: number, arr: readonly T[]): T {
  return arr[seed % arr.length];
}

const CARRIERS = ["Telstra", "Vodafone", "Orange", "Verizon", "T-Mobile", "Airtel", "Vodacom", "KDDI"];
const LINE_TYPES = ["mobile", "landline", "voip", "fixed line"];
const COUNTRY_POOL = [
  { code: "US", name: "United States", prefix: "+1", tz: "America/New_York" },
  { code: "GB", name: "United Kingdom", prefix: "+44", tz: "Europe/London" },
  { code: "IN", name: "India", prefix: "+91", tz: "Asia/Kolkata" },
  { code: "AU", name: "Australia", prefix: "+61", tz: "Australia/Sydney" },
  { code: "DE", name: "Germany", prefix: "+49", tz: "Europe/Berlin" },
  { code: "SG", name: "Singapore", prefix: "+65", tz: "Asia/Singapore" },
  { code: "ZA", name: "South Africa", prefix: "+27", tz: "Africa/Johannesburg" },
  { code: "BR", name: "Brazil", prefix: "+55", tz: "America/Sao_Paulo" },
];

const SOCIAL_PLATFORMS = [
  { name: "GitHub", url: (u: string) => `https://github.com/${u}` },
  { name: "X (Twitter)", url: (u: string) => `https://x.com/${u}` },
  { name: "Reddit", url: (u: string) => `https://reddit.com/user/${u}` },
  { name: "Telegram", url: (u: string) => `https://t.me/${u}` },
  { name: "Keybase", url: (u: string) => `https://keybase.io/${u}` },
  { name: "HackerNews", url: (u: string) => `https://news.ycombinator.com/user?id=${u}` },
  { name: "GitLab", url: (u: string) => `https://gitlab.com/${u}` },
  { name: "Flickr", url: (u: string) => `https://www.flickr.com/people/${u}` },
];

const IP_HOSTS = [
  { org: "Example Cloud Services", isp: "Example Cloud Services", asn: "AS15169" },
  { org: "DemoHosting Ltd", isp: "DemoHosting Ltd", asn: "AS16509" },
  { org: "Sample Telecom", isp: "Sample Telecom", asn: "AS8075" },
  { org: "MockColo Networks", isp: "MockColo Networks", asn: "AS13335" },
];

export function mockProviderResult(input: InvestigationInput): {
  data: Record<string, unknown>;
  confidence: number;
  sources: string[];
} {
  const seed = hashOf(input.value + input.type);
  switch (input.type) {
    case "EMAIL":
      return mockEmail(seed, input);
    case "PHONE":
      return mockPhone(seed);
    case "USERNAME":
      return mockUsername(seed, input);
    case "DOMAIN":
      return mockDomain(seed, input);
    case "IP":
      return mockIp(seed, input);
  }
}

function mockEmail(seed: number, input: InvestigationInput): { data: Record<string, unknown>; confidence: number; sources: string[] } {
  const domain = input.related ?? "example.com";
  const disposables = ["mailinator.com", "yopmail.com", "10minutemail.com"];
  const isDisposable = disposables.includes(domain);
  return {
    data: {
      email: input.value,
      normalized: input.value.toLowerCase(),
      syntaxValid: true,
      isDisposable,
      isRole: /^(admin|info|support|sales|hello)$/i.test(input.value.split("@")[0] ?? ""),
      isFreeMail: /gmail|yahoo|outlook|hotmail|proton|icloud/.test(domain),
      providerClass: /gmail/.test(domain) ? "Google / Gmail" : "Custom / Business domain",
      deliverability: isDisposable ? "risky" : "valid",
      smtpChecked: false,
      qualityScore: isDisposable ? 30 + (seed % 40) : 60 + (seed % 35),
      mxRecords: [{ exchange: `mx1.${domain}`, priority: 10 }, { exchange: `mx2.${domain}`, priority: 20 }],
      spf: { present: true, record: `v=spf1 include:spf.${domain} ~all` },
      dmarc: { present: true, policy: "reject", record: `v=DMARC1; p=reject; rua=mailto:dmarc@${domain}` },
      domainReputation: isDisposable ? "low" : seed % 3 === 0 ? "medium" : "high",
    },
    confidence: 0.5,
    sources: [`mock://email/${domain}`],
  };
}

function mockPhone(seed: number): { data: Record<string, unknown>; confidence: number; sources: string[] } {
  const country = COUNTRY_POOL[seed % COUNTRY_POOL.length];
  const valid = seed % 7 !== 0;
  return {
    data: {
      valid,
      countryCode: country.prefix,
      country: country.name,
      countryCodeISO: country.code,
      lineType: LINE_TYPES[seed % LINE_TYPES.length],
      carrier: CARRIERS[seed % CARRIERS.length],
      internationalFormat: `${country.prefix} ${(seed % 9000000) + 1000000}`,
      nationalFormat: `0${(seed % 9000000) + 1000000}`,
      timeZone: country.tz,
      riskScore: valid ? seed % 40 : 70 + (seed % 30),
      location: seed % 2 === 0 ? "Region unavailable" : undefined,
    },
    confidence: 0.45,
    sources: ["mock://phone/abstract"],
  };
}

function mockUsername(seed: number, input: InvestigationInput): { data: Record<string, unknown>; confidence: number; sources: string[] } {
  const platforms = SOCIAL_PLATFORMS.filter((_, i) => seed % (i + 2) > 0);
  return {
    data: {
      username: input.value,
      matches: platforms.slice(0, 3).map((p) => ({
        platform: p.name,
        username: input.value,
        url: p.url(input.value),
        httpStatus: seed % 4 === 0 ? 404 : 200,
        confidence: seed % 4 === 0 ? 0 : 0.8,
      })),
      checked: SOCIAL_PLATFORMS.length,
    },
    confidence: 0.55,
    sources: ["mock://username/social"],
  };
}

function mockDomain(seed: number, input: InvestigationInput): { data: Record<string, unknown>; confidence: number; sources: string[] } {
  const host = IP_HOSTS[seed % IP_HOSTS.length];
  const nameServers = ["ns1.dnshosting.example", "ns2.dnshosting.example"];
  return {
    data: {
      domain: input.value,
      registration: {
        registrar: pick(seed, ["Example Registrar Inc", "Sample Domains LLC", "MockNames Global"]),
        created: `20${10 + (seed % 15)}-0${(seed % 9) + 1}-01`,
        expires: `203${seed % 5}-0${(seed % 9) + 1}-01`,
        updated: `20${20 + (seed % 4)}-0${(seed % 9) + 1}-01`,
        status: ["clientTransferProhibited"],
      },
      nameservers: nameServers,
      dns: {
        A: [`203.0.113.${(seed % 254) + 1}`],
        AAAA: [`2606:4700:4700::${(seed % 1000) + 1}`],
        MX: [{ exchange: `mx1.${input.value}`, priority: 10 }],
        NS: nameServers,
        TXT: [`v=spf1 include:_spf.${input.value} ~all`],
        SPF: "v=spf1 include:_spf.example ~all",
        DMARC: "v=DMARC1; p=quarantine; pct=100",
      },
      asn: host.asn,
      ip: `203.0.113.${(seed % 254) + 1}`,
      security: {
        httpStatus: 200,
        httpsAvailable: true,
        headers: {
          "strict-transport-security": "max-age=31536000",
          "content-security-policy": "default-src 'self'",
          "x-content-type-options": "nosniff",
          "x-frame-options": "SAMEORIGIN",
        },
        missingHeaders: ["referrer-policy"],
      },
      tech: ["nginx", "cloudflare"],
    },
    confidence: 0.6,
    sources: ["mock://domain/rdap", "mock://domain/dns", "mock://domain/http"],
  };
}

function mockIp(seed: number, input: InvestigationInput): { data: Record<string, unknown>; confidence: number; sources: string[] } {
  const country = COUNTRY_POOL[seed % COUNTRY_POOL.length];
  const host = IP_HOSTS[seed % IP_HOSTS.length];
  return {
    data: {
      ip: input.value,
      version: input.value.includes(":") ? 6 : 4,
      isPublic: true,
      asn: host.asn,
      org: host.org,
      isp: host.isp,
      country: country.name,
      countryCode: country.code,
      region: pick(seed, ["Central", "Western", "Northern", "Southern"]),
      city: pick(seed, ["Metropolis", "Harbor City", "Summit City"]),
      isApproximateLocation: true,
      reverseDns: `host${seed % 100}.${host.isp.toLowerCase().replace(/[^a-z0-9]/g, "")}.example`,
      abuseConfidenceScore: seed % 100,
      isTor: seed % 17 === 0,
      totalReports: seed % 40,
      usageType: pick(seed, ["Data Center/Web Hosting/Transit", "Fixed Line ISP", "Mobile ISP"]),
      ports: [80, 443, 22].filter(() => seed % 3 === 0),
    },
    confidence: 0.65,
    sources: ["mock://ip/ipinfo", "mock://ip/abuseipdb"],
  };
}

export type { InputType };
