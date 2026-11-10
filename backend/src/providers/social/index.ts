import type { Env } from "../../config/env";
import { httpRequest } from "../../lib/httpClient";
import { providerLimiter } from "../../lib/rateLimiter";
import { providerContext } from "../../lib/providerMode";
import { ok, type OSINTProvider, type ProviderResult, type InvestigationInput } from "../types";
import { mockProviderResult } from "../mock/generators";

interface GitHubUser {
  login?: string;
  html_url?: string;
  public_repos?: number;
  public_gists?: number;
  followers?: number;
  following?: number;
  type?: string;
  created_at?: string;
}

/**
 * Username presence checker. Only official, public, keyless APIs are queried
 * (GitHub, Keybase). No scraping, no CAPTCHA bypass, no auth bypass.
 * Only minimal public profile metadata is retained.
 */
export const socialProvider: OSINTProvider = {
  name: "social",
  category: "social",
  supports: ["USERNAME"],
  enabled: () => true,

  describe() {
    return {
      name: "Username Lookup",
      category: "social",
      mode: (providerContext(process.env as unknown as Env, undefined).live ? "live" : "mock") as "live" | "mock",
      enabled: true,
      supports: ["USERNAME"],
      description: "Public username presence via official public APIs (GitHub, Keybase).",
    };
  },

  async investigate(input: InvestigationInput): Promise<ProviderResult> {
    const ctx = providerContext(process.env as unknown as Env, undefined);
    const started = Date.now();

    if (!ctx.live) {
      const m = mockProviderResult(input);
      return ok("social", "social", "Username Presence", m.data, m.confidence, {
        mode: "mock",
        latencyMs: Date.now() - started,
        sources: ["mock://username/social"],
      });
    }

    const username = encodeURIComponent(input.value);
    const matches: Record<string, unknown>[] = [];

    if (await providerLimiter.wait("social-github", 4000)) {
      try {
        const res = await httpRequest<GitHubUser>({
          url: `https://api.github.com/users/${username}`,
          headers: { Accept: "application/vnd.github+json", "User-Agent": "sentinel-osint/1.0" },
          allowedStatuses: [200, 404],
          maxRetries: 1,
        });
        if (res.status === 200 && res.data.login) {
          matches.push({
            platform: "GitHub",
            username: input.value,
            url: res.data.html_url,
            httpStatus: 200,
            confidence: 0.95,
            meta: {
              publicRepos: res.data.public_repos,
              followers: res.data.followers,
              createdAt: res.data.created_at,
              type: res.data.type,
            },
          });
        }
      } catch {
        /* keep going */
      }
    }

    if (await providerLimiter.wait("social-keybase", 4000)) {
      try {
        const res = await httpRequest<{ status?: { code?: number }; them?: { basics?: { username?: string }; profile?: { full_name?: string } } }>({
          url: "https://keybase.io/_/api/1.0/user/lookup.json",
          params: { usernames: input.value },
          maxRetries: 1,
        });
        if (res.status === 200 && res.data.status?.code === 0 && res.data.them?.basics?.username) {
          matches.push({
            platform: "Keybase",
            username: input.value,
            url: `https://keybase.io/${input.value}`,
            httpStatus: 200,
            confidence: 0.9,
          });
        }
      } catch {
        /* keep going */
      }
    }

    if (matches.length === 0) {
      return ok("social", "social", "Username Presence", { username: input.value, matches: [], checked: 2 }, 0.5, {
        mode: "live",
        latencyMs: Date.now() - started,
        sources: ["https://api.github.com", "https://keybase.io"],
      });
    }

    return ok("social", "social", "Username Presence", { username: input.value, matches, checked: 2 }, 0.85, {
      mode: "live",
      latencyMs: Date.now() - started,
      sources: ["https://api.github.com", "https://keybase.io"],
    });
  },
};
