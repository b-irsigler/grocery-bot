import { z } from "zod";
import { completeJson } from "../llm/json";
import type { ChatMessage, LlmClient } from "../llm/types";

export interface RecipeSummary {
  id: string;
  title: string;
  tags: string[];
}

const SelectionSchema = z.object({
  recipeIds: z.array(z.string()).min(1),
  reasoning: z.string().default(""),
});

export function buildSelectionMessages(
  pool: RecipeSummary[],
  count: number,
  previous: string[] | null,
  feedback: string | null,
): ChatMessage[] {
  const list = pool.map((recipe) => `- ${recipe.id}: ${recipe.title} [${recipe.tags.join(", ")}]`).join("\n");
  const parts = [
    "Du bist ein deutscher Essensplan-Assistent.",
    `Wähle genau ${count} verschiedene Rezepte aus der folgenden Liste.`,
    "Achte auf Abwechslung bei Küche, Sättigung und Zutaten.",
    'Antworte NUR mit JSON der Form {"recipeIds": ["id1", "id2"], "reasoning": "kurze Begründung auf Deutsch"}.',
    "",
    "Verfügbare Rezepte:",
    list,
  ];
  if (previous && previous.length > 0) {
    parts.push("", `Bisherige Auswahl: ${previous.join(", ")}`);
  }
  if (feedback) {
    parts.push("", `Änderungswunsch des Nutzers: ${feedback}`);
  }
  return [
    { role: "system", content: "Antworte ausschließlich mit gültigem JSON." },
    { role: "user", content: parts.join("\n") },
  ];
}

export async function selectRecipes(
  llm: LlmClient,
  pool: RecipeSummary[],
  count: number,
  previous: string[] | null = null,
  feedback: string | null = null,
): Promise<string[]> {
  const messages = buildSelectionMessages(pool, count, previous, feedback);
  const result = await completeJson(llm, SelectionSchema, messages, { temperature: 0.7 });
  const valid = result.recipeIds.filter((id) => pool.some((recipe) => recipe.id === id));
  if (valid.length === 0) {
    throw new Error("Die KI konnte keine gültigen Rezepte auswählen.");
  }
  return [...new Set(valid)].slice(0, count);
}
