import type { LlmClient } from "../llm/types";
import type { GroceryClient, ProductCandidate } from "../grocery/types";
import { describeAmount } from "../amounts";
import { aggregateIngredients, groupAlternatives, type NeedLine } from "../mapping/aggregate";
import {
  chooseProduct,
  filterCandidates,
  resolvePackagesWithLlm,
  type IngredientNeed,
  type ProductChoice,
} from "../mapping/match";
import { resolvePackages } from "../mapping/quantity";
import { slugify } from "../util/slug";
import type {
  BaseItem,
  DontBuyItem,
  RecipeIngredient,
  RecipeWithIngredients,
} from "../db/repo";

export interface CartLine {
  ingredientId: string;
  product: ProductCandidate;
  amount: number;
  source: "recipe" | "base";
  isGuess: boolean;
}

export interface BlockedLine {
  ingredientId: string;
  reason: "dont_buy" | "no_match";
}

export interface CartResult {
  lines: CartLine[];
  blocked: BlockedLine[];
}

function needOf(ingredient: RecipeIngredient): NeedLine {
  return {
    ingredientId: ingredient.ingredientId,
    amount: ingredient.amount,
    amountText: ingredient.amountText,
    source: "recipe",
  };
}

export async function assembleCart(
  llm: LlmClient,
  grocery: GroceryClient,
  recipes: RecipeWithIngredients[],
  baseItems: BaseItem[],
  dontBuy: DontBuyItem[],
): Promise<CartResult> {
  const { mandatory, groups } = groupAlternatives(
    recipes.map((recipe) => ({ id: recipe.id, ingredients: recipe.ingredients })),
  );

  const chosen: NeedLine[] = [
    ...mandatory.map(needOf),
    ...baseItems.map((item) => ({
      ingredientId: slugify(item.name),
      amount: item.amount,
      amountText: describeAmount(item.amount),
      source: "base" as const,
    })),
  ];

  const blocked: BlockedLine[] = [];
  const rawCache = new Map<string, ProductCandidate[]>();
  const productCache = new Map<string, { product: ProductCandidate; isGuess: boolean }>();

  async function rawCandidates(ingredientId: string): Promise<ProductCandidate[]> {
    const cached = rawCache.get(ingredientId);
    if (cached) return cached;
    const keyword = ingredientId.replace(/-/g, " ");
    const fetched = await grocery.searchProducts(keyword, 10);
    rawCache.set(ingredientId, fetched);
    return fetched;
  }

  async function allowedCandidates(ingredientId: string): Promise<ProductCandidate[]> {
    return filterCandidates(await rawCandidates(ingredientId), dontBuy);
  }

  function recordBlock(ingredientId: string, raw: ProductCandidate[]): void {
    if (blocked.some((entry) => entry.ingredientId === ingredientId)) return;
    blocked.push({ ingredientId, reason: raw.length === 0 ? "no_match" : "dont_buy" });
  }

  for (const group of groups) {
    let winner: { need: NeedLine; choice: ProductChoice } | null = null;
    for (const variant of group.variants) {
      const candidates = await allowedCandidates(variant.ingredientId);
      if (candidates.length === 0) continue;
      const choice = await chooseProduct(llm, needOf(variant), candidates);
      if (!choice) continue;
      if (!winner || choice.total < winner.choice.total) {
        winner = { need: needOf(variant), choice };
      }
    }
    if (!winner) {
      const first = group.variants[0];
      if (first) {
        recordBlock(first.ingredientId, await rawCandidates(first.ingredientId));
      }
      continue;
    }
    chosen.push(winner.need);
    productCache.set(winner.need.ingredientId, {
      product: winner.choice.product,
      isGuess: winner.choice.isGuess,
    });
  }

  const needLines = aggregateIngredients(chosen);
  const lines: CartLine[] = [];

  for (const need of needLines) {
    let entry = productCache.get(need.ingredientId) ?? null;
    if (!entry) {
      const candidates = await allowedCandidates(need.ingredientId);
      if (candidates.length === 0) {
        recordBlock(need.ingredientId, await rawCandidates(need.ingredientId));
        continue;
      }
      const choice = await chooseProduct(llm, need, candidates);
      if (!choice) {
        recordBlock(need.ingredientId, await rawCandidates(need.ingredientId));
        continue;
      }
      entry = { product: choice.product, isGuess: choice.isGuess };
    }
    const resolution = resolvePackages(need.amount, entry.product);
    const amount = resolution.exact
      ? resolution.packs
      : await resolvePackagesWithLlm(llm, need, entry.product);
    lines.push({
      ingredientId: need.ingredientId,
      product: entry.product,
      amount,
      source: need.source,
      isGuess: entry.isGuess,
    });
    await grocery.addToCart(entry.product.productId, amount);
  }

  return { lines, blocked };
}
