import { describe, expect, it } from "vitest";
import { buildAmount, amountKey, amountToColumns, amountFromColumns, describeAmount, normalizeItem } from "../src/amounts";

describe("buildAmount", () => {
  it("builds measured amounts", () => {
    expect(buildAmount("measured", 1000, "gram", null)).toEqual({
      kind: "measured",
      value: 1000,
      measure: "gram",
    });
  });

  it("builds counts with normalized items", () => {
    expect(buildAmount("count", 3, null, "Zehen")).toEqual({ kind: "count", value: 3, item: "zehe" });
  });

  it("builds containers, including fractions", () => {
    expect(buildAmount("container", 0.5, null, null)).toEqual({ kind: "container", value: 0.5 });
  });

  it("falls back to unquantified when inconsistent", () => {
    expect(buildAmount("measured", null, "gram", null)).toEqual({ kind: "unquantified" });
    expect(buildAmount("container", -1, null, null)).toEqual({ kind: "unquantified" });
    expect(buildAmount("nonsense", 1, null, null)).toEqual({ kind: "unquantified" });
  });
});

describe("normalizeItem", () => {
  it("merges synonyms and lowercases", () => {
    expect(normalizeItem("Knoblauchzehe")).toBe("zehe");
    expect(normalizeItem("Stück")).toBe("stueck");
    expect(normalizeItem("  Karotte ")).toBe("karotte");
    expect(normalizeItem(null)).toBeNull();
  });
});

describe("column round-trip", () => {
  it("maps amounts to columns and back", () => {
    const count = { kind: "count", value: 2, item: "zehe" } as const;
    const columns = amountToColumns(count);
    expect(columns).toEqual({ kind: "count", value: 2, measure: null, item: "zehe" });
    expect(amountFromColumns(columns.kind, columns.value, columns.measure, columns.item)).toEqual(count);
  });
});

describe("amountKey", () => {
  it("groups by kind, measure and item", () => {
    expect(amountKey({ kind: "measured", value: 1, measure: "gram" })).toBe("measured:gram");
    expect(amountKey({ kind: "count", value: 1, item: "zehe" })).toBe("count:zehe");
    expect(amountKey({ kind: "container", value: 1 })).toBe("container");
    expect(amountKey({ kind: "unquantified" })).toBe("unquantified");
  });
});

describe("describeAmount", () => {
  it("renders German text", () => {
    expect(describeAmount({ kind: "measured", value: 500, measure: "gram" })).toBe("500 g");
    expect(describeAmount({ kind: "measured", value: 250, measure: "ml" })).toBe("250 ml");
    expect(describeAmount({ kind: "container", value: 0.5 })).toBe("0,5 × Packung");
    expect(describeAmount({ kind: "count", value: 3, item: "zehe" })).toBe("3 zehe");
    expect(describeAmount({ kind: "unquantified" })).toBe("etwas");
  });
});
