import type { RecipeWithIngredients } from "../db/repo";

export type Pending =
  | {
      kind: "start";
      step: "confirm" | "feedback";
      mealCount: number;
      recipes: RecipeWithIngredients[];
    }
  | { kind: "add_recipe"; step: "describe" }
  | { kind: "edit_recipe"; step: "describe"; recipeId: string }
  | { kind: "edit_base"; step: "describe" }
  | { kind: "add_dont_buy"; step: "describe" }
  | { kind: "confirm_change"; summary: string; apply: () => void | Promise<void> };

const pending = new Map<string, Pending>();

export function setPending(chatId: number | string, value: Pending): void {
  pending.set(String(chatId), value);
}

export function getPending(chatId: number | string): Pending | undefined {
  return pending.get(String(chatId));
}

export function clearPending(chatId: number | string): void {
  pending.delete(String(chatId));
}
