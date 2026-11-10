/**
 * Aggregate confidence across provider results.
 * Confidence is a 0-1 score describing how reliable the collected metadata is
 * (source trust + data completeness). It says nothing about identity certainty.
 */
export function aggregateConfidence(
  scores: { confidence: number; ok: boolean }[]
): number {
  const ok = scores.filter((s) => s.ok);
  if (ok.length === 0) return 0;

  const weights = ok.map((s) => s.confidence);
  const total = weights.reduce((a, b) => a + b, 0);
  // Average weighted toward higher-quality sources, capped at 0.97.
  return Math.min(0.97, total / ok.length);
}

/** Human label from a 0-1 confidence score. */
export function confidenceLabel(score: number): "Low" | "Medium" | "High" {
  if (score >= 0.7) return "High";
  if (score >= 0.4) return "Medium";
  return "Low";
}
