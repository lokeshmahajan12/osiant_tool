import type { Env } from "../config/env";
import type { ProviderContext } from "../providers/types";

/**
 * A provider is "live" only when MOCK_MODE is disabled AND its API key exists.
 * Otherwise it falls back to deterministic mock data so the app keeps working.
 */
export function providerContext(env: Env, key: string | undefined): ProviderContext {
  return { env, live: !env.MOCK_MODE && Boolean(key?.trim()) };
}
