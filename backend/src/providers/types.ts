import type { InputType } from "@prisma/client";
import type { Env } from "../config/env";

export type ProviderCategory =
  | "identity"
  | "breach"
  | "dns"
  | "infrastructure"
  | "reputation"
  | "security"
  | "social";

export type ProviderStatus =
  | "SUCCESS"
  | "ERROR"
  | "RATE_LIMITED"
  | "DISABLED"
  | "SKIPPED"
  | "TIMEOUT"
  | "MOCK";

export interface InvestigationInput {
  type: InputType;
  value: string;
  related?: string;
}

export interface ProviderResult {
  provider: string;
  category: ProviderCategory;
  status: ProviderStatus;
  dataType: string;
  confidence: number;
  timestamp: string;
  data: Record<string, unknown> | null;
  error?: string;
  latencyMs?: number;
  sources?: string[];
  mode: "live" | "mock";
}

export interface ProviderDescriptor {
  name: string;
  category: ProviderCategory;
  mode: "live" | "mock";
  enabled: boolean;
  supports: InputType[];
  requiresKey?: string;
  description: string;
}

export interface OSINTProvider {
  name: string;
  category: ProviderCategory;
  supports: InputType[];
  enabled(env: Env): boolean;
  describe(): ProviderDescriptor;
  investigate(input: InvestigationInput): Promise<ProviderResult>;
}

export interface ProviderContext {
  env: Env;
  /** Whether the provider should use its real upstream API. */
  live: boolean;
}

export function ok(
  provider: string,
  category: ProviderCategory,
  dataType: string,
  data: Record<string, unknown>,
  confidence: number,
  opts: { mode: "live" | "mock"; latencyMs?: number; sources?: string[] }
): ProviderResult {
  return {
    provider,
    category,
    status: "SUCCESS",
    dataType,
    confidence,
    timestamp: new Date().toISOString(),
    data,
    latencyMs: opts.latencyMs,
    sources: opts.sources,
    mode: opts.mode,
  };
}

export function fail(
  provider: string,
  category: ProviderCategory,
  dataType: string,
  error: unknown,
  opts: { mode?: "live" | "mock"; latencyMs?: number } = {}
): ProviderResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    provider,
    category,
    status: isRateLimited(error) ? "RATE_LIMITED" : "ERROR",
    dataType,
    confidence: 0,
    timestamp: new Date().toISOString(),
    data: null,
    error: message,
    latencyMs: opts.latencyMs,
    mode: opts.mode ?? "live",
  };
}

function isRateLimited(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "HttpError" || error.message.includes("429")) &&
    error.message.includes("429")
  );
}

export function isMock(ctx: ProviderContext): boolean {
  return !ctx.live;
}
