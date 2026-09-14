import { describe, expect, it } from "vitest";
import { parsePackageAmount, roundUpToPackages } from "../src/mapping/quantity";

describe("parsePackageAmount", () => {
  it("parses grams", () => {
    expect(parsePackageAmount("Basmatireis 500 g")).toEqual({ amount: 500, unit: "gram" });
    expect(parsePackageAmount("Mehl 1kg")).toEqual({ amount: 1000, unit: "gram" });
    expect(parsePackageAmount("Kartoffeln 1,5 kg")).toEqual({ amount: 1500, unit: "gram" });
    expect(parsePackageAmount("Mehl 500 gr")).toEqual({ amount: 500, unit: "gram" });
  });

  it("parses volume", () => {
    expect(parsePackageAmount("Vollmilch 1,5 l")).toEqual({ amount: 1500, unit: "ml" });
    expect(parsePackageAmount("Saft 500ml")).toEqual({ amount: 500, unit: "ml" });
  });

  it("parses pieces", () => {
    expect(parsePackageAmount("Eier 6 Stk")).toEqual({ amount: 6, unit: "piece" });
  });

  it("parses multipacks", () => {
    expect(parsePackageAmount("Joghurt 4x125g")).toEqual({ amount: 500, unit: "gram" });
  });

  it("returns null when nothing is parseable", () => {
    expect(parsePackageAmount("Bananen")).toBeNull();
  });
});

describe("roundUpToPackages", () => {
  const product = (overrides: Partial<{ unitAmount: number | null; unitAmountUnit: "gram" | "ml" | "piece" | null }> = {}) => ({
    unitAmount: 500 as number | null,
    unitAmountUnit: "gram" as "gram" | "ml" | "piece" | null,
    ...overrides,
  });

  it("rounds weight up to package multiples", () => {
    expect(roundUpToPackages({ quantity: 700, unit: "gram" }, product())).toBe(2);
    expect(roundUpToPackages({ quantity: 500, unit: "gram" }, product())).toBe(1);
  });

  it("rounds countable needs up to whole items", () => {
    expect(
      roundUpToPackages({ quantity: 2.2, unit: "piece" }, product({ unitAmount: null, unitAmountUnit: null })),
    ).toBe(3);
  });

  it("falls back to one package when size is unknown", () => {
    expect(
      roundUpToPackages({ quantity: 300, unit: "gram" }, product({ unitAmount: null, unitAmountUnit: null })),
    ).toBe(300);
  });
});
