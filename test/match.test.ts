import { describe, expect, it } from "vitest";
import { bestByPrice, filterCandidates, isBlocked, pickBestMatch } from "../src/mapping/match";
import type { ProductCandidate } from "../src/knuspr/client";
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
      { id: 1, knusprProductId: "p1", name: "Egal" },
      { id: 2, knusprProductId: null, name: "Billig-Cola" },
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

describe("pickBestMatch", () => {
  it("returns the single candidate without asking the LLM", async () => {
    const only = product({ productId: "only" });
    const result = await pickBestMatch(llmReturning("{}"), "reis", [only]);
    expect(result?.product.productId).toBe("only");
    expect(result?.isGuess).toBe(false);
  });

  it("uses a valid LLM pick", async () => {
    const llm = llmReturning('{"productId": "b"}');
    const candidates = [product({ productId: "a", price: 1 }), product({ productId: "b", price: 2 })];
    const result = await pickBestMatch(llm, "reis", candidates);
    expect(result?.product.productId).toBe("b");
    expect(result?.isGuess).toBe(false);
  });

  it("falls back to the cheapest candidate on an invalid LLM pick", async () => {
    const llm = llmReturning('{"productId": "does-not-exist"}');
    const candidates = [product({ productId: "a", price: 1 }), product({ productId: "b", price: 2 })];
    const result = await pickBestMatch(llm, "reis", candidates);
    expect(result?.product.productId).toBe("a");
    expect(result?.isGuess).toBe(true);
  });
});
