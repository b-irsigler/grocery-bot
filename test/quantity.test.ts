import { describe, expect, it } from "vitest";
import { parsePackageAmount, resolvePackages } from "../src/mapping/quantity";
import type { Amount } from "../src/amounts";

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

describe("resolvePackages", () => {
  const product = (
    overrides: Partial<{ unitAmount: number | null; unitAmountUnit: "gram" | "ml" | "piece" | null }> = {},
  ) => ({
    unitAmount: 500 as number | null,
    unitAmountUnit: "gram" as "gram" | "ml" | "piece" | null,
    ...overrides,
  });
  const measured = (value: number, measure: "gram" | "ml"): Amount => ({
    kind: "measured",
    value,
    measure,
  });

  it("rounds measured needs up to package multiples", () => {
    expect(resolvePackages(measured(700, "gram"), product())).toEqual({ packs: 2, exact: true });
    expect(resolvePackages(measured(500, "gram"), product())).toEqual({ packs: 1, exact: true });
    expect(
      resolvePackages(measured(750, "ml"), product({ unitAmount: 500, unitAmountUnit: "ml" })),
    ).toEqual({ packs: 2, exact: true });
  });

  it("flags mismatched or unknown sizes as inexact", () => {
    expect(
      resolvePackages(measured(300, "gram"), product({ unitAmount: null, unitAmountUnit: null })),
    ).toEqual({ packs: 1, exact: false });
    expect(resolvePackages(measured(300, "ml"), product())).toEqual({ packs: 1, exact: false });
  });

  it("rounds counts, using piece size when known", () => {
    expect(
      resolvePackages({ kind: "count", value: 2, item: "ei" }, product({ unitAmount: null, unitAmountUnit: null })),
    ).toEqual({ packs: 2, exact: true });
    expect(
      resolvePackages({ kind: "count", value: 7, item: "ei" }, product({ unitAmount: 6, unitAmountUnit: "piece" })),
    ).toEqual({ packs: 2, exact: true });
  });

  it("rounds containers up to whole packs", () => {
    expect(resolvePackages({ kind: "container", value: 0.5 }, product())).toEqual({ packs: 1, exact: true });
    expect(resolvePackages({ kind: "container", value: 2 }, product())).toEqual({ packs: 2, exact: true });
  });

  it("uses one pack for unquantified needs", () => {
    expect(resolvePackages({ kind: "unquantified" }, product())).toEqual({ packs: 1, exact: true });
  });
});
