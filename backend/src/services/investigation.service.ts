import type { InputType, Investigation } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { validateAndNormalize, ValidationError } from "../utils/input";
import { getProvidersForType, emptyFailureResult } from "../providers";
import { aggregateConfidence } from "../utils/confidence";
import { buildSummary, type InvestigationSummary } from "../lib/summary";
import type { ProviderResult } from "../providers/types";

export interface CreateInvestigationResult {
  id: string;
  status: string;
}

/**
 * Create + run an investigation:
 *  1. validate/normalize input
 *  2. persist a RUNNING row with retention expiry
 *  3. run all enabled providers for the input type (fault-tolerant)
 *  4. compute confidence + exposure summary, persist result
 */
export async function createAndRunInvestigation(
  userId: string,
  inputType: InputType,
  rawInput: string
): Promise<CreateInvestigationResult> {
  const normalized = validateAndNormalize(inputType, rawInput);

  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  const retentionDays = settings?.retentionDays ?? 90;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + retentionDays * 86_400_000);

  const row = await prisma.investigation.create({
    data: {
      userId,
      inputType: normalized.type,
      input: normalized.original,
      normalized: normalized.value,
      status: "RUNNING",
      expiresAt,
    },
  });

  const providers = await getProvidersForType(normalized.type);
  const providerResults: ProviderResult[] = [];

  await Promise.allSettled(
    providers.map(async (p) => {
      try {
        const result = await p.investigate({
          type: normalized.type,
          value: normalized.value,
          related: normalized.related,
        });
        providerResults.push(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        providerResults.push(emptyFailureResult(p.name, p.category, message));
      }
    })
  );

  const successes = providerResults.filter((r) => r.status === "SUCCESS" && r.data);
  const confidence = aggregateConfidence(successes.map((r) => ({ confidence: r.confidence, ok: true })));
  const summary = buildSummary(normalized.type, providerResults);

  const status =
    successes.length === 0
      ? "FAILED"
      : providerResults.length === successes.length
        ? "COMPLETED"
        : "PARTIAL";

  await prisma.investigation.update({
    where: { id: row.id },
    data: {
      status,
      confidence,
      summary: summary as unknown as object,
      results: providerResults as unknown as object,
      completedAt: new Date(),
    },
  });

  return { id: row.id, status };
}

export async function getInvestigationById(id: string, userId?: string, isAdmin = false): Promise<Investigation | null> {
  return prisma.investigation.findFirst({
    where: isAdmin ? { id } : { id, userId },
  });
}

export async function listInvestigations(opts: {
  userId?: string;
  isAdmin?: boolean;
  inputType?: InputType;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: Investigation[]; total: number }> {
  const where = {
    ...(opts.isAdmin && !opts.userId ? {} : { userId: opts.userId }),
    ...(opts.inputType ? { inputType: opts.inputType } : {}),
    ...(opts.status ? { status: opts.status as Investigation["status"] } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.investigation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 50,
      skip: opts.offset ?? 0,
    }),
    prisma.investigation.count({ where }),
  ]);

  return { items, total };
}

export async function deleteInvestigation(id: string, userId?: string, isAdmin = false): Promise<boolean> {
  const existing = await getInvestigationById(id, userId, isAdmin);
  if (!existing) return false;
  await prisma.investigation.delete({ where: { id } });
  return true;
}

export async function deleteAllInvestigations(userId: string): Promise<number> {
  const deleted = await prisma.investigation.deleteMany({ where: { userId } });
  return deleted.count;
}

export async function purgeExpiredInvestigations(): Promise<number> {
  const deleted = await prisma.investigation.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return deleted.count;
}

export type { InvestigationSummary, ProviderResult };
export { ValidationError };
