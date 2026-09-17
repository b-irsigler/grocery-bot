import { describe, expect, it } from "vitest";
import { z } from "zod";
import { completeJson } from "../src/llm/json";
import type { ChatMessage, CompleteOptions, LlmClient } from "../src/llm/types";

function llmSequence(responses: string[]): { llm: LlmClient; calls: CompleteOptions[] } {
  const calls: CompleteOptions[] = [];
  let index = 0;
  const llm: LlmClient = {
    async complete(_messages: ChatMessage[], options?: CompleteOptions) {
      calls.push(options ?? {});
      const response = responses[index] ?? responses[responses.length - 1] ?? "";
      index += 1;
      return response;
    },
  };
  return { llm, calls };
}

const schema = z.object({ value: z.number() });

describe("completeJson", () => {
  it("retries after malformed JSON and returns the parsed value", async () => {
    const { llm, calls } = llmSequence(["not json at all", '{"value": 7}']);
    expect(await completeJson(llm, schema, [])).toEqual({ value: 7 });
    expect(calls).toHaveLength(2);
    const format = calls[0]?.responseFormat as { type?: string } | undefined;
    expect(format?.type).toBe("json_schema");
  });

  it("reports malformed JSON in the error", async () => {
    const { llm } = llmSequence(["{", "still not json"]);
    await expect(completeJson(llm, schema, [])).rejects.toThrow(/ungültiges JSON/);
  });

  it("reports schema violations in the error", async () => {
    const { llm } = llmSequence(["{}", "{}"]);
    await expect(completeJson(llm, schema, [])).rejects.toThrow(/Schema-Verstoß/);
  });
});
