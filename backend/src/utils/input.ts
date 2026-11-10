import net from "node:net";
import { InputType } from "@prisma/client";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

/** Known common email roles. */
const ROLE_PATTERNS = /^(admin|info|contact|support|sales|team|hello|careers|jobs|security|abuse|billing|accounts?|help|service|marketing|press|webmaster|postmaster|hostmaster|office|noreply|no-reply|root|mail|it|devops|developer|hr|recruiting|management|feedback|news|test|spam)$/i;

/** Well-known disposable email domains (a small representative subset). */
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "sharklasers.com", "maildrop.cc",
  "temp-mail.org", "10minutemail.com", "yopmail.com", "throwawaymail.com",
  "mailnesia.com", "getnada.com", "tempmail.com", "trashmail.com",
  "dispostable.com", "mohmal.com", "emailondeck.com", "tempmailo.com",
]);

export interface NormalizedInput {
  type: InputType;
  original: string;
  value: string;
  /** Secondary value useful for some providers (e.g. domain extracted from an email). */
  related?: string;
}

export function validateAndNormalize(type: InputType, raw: string): NormalizedInput {
  const original = String(raw ?? "").trim();

  switch (type) {
    case "EMAIL": {
      const email = original.toLowerCase();
      if (!EMAIL_RE.test(email)) throw new ValidationError("Invalid email address format");
      if (email.length > 254) throw new ValidationError("Email address exceeds 254 characters");
      const [, domain] = splitAtLastAt(email);
      if (!domain || !DOMAIN_RE.test(domain)) throw new ValidationError("Email domain is invalid");
      return { type, original, value: email, related: domain };
    }
    case "PHONE": {
      const phone = original.replace(/[\s\-().]/g, "");
      if (!/^\+?[0-9]{7,15}$/.test(phone)) throw new ValidationError("Invalid phone number (expect E.164 or digits)");
      return { type, original, value: phone.startsWith("+") ? phone : `+${phone}` };
    }
    case "USERNAME": {
      if (!USERNAME_RE.test(original)) {
        throw new ValidationError("Invalid username (3-32 chars, letters/digits/._- only)");
      }
      return { type, original, value: original.toLowerCase() };
    }
    case "DOMAIN": {
      const stripped = original
        .replace(/^[a-z]+:\/\//i, "")
        .split(/[\/?#]/)[0]
        .replace(/\.$/, "")
        .toLowerCase();
      if (!DOMAIN_RE.test(stripped)) throw new ValidationError("Invalid domain name");
      const ascii = toAscii(stripped);
      return { type, original, value: ascii };
    }
    case "IP": {
      if (net.isIP(original) === 0) throw new ValidationError("Invalid IP address");
      return { type, original, value: canonicalIp(original) };
    }
    default:
      throw new ValidationError(`Unsupported input type: ${String(type)}`);
  }
}

function splitAtLastAt(email: string): [string, string] {
  const idx = email.lastIndexOf("@");
  return [email.slice(0, idx), email.slice(idx + 1)];
}

function canonicalIp(ip: string): string {
  if (net.isIPv6(ip)) {
    try {
      return normalizeIPv6(ip);
    } catch {
      return ip.toLowerCase();
    }
  }
  return ip;
}

/** Best-effort IPv6 normalization using Node's resolver parser output. */
function normalizeIPv6(ip: string): string {
  const groups = ip.toLowerCase().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, "::ffff:$1").split(":");
  if (groups.includes("")) {
    const idx = groups.indexOf("");
    const fill = 8 - groups.filter((g, i) => g !== "" || i === idx).length + 1;
    groups.splice(idx, 2, ...Array(fill).fill("0"));
  }
  return groups.map((g) => g.padStart(4, "0")).join(":");
}

function toAscii(domain: string): string {
  if (!/[\u0080-\uFFFF]/.test(domain)) return domain;
  try {
    return new URL(`http://${domain}`).hostname.replace(/\.$/, "");
  } catch {
    return domain;
  }
}

export function isDisposableDomain(domain: string): boolean {
  return DISPOSABLE_DOMAINS.has(domain.toLowerCase());
}

export function isRoleAccount(localPart: string): boolean {
  return ROLE_PATTERNS.test(localPart);
}

export function domainOfEmail(email: string): string {
  const [, domain] = splitAtLastAt(email);
  return domain;
}

/** Coarse email provider classification from domain hints (best-effort, public metadata only). */
export function classifyEmailProvider(domain: string): string {
  const d = domain.toLowerCase();
  if (d === "gmail.com" || d === "googlemail.com") return "Google / Gmail";
  if (d === "outlook.com" || d === "hotmail.com" || d === "live.com" || d === "msn.com") return "Microsoft Outlook";
  if (d === "yahoo.com" || d === "yahoo.co.uk" || d.endsWith(".yahoo.com")) return "Yahoo";
  if (d === "proton.me" || d === "protonmail.com" || d === "protonmail.ch") return "Proton Mail";
  if (d === "icloud.com" || d === "me.com" || d === "mac.com") return "Apple iCloud";
  if (d === "aol.com") return "AOL";
  if (d === "zoho.com" || d.endsWith(".zoho.eu")) return "Zoho";
  if (d === "fastmail.com" || d.endsWith(".fastmail.com")) return "Fastmail";
  if (d === "hey.com") return "HEY";
  return "Custom / Business domain";
}
