import { describe, expect, it } from "vitest";
import { routeIntent } from "../src/bot/nl";
import type { LlmClient } from "../src/llm/types";

const llmReturning = (text: string): LlmClient => ({ complete: async () => text });

describe("routeIntent", () => {
  it("passes through a valid intent and argument", async () => {
    const llm = llmReturning('{"intent": "remove_recipe", "argument": "Chili"}');
    expect(await routeIntent(llm, "lösche Chili")).toEqual({ intent: "remove_recipe", argument: "Chili" });
  });

  it("rejects an unknown intent", async () => {
    const llm = llmReturning('{"intent": "launch_missiles", "argument": null}');
    await expect(routeIntent(llm, "hallo")).rejects.toThrow();
  });

  it("treats an empty or literal null argument as null", async () => {
    const llm = llmReturning('{"intent": "list_dont_buy", "argument": "null"}');
    expect(await routeIntent(llm, "was steht auf der liste")).toEqual({
      intent: "list_dont_buy",
      argument: null,
    });
  });
});
