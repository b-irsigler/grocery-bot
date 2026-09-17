import { z } from "zod";
import { completeJson } from "../llm/json";
import { nullify } from "../util/normalize";
import type { ChatMessage, LlmClient } from "../llm/types";

export const INTENTS = [
  "start",
  "add_recipe",
  "edit_recipe",
  "remove_recipe",
  "edit_base",
  "add_dont_buy",
  "remove_dont_buy",
  "list_dont_buy",
  "help",
  "none",
] as const;

export type Intent = (typeof INTENTS)[number];

const IntentSchema = z.object({
  intent: z.enum(INTENTS),
  argument: z.preprocess(nullify, z.string().nullable().default(null)),
});

export async function routeIntent(
  llm: LlmClient,
  text: string,
): Promise<{ intent: Intent; argument: string | null }> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "Du klassifizierst deutsche Telegram-Nachrichten für einen Einkaufsbot. Antworte NUR mit JSON.",
    },
    {
      role: "user",
      content:
        `Nachricht: "${text}"\n\n` +
        `Ordne sie einer Absicht zu: ${INTENTS.join(", ")}. ` +
        '"start" = Essensplan erstellen (Argument: Anzahl Mahlzeiten). ' +
        '"edit_recipe"/"remove_recipe" = Rezeptname als Argument. ' +
        '"add_dont_buy"/"remove_dont_buy" = Produktname als Argument. ' +
        '"none" = keine passende Absicht. ' +
        'Antworte: {"intent": "...", "argument": "..."}',
    },
  ];
  return completeJson(llm, IntentSchema, messages, { temperature: 0 });
}
