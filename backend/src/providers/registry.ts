import type { InputType } from "@prisma/client";
import type { Env } from "../config/env";
import { prisma } from "../lib/prisma";
import type { OSINTProvider, ProviderResult, ProviderDescriptor } from "./types";
import { dnsProvider } from "./dns";
import { rdapProvider } from "./rdap";
import { httpProbeProvider } from "./http";
import { hibpProvider } from "./hibp";
import { hunterProvider } from "./hunter";
import { abstractProvider } from "./abstract";
import { abuseipdbProvider } from "./abuseipdb";
import { ipinfoProvider } from "./ipinfo";
import { virustotalProvider } from "./virustotal";
import { shodanProvider } from "./shodan";
import { socialProvider } from "./social";

export const allProviders: OSINTProvider[] = [
  dnsProvider,
  rdapProvider,
  httpProbeProvider,
  hibpProvider,
  hunterProvider,
  abstractProvider,
  abuseipdbProvider,
  ipinfoProvider,
  virustotalProvider,
  shodanProvider,
  socialProvider,
];

const byName = new Map(allProviders.map((p) => [p.name, p]));
// Display labels (e.g. "RDAP / WHOIS") are sent in URLs by the dashboard; accept
// them as aliases so toggling/testing works for every provider.
const byLabel = new Map(allProviders.map((p) => [p.describe().name, p]));

export function resolveProvider(name: string): OSINTProvider | undefined {
  return byName.get(name) ?? byLabel.get(name);
}

/**
 * Load the persisted enable/disable flags (ProviderState) for all providers.
 * Providers default to enabled when no state row exists.
 */
export async function providerStates(): Promise<Record<string, boolean>> {
  const rows = await prisma.providerState.findMany();
  const states: Record<string, boolean> = {};
  for (const p of allProviders) states[p.name] = p.enabled(process.env as unknown as Env);
  for (const row of rows) states[row.name] = row.enabled;
  return states;
}

export async function setProviderEnabled(name: string, enabled: boolean): Promise<void> {
  const provider = resolveProvider(name);
  if (!provider) throw new Error(`Unknown provider: ${name}`);
  await prisma.providerState.upsert({
    where: { name: provider.name },
    update: { enabled },
    create: { name: provider.name, enabled },
  });
}

export async function getEnabledProviders(): Promise<OSINTProvider[]> {
  const states = await providerStates();
  return allProviders.filter((p) => states[p.name]);
}

export async function getProvidersForType(type: InputType): Promise<OSINTProvider[]> {
  const enabled = await getEnabledProviders();
  return enabled.filter((p) => p.supports.includes(type));
}

export async function describeProviders(): Promise<ProviderDescriptor[]> {
  const states = await providerStates();
  return allProviders.map((p) => ({ ...p.describe(), enabled: states[p.name] }));
}

export function findProvider(name: string): OSINTProvider | undefined {
  return resolveProvider(name);
}

export function emptyFailureResult(provider: string, category: OSINTProvider["category"], message: string): ProviderResult {
  return {
    provider,
    category,
    status: "ERROR",
    dataType: "unknown",
    confidence: 0,
    timestamp: new Date().toISOString(),
    data: null,
    error: message,
    mode: "live",
  };
}
