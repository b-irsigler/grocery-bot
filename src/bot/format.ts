import { describeAmount, type Amount } from "../amounts";
import type { CartResult } from "../cart/assemble";
import type { RecipeWithIngredients } from "../db/repo";

export interface IngredientLike {
  ingredientId: string;
  amount: Amount;
  amountText: string;
}

export function formatIngredients(ingredients: IngredientLike[]): string {
  return ingredients
    .map(
      (ingredient) =>
        `${ingredient.amountText} ${ingredient.ingredientId.replace(/-/g, " ")} (${describeAmount(
          ingredient.amount,
        )})`,
    )
    .join("\n");
}

export function formatRecipeList(recipes: RecipeWithIngredients[]): string {
  return recipes
    .map((recipe, index) => `${index + 1}. ${recipe.title} [${recipe.tags.join(", ")}]`)
    .join("\n");
}

export function formatCartResult(result: CartResult, shopName: string): string {
  const lines = result.lines
    .map(
      (line) =>
        `- ${line.amount} × ${line.product.name} – ${(line.product.price * line.amount).toFixed(2)} €${
          line.product.onDeal ? " (Angebot)" : ""
        }${line.isGuess ? " (Ersatzprodukt)" : ""}${
          line.source === "base" ? " [Grundsortiment]" : ""
        }`,
    )
    .join("\n");
  const blocked = result.blocked
    .map(
      (entry) =>
        `- ${entry.ingredientId.replace(/-/g, " ")} ${
          entry.reason === "dont_buy"
            ? "(steht auf der Nicht-kaufen-Liste)"
            : "(kein passendes Produkt gefunden)"
        }`,
    )
    .join("\n");
  const total = result.lines.reduce(
    (sum, line) => sum + line.product.price * line.amount,
    0,
  );
  const parts = [
    "🛒 Dein Warenkorb wurde zusammengestellt:",
    "",
    lines.length > 0 ? lines : "(leer)",
    "",
    `Gesamtsumme: ${total.toFixed(2)} €`,
  ];
  if (blocked.length > 0) {
    parts.push("", "⚠️ Nicht hinzugefügt:", blocked);
  }
  parts.push(
    "",
    `Bitte prüfe den Warenkorb im ${shopName}-Shop und schließe die Bestellung dort ab.`,
  );
  return parts.join("\n");
}
