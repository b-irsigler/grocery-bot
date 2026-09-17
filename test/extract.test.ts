import { describe, expect, it } from "vitest";
import { extractBaseItems, extractRecipe } from "../src/planning/extract";
import type { LlmClient } from "../src/llm/types";

const llmReturning = (text: string): LlmClient => ({ complete: async () => text });

function ingredient(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    ingredientId: "x",
    amountText: "1",
    amountKind: "count",
    amountValue: 1,
    amountMeasure: null,
    amountItem: null,
    altGroup: null,
    ...overrides,
  };
}

describe("extractRecipe", () => {
  it("parses classified amounts from a fenced response", async () => {
    const llm = llmReturning(
      "```json\n" +
        JSON.stringify({
          title: "Pasta",
          tags: ["italienisch"],
          ingredients: [
            ingredient({ ingredientId: "nudeln", amountText: "500 g", amountKind: "measured", amountValue: 500, amountMeasure: "gram" }),
            ingredient({ ingredientId: "olivenoel", amountText: "2 EL", amountKind: "measured", amountValue: 30, amountMeasure: "ml" }),
            ingredient({ ingredientId: "knoblauch", amountText: "3 Zehen", amountKind: "count", amountValue: 3, amountItem: "Knoblauchzehen" }),
            ingredient({ ingredientId: "butter", amountText: "eine halbe Packung", amountKind: "container", amountValue: 0.5 }),
            ingredient({ ingredientId: "salz", amountText: "1 Prise", amountKind: "unquantified", amountValue: null }),
          ],
        }) +
        "\n```",
    );
    const recipe = await extractRecipe(llm, "Pasta");
    expect(recipe.ingredients.map((entry) => entry.amount)).toEqual([
      { kind: "measured", value: 500, measure: "gram" },
      { kind: "measured", value: 30, measure: "ml" },
      { kind: "count", value: 3, item: "zehe" },
      { kind: "container", value: 0.5 },
      { kind: "unquantified" },
    ]);
    expect(recipe.ingredients.map((entry) => entry.amountText)).toContain("eine halbe Packung");
  });

  it("repairs inconsistent amount fields to unquantified", async () => {
    const llm = llmReturning(
      JSON.stringify({
        title: "Suppe",
        tags: [],
        ingredients: [
          ingredient({ ingredientId: "wasser", amountText: "etwas", amountKind: "measured", amountValue: null, amountMeasure: "ml" }),
        ],
      }),
    );
    const recipe = await extractRecipe(llm, "Suppe");
    expect(recipe.ingredients[0]?.amount).toEqual({ kind: "unquantified" });
  });

  it("treats an empty altGroup as null", async () => {
    const llm = llmReturning(
      JSON.stringify({
        title: "Salat",
        tags: [],
        ingredients: [
          ingredient({ ingredientId: "garnelen", amountText: "300 g", amountKind: "measured", amountValue: 300, amountMeasure: "gram", altGroup: "" }),
        ],
      }),
    );
    const recipe = await extractRecipe(llm, "Salat");
    expect(recipe.ingredients[0]?.altGroup).toBeNull();
  });

  it("sends a structured-output schema without $refs", async () => {
    let format: unknown;
    const llm: LlmClient = {
      async complete(_messages, options) {
        format = options?.responseFormat;
        return JSON.stringify({
          title: "X",
          tags: [],
          ingredients: [ingredient({ ingredientId: "x" })],
        });
      },
    };
    await extractRecipe(llm, "X");
    expect(JSON.stringify(format)).not.toContain("$ref");
  });
});

describe("extractBaseItems", () => {
  it("parses base items with amounts", async () => {
    const llm = llmReturning(
      JSON.stringify({
        items: [
          { name: "Milch", amountText: "1 Liter", amountKind: "measured", amountValue: 1000, amountMeasure: "ml", amountItem: null },
          { name: "Eier", amountText: "10 Stück", amountKind: "count", amountValue: 10, amountMeasure: null, amountItem: "Stück" },
        ],
      }),
    );
    const base = await extractBaseItems(llm, "Milch und Eier");
    expect(base.items.map((item) => item.amount)).toEqual([
      { kind: "measured", value: 1000, measure: "ml" },
      { kind: "count", value: 10, item: "stueck" },
    ]);
  });
});
