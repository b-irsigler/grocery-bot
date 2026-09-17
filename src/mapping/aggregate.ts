import { amountKey, type Amount } from "../amounts";
import type { RecipeIngredient } from "../db/repo";

export interface NeedLine {
  ingredientId: string;
  amount: Amount;
  amountText: string;
  source: "recipe" | "base";
}

export interface AlternativeGroup {
  key: string;
  recipeId: string;
  variants: RecipeIngredient[];
}

function addAmount(current: Amount, addition: Amount): Amount {
  if (current.kind === "measured" && addition.kind === "measured") {
    return { kind: "measured", value: current.value + addition.value, measure: current.measure };
  }
  if (current.kind === "count" && addition.kind === "count") {
    return { kind: "count", value: current.value + addition.value, item: current.item };
  }
  if (current.kind === "container" && addition.kind === "container") {
    return { kind: "container", value: current.value + addition.value };
  }
  return current;
}

export function aggregateIngredients(needs: NeedLine[]): NeedLine[] {
  const totals = new Map<string, NeedLine>();
  for (const need of needs) {
    const key = `${need.ingredientId}\u0000${amountKey(need.amount)}`;
    const existing = totals.get(key);
    if (existing) {
      existing.amount = addAmount(existing.amount, need.amount);
      if (need.source === "recipe") {
        existing.source = "recipe";
      }
      if (!existing.amountText.includes(need.amountText)) {
        existing.amountText = `${existing.amountText}, ${need.amountText}`;
      }
    } else {
      totals.set(key, {
        ingredientId: need.ingredientId,
        amount: need.amount,
        amountText: need.amountText,
        source: need.source,
      });
    }
  }
  return [...totals.values()].sort((a, b) => {
    const byIngredient = a.ingredientId.localeCompare(b.ingredientId);
    return byIngredient !== 0 ? byIngredient : amountKey(a.amount).localeCompare(amountKey(b.amount));
  });
}

export function groupAlternatives(
  recipes: { id: string; ingredients: RecipeIngredient[] }[],
): { mandatory: RecipeIngredient[]; groups: AlternativeGroup[] } {
  const mandatory: RecipeIngredient[] = [];
  const groups = new Map<string, AlternativeGroup>();
  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients) {
      if (ingredient.altGroup === null) {
        mandatory.push(ingredient);
        continue;
      }
      const key = `${recipe.id}\u0000${ingredient.altGroup}`;
      const group = groups.get(key);
      if (group) {
        group.variants.push(ingredient);
      } else {
        groups.set(key, { key, recipeId: recipe.id, variants: [ingredient] });
      }
    }
  }
  return { mandatory, groups: [...groups.values()] };
}
