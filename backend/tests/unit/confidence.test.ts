import { describe, expect, it } from "vitest";
import { aggregateConfidence, confidenceLabel } from "../../src/utils/confidence";

describe("aggregateConfidence", () => {
  it("returns 0 when nothing succeeded", () => {
    expect(aggregateConfidence([{ confidence: 0.9, ok: false }])).toBe(0);
    expect(aggregateConfidence([])).toBe(0);
  });

  it("averages successful confidences and caps at 0.97", () => {
    expect(aggregateConfidence([{ confidence: 0.8, ok: true }, { confidence: 0.6, ok: true }])).toBeCloseTo(0.7);
    expect(aggregateConfidence([{ confidence: 0.99, ok: true }])).toBeLessThanOrEqual(0.97);
  });
});

describe("confidenceLabel", () => {
  it("maps scores to labels", () => {
    expect(confidenceLabel(0.8)).toBe("High");
    expect(confidenceLabel(0.5)).toBe("Medium");
    expect(confidenceLabel(0.2)).toBe("Low");
  });
});
