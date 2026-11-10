import type { Request, Response } from "express";
import { z } from "zod";
import { describeProviders, setProviderEnabled, findProvider, providerStates } from "../providers";
import { providerLimiter } from "../lib/rateLimiter";
import { ApiError } from "../middleware/errorHandler";
import { recordAudit } from "../middleware/audit";
import type { ProviderResult } from "../providers/types";

const toggleSchema = z.object({ enabled: z.boolean() });

export async function handleList(_req: Request, res: Response): Promise<void> {
  const descriptors = await describeProviders();
  const states = await providerStates();
  res.json({
    providers: descriptors.map((d) => ({ ...d, quota: providerLimiter.usage(d.name) })),
    mockMode: states,
  });
}

export async function handleToggle(req: Request, res: Response): Promise<void> {
  const { enabled } = toggleSchema.parse(req.body);
  await setProviderEnabled(req.params.name, enabled);
  await recordAudit({ userId: req.user?.id, action: `provider.${enabled ? "enabled" : "disabled"}`, details: { provider: req.params.name }, req });
  res.json({ name: req.params.name, enabled });
}

export async function handleTest(req: Request, res: Response): Promise<void> {
  const provider = findProvider(req.params.name);
  if (!provider) throw new ApiError(404, "Unknown provider");
  const input = { type: provider.supports[0], value: "probe" };
  const result: ProviderResult = await provider.investigate({ type: input.type, value: input.value });
  res.json({ provider: provider.name, ok: result.status === "SUCCESS", result });
}
