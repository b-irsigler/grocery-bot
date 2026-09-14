import { describe, expect, it } from "vitest";
import { aggregateIngredients, groupAlternatives } from "../src/mapping/aggregate";
import type { RecipeIngredient } from "../src/db/repo";

function ingredient(overrides: Partial<RecipeIngredient>): RecipeIngredient {
  return {
    id: "i",
    recipeId: "r1",
    ingredientId: "x",
    quantity: 1,
    unit: "piece",
    altGroup: null,
    ...overrides,
  };
}

describe("aggregateIngredients", () => {
  it("aggregates across recipes", () => {
    expect(
      aggregateIngredients([
        { ingredientId: "zwiebel", quantity: 1, unit: "piece" },
        { ingredientId: "zwiebel", quantity: 2, unit: "piece" },
        { ingredientId: "reis", quantity: 300, unit: "gram" },
      ]),
    ).toEqual([
      { ingredientId: "reis", quantity: 300, unit: "gram" },
      { ingredientId: "zwiebel", quantity: 3, unit: "piece" },
    ]);
  });

  it("converts cloves and keeps mixed units separate", () => {
    expect(
      aggregateIngredients([
        { ingredientId: "knoblauch", quantity: 3, unit: "clove" },
        { ingredientId: "knoblauch", quantity: 1, unit: "piece" },
        { ingredientId: "knoblauch", quantity: 50, unit: "gram" },
      ]),
    ).toEqual([
      { ingredientId: "knoblauch", quantity: 50, unit: "gram" },
      { ingredientId: "knoblauch", quantity: 4, unit: "piece" },
    ]);
  });
});

describe("groupAlternatives", () => {
  it("separates mandatory ingredients from interchangeable groups", () => {
    const recipes = [
      {
        id: "r1",
        ingredients: [
          ingredient({ id: "i1", ingredientId: "garnelen", quantity: 300, unit: "gram", altGroup: "protein" }),
          ingredient({ id: "i2", ingredientId: "haehnchen", quantity: 400, unit: "gram", altGroup: "protein" }),
          ingredient({ id: "i3", ingredientId: "reis", quantity: 200, unit: "gram", altGroup: null }),
        ],
      },
    ];
    const { mandatory, groups } = groupAlternatives(recipes);
    expect(mandatory.map((entry) => entry.ingredientId)).toEqual(["reis"]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.variants.map((entry) => entry.ingredientId)).toEqual(["garnelen", "haehnchen"]);
  });
});
