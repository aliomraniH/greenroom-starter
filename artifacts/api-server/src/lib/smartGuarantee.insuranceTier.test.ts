import { describe, it, expect } from "vitest";
import { computeInsuranceTier } from "./smartGuarantee";

describe("computeInsuranceTier", () => {
  it("returns 4 for door deals regardless of tier", () => {
    expect(computeInsuranceTier("door", "A", 1000, 5000, 500)).toBe(4);
  });

  it("returns 4 for confidence tier D", () => {
    expect(computeInsuranceTier("vs", "D", 1000, 5000, 500)).toBe(4);
  });

  it("returns 3 when cushion < 500", () => {
    // cushion = 5000 * 0.9 - 500 - 4100 = -100
    expect(computeInsuranceTier("vs", "A", 4100, 5000, 500)).toBe(3);
  });

  it("returns 3 for confidence tier C even with good cushion", () => {
    // cushion = 5000 * 0.9 - 500 - 1000 = 3000
    expect(computeInsuranceTier("vs", "C", 1000, 5000, 500)).toBe(3);
  });

  it("returns 2 for tier A with cushion between 500 and 1500", () => {
    // cushion = 5000 * 0.9 - 500 - 3000 = 1000
    expect(computeInsuranceTier("vs", "A", 3000, 5000, 500)).toBe(2);
  });

  it("returns 2 for tier B with large cushion", () => {
    // cushion = 10000 * 0.9 - 500 - 1000 = 7500, but tier is B
    expect(computeInsuranceTier("vs", "B", 1000, 10000, 500)).toBe(2);
  });

  it("returns 1 for tier A with cushion >= 1500", () => {
    // cushion = 10000 * 0.9 - 500 - 1000 = 7500
    expect(computeInsuranceTier("vs", "A", 1000, 10000, 500)).toBe(1);
  });
});
