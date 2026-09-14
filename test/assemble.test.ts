import { describe, expect, it } from "vitest";
import { assembleCart } from "../src/cart/assemble";
import type { GroceryClient, ProductCandidate } from "../src/grocery/types";
import type { BaseItem, DontBuyItem, RecipeWithIngredients } from "../src/db/repo";
import type { LlmClient } from "../src/llm/types";

const product = (overrides: Partial<ProductCandidate>): ProductCandidate => ({
  productId: "p",
  name: "Produkt",
  price: 1,
  unitAmount: null,
  unitAmountUnit: null,
  onDeal: false,
  ...overrides,
});

const llmPickingFirst: LlmClient = {
  async complete(messages) {
    const last = messages[messages.length - 1]?.content ?? "";
    const match = last.match(/-\s+([^:\s]+):/);
    return JSON.stringify({ productId: match?.[1] ?? "" });
  },
};

function fakeGrocery(byKeyword: Record<string, ProductCandidate[]>): {
  client: GroceryClient;
  added: { productId: string; amount: number }[];
} {
  const added: { productId: string; amount: number }[] = [];
  const client: GroceryClient = {
    async searchProducts(keyword) {
      return byKeyword[keyword] ?? [];
    },
    async addToCart(productId, amount) {
      added.push({ productId, amount });
    },
    async close() {},
  };
  return { client, added };
}

const recipe: RecipeWithIngredients = {
  id: "r1",
  title: "Reis mit Zwiebeln",
  tags: ["test"],
  ingredients: [
    { id: "i1", recipeId: "r1", ingredientId: "zwiebel", quantity: 2, unit: "piece", altGroup: null },
    { id: "i2", recipeId: "r1", ingredientId: "reis", quantity: 300, unit: "gram", altGroup: null },
  ],
};

const baseItems: BaseItem[] = [
  { id: "b1", name: "Hafermilch", quantity: 2, unit: "package" },
];

describe("assembleCart", () => {
  it("maps, rounds and adds ingredients plus base items", async () => {
    const { client, added } = fakeGrocery({
      zwiebel: [product({ productId: "p-zwiebel", name: "Zwiebeln 500 g", price: 1.29, unitAmount: 500, unitAmountUnit: "gram" })],
      reis: [product({ productId: "p-reis", name: "Basmatireis 500 g", price: 2.49, unitAmount: 500, unitAmountUnit: "gram" })],
      hafermilch: [product({ productId: "p-milch", name: "Hafermilch 1 l", price: 1.99, unitAmount: 1000, unitAmountUnit: "ml" })],
    });

    const result = await assembleCart(llmPickingFirst, client, [recipe], baseItems, []);

    expect(result.blocked).toEqual([]);
    expect(result.lines.map((line) => [line.ingredientId, line.amount])).toEqual([
      ["hafermilch", 2],
      ["reis", 1],
      ["zwiebel", 2],
    ]);
    expect(result.lines.every((line) => line.isGuess === false)).toBe(true);
    expect(added).toEqual([
      { productId: "p-milch", amount: 2 },
      { productId: "p-reis", amount: 1 },
      { productId: "p-zwiebel", amount: 2 },
    ]);
  });

  it("reports dont-buy blocks and adds nothing for them", async () => {
    const dontBuy: DontBuyItem[] = [{ id: 1, productId: "p-reis", name: "Basmatireis 500 g" }];
    const { client, added } = fakeGrocery({
      zwiebel: [product({ productId: "p-zwiebel", name: "Zwiebeln 500 g", price: 1.29, unitAmount: 500, unitAmountUnit: "gram" })],
      reis: [product({ productId: "p-reis", name: "Basmatireis 500 g", price: 2.49, unitAmount: 500, unitAmountUnit: "gram" })],
      hafermilch: [product({ productId: "p-milch", name: "Hafermilch 1 l", price: 1.99, unitAmount: 1000, unitAmountUnit: "ml" })],
    });

    const result = await assembleCart(llmPickingFirst, client, [recipe], baseItems, dontBuy);

    expect(result.blocked).toContainEqual({ ingredientId: "reis", reason: "dont_buy" });
    expect(result.lines.some((line) => line.ingredientId === "reis")).toBe(false);
    expect(added.some((entry) => entry.productId === "p-reis")).toBe(false);
  });
});
