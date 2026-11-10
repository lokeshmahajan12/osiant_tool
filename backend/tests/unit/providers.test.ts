import { describe, expect, it } from "vitest";
import { allProviders } from "../../src/providers";
import type { InvestigationInput, ProviderResult } from "../../src/providers/types";

process.env.MOCK_MODE = "true";

const SAMPLE_INPUTS: Record<string, InvestigationInput> = {
  EMAIL: { type: "EMAIL", value: "analyst@example.com", related: "example.com" },
  PHONE: { type: "PHONE", value: "+14155552671" },
  USERNAME: { type: "USERNAME", value: "alice_analyst" },
  DOMAIN: { type: "DOMAIN", value: "example.com" },
  IP: { type: "IP", value: "8.8.8.8" },
};

describe("provider registry", () => {
  it("all providers support at least one input type and are enabled", () => {
    for (const p of allProviders) {
      expect(p.supports.length).toBeGreaterThan(0);
      expect(p.enabled(process.env as never)).toBe(true);
    }
  });

  it("every provider returns a well-formed ProviderResult (mock mode)", async () => {
    for (const p of allProviders) {
      const input = SAMPLE_INPUTS[p.supports[0]];
      const result: ProviderResult = await p.investigate(input);
      expect(result.provider).toBe(p.name);
      expect(result.category).toBe(p.category);
      expect(["SUCCESS", "ERROR", "RATE_LIMITED"]).toContain(result.status);
      expect(result.timestamp).toBeTruthy();
      expect(typeof result.confidence).toBe("number");
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      // Keyless providers (dns/rdap/http) always run live; keyed providers run in mock mode without keys.
      const alwaysLive = ["dns", "rdap", "http"];
      expect(result.mode).toBe(alwaysLive.includes(p.name) ? "live" : "mock");
      if (result.status === "SUCCESS") {
        expect(result.data).toBeTruthy();
      } else {
        expect(result.error).toBeTruthy();
      }
    }
  });

  it("supports filter returns providers for each input type", () => {
    const support = (type: string) => allProviders.filter((p) => p.supports.includes(type as never));
    expect(support("EMAIL").map((p) => p.name)).toEqual(expect.arrayContaining(["hibp", "dns", "hunter", "abstract"]));
    expect(support("IP").map((p) => p.name)).toEqual(expect.arrayContaining(["abuseipdb", "ipinfo", "shodan"]));
    expect(support("DOMAIN").map((p) => p.name)).toEqual(expect.arrayContaining(["rdap", "http", "virustotal"]));
    expect(support("USERNAME").map((p) => p.name)).toEqual(["social"]);
  });
});
