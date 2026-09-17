import { describe, expect, it } from "vitest";
import { chunkText, formatBaseItems, formatRecipeList } from "../src/bot/format";
import type { BaseItem } from "../src/db/repo";

describe("formatRecipeList", () => {
  it("numbers titles with their tags", () => {
    expect(
      formatRecipeList([
        { id: "a", title: "Pasta", tags: ["italienisch"] },
        { id: "b", title: "Suppe", tags: [] },
      ]),
    ).toBe("1. Pasta [italienisch]\n2. Suppe []");
  });
});

describe("formatBaseItems", () => {
  it("renders amount and name", () => {
    const items: BaseItem[] = [
      { id: "1", name: "Milch", amount: { kind: "measured", value: 1000, measure: "ml" } },
      { id: "2", name: "Butter", amount: { kind: "container", value: 1 } },
    ];
    expect(formatBaseItems(items)).toBe("- 1000 ml Milch\n- 1 × Packung Butter");
  });
});

describe("chunkText", () => {
  it("splits on line boundaries within the limit", () => {
    expect(chunkText("aaaa\nbbbb\ncccc", 9)).toEqual(["aaaa\nbbbb", "cccc"]);
  });

  it("hard-splits a single overlong line", () => {
    expect(chunkText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("returns the whole text when it fits", () => {
    expect(chunkText("a\nb", 100)).toEqual(["a\nb"]);
  });
});
