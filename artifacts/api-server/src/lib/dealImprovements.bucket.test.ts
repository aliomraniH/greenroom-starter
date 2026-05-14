import { describe, it, expect } from "vitest";
import { classifyAnalyticsSizeBucket } from "./queries";

describe("classifyAnalyticsSizeBucket — zero-guarantee vs deal", () => {
  it("routes a zero-guarantee vs deal to $0–1K, not Uncapped %", () => {
    const deal = {
      dealType: "vs" as const,
      guaranteeAmount: 0,
      percentage: 0.8,
      percentageOf: "gross" as const,
    };
    const bucket = classifyAnalyticsSizeBucket(deal as any);
    expect(bucket).toBe("$0–1K");
    expect(bucket).not.toBe("Uncapped %");
  });

  it("routes a null-guarantee vs deal to $0–1K, not Uncapped %", () => {
    const deal = {
      dealType: "vs" as const,
      guaranteeAmount: null,
      percentage: 0.8,
      percentageOf: "gross" as const,
    };
    const bucket = classifyAnalyticsSizeBucket(deal as any);
    expect(bucket).toBe("$0–1K");
    expect(bucket).not.toBe("Uncapped %");
  });

  it("routes a pure percentage_of_gross deal with no guarantee to Uncapped %", () => {
    const deal = {
      dealType: "percentage_of_gross" as const,
      guaranteeAmount: null,
      percentage: 0.85,
      percentageOf: "gross" as const,
    };
    const bucket = classifyAnalyticsSizeBucket(deal as any);
    expect(bucket).toBe("Uncapped %");
  });
});
