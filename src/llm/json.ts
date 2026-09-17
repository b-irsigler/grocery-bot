import type { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import type { ChatMessage, LlmClient } from "./types";

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }
  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    return trimmed.slice(arrayStart, arrayEnd + 1);
  }
  return trimmed;
}

type ParseFailure = { ok: false; kind: "json" | "schema"; detail: string };
type ParseResult<T> = { ok: true; value: T } | ParseFailure;

function tryParse<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  text: string,
): ParseResult<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch (error) {
    return {
      ok: false,
      kind: "json",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  const result = schema.safeParse(parsed);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return {
    ok: false,
    kind: "schema",
    detail: JSON.stringify(result.error.issues),
  };
}

function describe(failure: ParseFailure): string {
  return failure.kind === "json"
    ? `ungültiges JSON (${failure.detail})`
    : `Schema-Verstoß (${failure.detail})`;
}

function excerpt(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 500 ? `${collapsed.slice(0, 500)}…` : collapsed;
}

export async function completeJson<T>(
  llm: LlmClient,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  messages: ChatMessage[],
  options?: { temperature?: number },
): Promise<T> {
  const requestOptions = {
    ...options,
    responseFormat: zodResponseFormat(schema, "response"),
  };
  const first = await llm.complete(messages, requestOptions);
  const firstParsed = tryParse(schema, first);
  if (firstParsed.ok) {
    return firstParsed.value;
  }
  const retryMessages: ChatMessage[] = [
    ...messages,
    { role: "assistant", content: first },
    { role: "user", content: "Antworte NUR mit gültigem JSON, ohne Erklärungen und ohne Markdown." },
  ];
  const second = await llm.complete(retryMessages, { ...requestOptions, temperature: 0 });
  const secondParsed = tryParse(schema, second);
  if (secondParsed.ok) {
    return secondParsed.value;
  }
  const detail = [
    `Erster Versuch: ${describe(firstParsed)} | Antwort: ${excerpt(first)}`,
    `Zweiter Versuch: ${describe(secondParsed)} | Antwort: ${excerpt(second)}`,
  ].join("\n");
  console.error("completeJson fehlgeschlagen:\n" + detail);
  throw new Error(`Die KI-Antwort konnte nicht als JSON gelesen werden.\n${detail}`);
}
