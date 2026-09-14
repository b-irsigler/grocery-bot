import type { z } from "zod";
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

function tryParse<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  text: string,
): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: schema.parse(JSON.parse(extractJson(text))) };
  } catch {
    return { ok: false };
  }
}

export async function completeJson<T>(
  llm: LlmClient,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  messages: ChatMessage[],
  options?: { temperature?: number },
): Promise<T> {
  const first = await llm.complete(messages, options);
  const firstParsed = tryParse(schema, first);
  if (firstParsed.ok) {
    return firstParsed.value;
  }
  const retryMessages: ChatMessage[] = [
    ...messages,
    { role: "assistant", content: first },
    { role: "user", content: "Antworte NUR mit gültigem JSON, ohne Erklärungen und ohne Markdown." },
  ];
  const second = await llm.complete(retryMessages, { temperature: 0 });
  const secondParsed = tryParse(schema, second);
  if (secondParsed.ok) {
    return secondParsed.value;
  }
  throw new Error("Die KI-Antwort konnte nicht als JSON gelesen werden.");
}
