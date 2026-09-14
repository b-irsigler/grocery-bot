import { convertClovesToPieces, type Unit } from "../units";
import type { RecipeIngredient } from "../db/repo";

export interface NeedLine {
  ingredientId: string;
  quantity: number;
  unit: Unit;
}

export interface IngredientNeed {
  ingredientId: string;
  quantity: number;
  unit: Unit;
}

export interface AlternativeGroup {
  key: string;
  recipeId: string;
  variants: RecipeIngredient[];
}

export function aggregateIngredients(ingredients: IngredientNeed[]): NeedLine[] {
  const totals = new Map<string, NeedLine>();
  for (const ingredient of ingredients) {
    const converted = convertClovesToPieces(ingredient.quantity, ingredient.unit);
    const key = `${ingredient.ingredientId}\u0000${converted.unit}`;
    const existing = totals.get(key);
    if (existing) {
      existing.quantity += converted.quantity;
    } else {
      totals.set(key, {
        ingredientId: ingredient.ingredientId,
        quantity: converted.quantity,
        unit: converted.unit,
      });
    }
  }
  return [...totals.values()].sort((a, b) => {
    const byIngredient = a.ingredientId.localeCompare(b.ingredientId);
    return byIngredient !== 0 ? byIngredient : a.unit.localeCompare(b.unit);
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
