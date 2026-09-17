import { describe, expect, it } from "vitest";
import { aggregateIngredients, groupAlternatives, type NeedLine } from "../src/mapping/aggregate";
import type { Amount } from "../src/amounts";
import type { RecipeIngredient } from "../src/db/repo";

function need(
  ingredientId: string,
  amount: Amount,
  amountText = "x",
  source: "recipe" | "base" = "recipe",
): NeedLine {
  return { ingredientId, amount, amountText, source };
}

function ingredient(overrides: Partial<RecipeIngredient>): RecipeIngredient {
  return {
    id: "i",
    recipeId: "r1",
    ingredientId: "x",
    amount: { kind: "count", value: 1, item: null },
    amountText: "1",
    altGroup: null,
    ...overrides,
  };
}

describe("aggregateIngredients", () => {
  it("sums the same ingredient and amount kind", () => {
    expect(
      aggregateIngredients([
        need("zwiebel", { kind: "count", value: 1, item: "stueck" }, "1 Zwiebel"),
        need("zwiebel", { kind: "count", value: 2, item: "stueck" }, "2 Zwiebeln"),
        need("reis", { kind: "measured", value: 300, measure: "gram" }, "300 g"),
      ]),
    ).toEqual([
      {
        ingredientId: "reis",
        amount: { kind: "measured", value: 300, measure: "gram" },
        amountText: "300 g",
        source: "recipe",
      },
      {
        ingredientId: "zwiebel",
        amount: { kind: "count", value: 3, item: "stueck" },
        amountText: "1 Zwiebel, 2 Zwiebeln",
        source: "recipe",
      },
    ]);
  });

  it("keeps different kinds and items separate", () => {
    const lines = aggregateIngredients([
      need("knoblauch", { kind: "count", value: 3, item: "zehe" }, "3 Zehen"),
      need("knoblauch", { kind: "count", value: 1, item: "zehe" }, "1 Zehe"),
      need("knoblauch", { kind: "measured", value: 50, measure: "gram" }, "50 g"),
      need("knoblauch", { kind: "count", value: 1, item: "zehe" }, "1 Zehe", "base"),
    ]);
    expect(lines).toEqual([
      {
        ingredientId: "knoblauch",
        amount: { kind: "count", value: 5, item: "zehe" },
        amountText: "3 Zehen, 1 Zehe",
        source: "recipe",
      },
      {
        ingredientId: "knoblauch",
        amount: { kind: "measured", value: 50, measure: "gram" },
        amountText: "50 g",
        source: "recipe",
      },
    ]);
  });
});

describe("groupAlternatives", () => {
  it("separates mandatory ingredients from interchangeable groups", () => {
    const recipes = [
      {
        id: "r1",
        ingredients: [
          ingredient({ id: "i1", ingredientId: "garnelen", amount: { kind: "measured", value: 300, measure: "gram" }, altGroup: "protein" }),
          ingredient({ id: "i2", ingredientId: "haehnchen", amount: { kind: "measured", value: 400, measure: "gram" }, altGroup: "protein" }),
          ingredient({ id: "i3", ingredientId: "reis", amount: { kind: "measured", value: 200, measure: "gram" }, altGroup: null }),
        ],
      },
    ];
    const { mandatory, groups } = groupAlternatives(recipes);
    expect(mandatory.map((entry) => entry.ingredientId)).toEqual(["reis"]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.variants.map((entry) => entry.ingredientId)).toEqual(["garnelen", "haehnchen"]);
  });
});
