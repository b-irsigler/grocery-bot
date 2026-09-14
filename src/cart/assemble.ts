import type { LlmClient } from "../llm/types";
import type { GroceryClient, ProductCandidate } from "../grocery/types";
import { aggregateIngredients, groupAlternatives } from "../mapping/aggregate";
import { filterCandidates, pickBestMatch } from "../mapping/match";
import { roundUpToPackages } from "../mapping/quantity";
import { slugify } from "../util/slug";
import type { Unit } from "../units";
import type { BaseItem, DontBuyItem, RecipeIngredient, RecipeWithIngredients } from "../db/repo";

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

interface ChosenNeed {
  ingredientId: string;
  quantity: number;
  unit: Unit;
  source: "recipe" | "base";
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

  const chosen: ChosenNeed[] = [
    ...mandatory.map((ingredient) => ({
      ingredientId: ingredient.ingredientId,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      source: "recipe" as const,
    })),
    ...baseItems.map((item) => ({
      ingredientId: slugify(item.name),
      quantity: item.quantity,
      unit: item.unit,
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
    let winner: {
      ingredient: RecipeIngredient;
      product: ProductCandidate;
      isGuess: boolean;
      total: number;
    } | null = null;
    for (const variant of group.variants) {
      const candidates = await allowedCandidates(variant.ingredientId);
      if (candidates.length === 0) continue;
      const match = await pickBestMatch(llm, variant.ingredientId, candidates);
      if (!match) continue;
      const amount = roundUpToPackages(
        { quantity: variant.quantity, unit: variant.unit },
        match.product,
      );
      const total = match.product.price * amount;
      if (!winner || total < winner.total) {
        winner = { ingredient: variant, product: match.product, isGuess: match.isGuess, total };
      }
    }
    if (!winner) {
      const first = group.variants[0];
      if (first) {
        recordBlock(first.ingredientId, await rawCandidates(first.ingredientId));
      }
      continue;
    }
    chosen.push({
      ingredientId: winner.ingredient.ingredientId,
      quantity: winner.ingredient.quantity,
      unit: winner.ingredient.unit,
      source: "recipe",
    });
    productCache.set(winner.ingredient.ingredientId, {
      product: winner.product,
      isGuess: winner.isGuess,
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
      entry = await pickBestMatch(llm, need.ingredientId, candidates);
      if (!entry) {
        recordBlock(need.ingredientId, await rawCandidates(need.ingredientId));
        continue;
      }
    }
    const amount = roundUpToPackages(need, entry.product);
    const source = chosen.find((item) => item.ingredientId === need.ingredientId)?.source ?? "recipe";
    lines.push({
      ingredientId: need.ingredientId,
      product: entry.product,
      amount,
      source,
      isGuess: entry.isGuess,
    });
    await grocery.addToCart(entry.product.productId, amount);
  }

  return { lines, blocked };
}
