import { describe, expect, it } from "vitest";
import { selectRecipes } from "../src/planning/selector";
import type { LlmClient } from "../src/llm/types";

const llmReturning = (text: string): LlmClient => ({ complete: async () => text });

const pool = [
  { id: "a", title: "A", tags: [] },
  { id: "b", title: "B", tags: [] },
  { id: "c", title: "C", tags: [] },
];

describe("selectRecipes", () => {
  it("filters ids that are not in the pool and de-duplicates", async () => {
    const llm = llmReturning('{"recipeIds": ["a", "zzz", "a", "b"]}');
    expect(await selectRecipes(llm, pool, 2)).toEqual(["a", "b"]);
  });

  it("throws when no valid id is returned", async () => {
    const llm = llmReturning('{"recipeIds": ["zzz"]}');
    await expect(selectRecipes(llm, pool, 1)).rejects.toThrow();
  });
});
