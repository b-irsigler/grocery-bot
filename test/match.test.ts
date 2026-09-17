import { describe, expect, it } from "vitest";
import {
  bestByPrice,
  chooseProduct,
  filterCandidates,
  isBlocked,
  resolvePackagesWithLlm,
} from "../src/mapping/match";
import type { ProductCandidate } from "../src/grocery/types";
import type { DontBuyItem } from "../src/db/repo";
import type { LlmClient } from "../src/llm/types";

function product(overrides: Partial<ProductCandidate>): ProductCandidate {
  return {
    productId: "p",
    name: "Produkt",
    price: 1,
    unitAmount: null,
    unitAmountUnit: null,
    onDeal: false,
    ...overrides,
  };
}

const llmReturning = (text: string): LlmClient => ({ complete: async () => text });

describe("dont-buy filtering", () => {
  it("blocks by product id and by exact name", () => {
    const dontBuy: DontBuyItem[] = [
      { id: 1, productId: "p1", name: "Egal" },
      { id: 2, productId: null, name: "Billig-Cola" },
    ];
    expect(isBlocked(product({ productId: "p1" }), dontBuy)).toBe(true);
    expect(isBlocked(product({ productId: "p9", name: "billig-cola" }), dontBuy)).toBe(true);
    expect(isBlocked(product({ productId: "p9", name: "Wasser" }), dontBuy)).toBe(false);
    expect(filterCandidates([product({ productId: "p1" }), product({ productId: "p2" })], dontBuy)).toHaveLength(1);
  });
});

describe("bestByPrice", () => {
  it("prefers deals, then the cheapest price", () => {
    const cheap = product({ productId: "cheap", price: 1 });
    const deal = product({ productId: "deal", price: 2, onDeal: true });
    expect(bestByPrice([cheap, deal])?.productId).toBe("deal");
    expect(bestByPrice([cheap, product({ productId: "expensive", price: 3 })])?.productId).toBe("cheap");
    expect(bestByPrice([])).toBeNull();
  });
});

describe("chooseProduct", () => {
  it("returns the single candidate without asking the LLM", async () => {
    const only = product({ productId: "only", unitAmount: 500, unitAmountUnit: "gram" });
    const choice = await chooseProduct(
      llmReturning("{}"),
      { ingredientId: "reis", amount: { kind: "measured", value: 500, measure: "gram" }, amountText: "500 g" },
      [only],
    );
    expect(choice?.product.productId).toBe("only");
    expect(choice?.packs).toBe(1);
    expect(choice?.isGuess).toBe(false);
  });

  it("picks the cheapest total among LLM-approved candidates", async () => {
    const a = product({ productId: "a", price: 1, unitAmount: 500, unitAmountUnit: "gram" });
    const b = product({ productId: "b", price: 1.5, unitAmount: 1000, unitAmountUnit: "gram" });
    const llm = llmReturning('{"matches":[{"productId":"a","isGuess":false},{"productId":"b","isGuess":false}]}');
    const choice = await chooseProduct(
      llm,
      { ingredientId: "reis", amount: { kind: "measured", value: 700, measure: "gram" }, amountText: "700 g" },
      [a, b],
    );
    expect(choice?.product.productId).toBe("b");
    expect(choice?.packs).toBe(1);
    expect(choice?.total).toBeCloseTo(1.5);
  });

  it("falls back to the cheapest candidate when the LLM returns nothing", async () => {
    const a = product({ productId: "a", price: 2 });
    const b = product({ productId: "b", price: 1 });
    const choice = await chooseProduct(
      llmReturning('{"matches":[]}'),
      { ingredientId: "reis", amount: { kind: "unquantified" }, amountText: "etwas" },
      [a, b],
    );
    expect(choice?.product.productId).toBe("b");
    expect(choice?.isGuess).toBe(true);
  });
});

describe("resolvePackagesWithLlm", () => {
  it("uses the LLM estimate", async () => {
    const llm = llmReturning('{"packs": 3}');
    expect(
      await resolvePackagesWithLlm(
        llm,
        { ingredientId: "x", amount: { kind: "measured", value: 300, measure: "gram" }, amountText: "300 g" },
        product({}),
      ),
    ).toBe(3);
  });

  it("defaults to one pack on an invalid response", async () => {
    const llm = llmReturning("not json");
    expect(
      await resolvePackagesWithLlm(
        llm,
        { ingredientId: "x", amount: { kind: "unquantified" }, amountText: "etwas" },
        product({}),
      ),
    ).toBe(1);
  });
});
