import { describe, expect, it } from "vitest";
import { extractBaseItems, extractRecipe } from "../src/planning/extract";
import type { LlmClient } from "../src/llm/types";

const llmReturning = (text: string): LlmClient => ({ complete: async () => text });

describe("extractRecipe", () => {
  it("normalizes German units from a fenced response", async () => {
    const llm = llmReturning(
      "```json\n" +
        JSON.stringify({
          title: "Pasta",
          tags: ["italienisch"],
          ingredients: [
            { ingredientId: "nudeln", quantity: 500, unit: "gramm", altGroup: null },
            { ingredientId: "olivenoel", quantity: 2, unit: "EL", altGroup: "" },
            { ingredientId: "knoblauch", quantity: 3, unit: "Zehen", altGroup: "null" },
            { ingredientId: "tomaten", quantity: 1, unit: "Packung", altGroup: null },
          ],
        }) +
        "\n```",
    );
    const recipe = await extractRecipe(llm, "Pasta");
    expect(recipe.ingredients.map((item) => item.unit)).toEqual([
      "gram",
      "ml",
      "clove",
      "package",
    ]);
    expect(recipe.ingredients.map((item) => item.altGroup)).toEqual([null, null, null, null]);
  });

  it("coerces string quantities", async () => {
    const llm = llmReturning(
      JSON.stringify({
        title: "Suppe",
        tags: [],
        ingredients: [{ ingredientId: "wasser", quantity: "1,5", unit: "l", altGroup: null }],
      }),
    );
    const recipe = await extractRecipe(llm, "Suppe");
    expect(recipe.ingredients[0]).toEqual({
      ingredientId: "wasser",
      quantity: 1.5,
      unit: "ml",
      altGroup: null,
    });
  });

  it("throws on an unrecognized unit", async () => {
    const llm = llmReturning(
      JSON.stringify({
        title: "Salat",
        tags: [],
        ingredients: [{ ingredientId: "salz", quantity: 1, unit: "handvoll", altGroup: null }],
      }),
    );
    await expect(extractRecipe(llm, "Salat")).rejects.toThrow(/JSON/);
  });
});

describe("extractBaseItems", () => {
  it("normalizes German units", async () => {
    const llm = llmReturning(
      JSON.stringify({
        items: [
          { name: "Milch", quantity: 1, unit: "Liter" },
          { name: "Eier", quantity: 10, unit: "Stück" },
        ],
      }),
    );
    const base = await extractBaseItems(llm, "Milch und Eier");
    expect(base.items.map((item) => item.unit)).toEqual(["ml", "piece"]);
  });
});
