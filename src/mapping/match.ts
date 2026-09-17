import { z } from "zod";
import { completeJson } from "../llm/json";
import type { ChatMessage, LlmClient } from "../llm/types";
import type { ProductCandidate } from "../grocery/types";
import type { DontBuyItem } from "../db/repo";

const MatchSchema = z.object({
  productId: z.string(),
  isGuess: z.boolean(),
});

export function isBlocked(product: ProductCandidate, dontBuy: DontBuyItem[]): boolean {
  const lowerName = product.name.trim().toLowerCase();
  return dontBuy.some(
    (item) =>
      (item.productId !== null && item.productId === product.productId) ||
      item.name.trim().toLowerCase() === lowerName,
  );
}

export function filterCandidates(
  candidates: ProductCandidate[],
  dontBuy: DontBuyItem[],
): ProductCandidate[] {
  return candidates.filter((candidate) => !isBlocked(candidate, dontBuy));
}

export function bestByPrice(candidates: ProductCandidate[]): ProductCandidate | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (a.onDeal !== b.onDeal) return a.onDeal ? -1 : 1;
    return a.price - b.price;
  });
  return sorted[0] ?? null;
}

export interface ProductMatch {
  product: ProductCandidate;
  isGuess: boolean;
}

export async function pickBestMatch(
  llm: LlmClient,
  ingredientId: string,
  candidates: ProductCandidate[],
): Promise<ProductMatch | null> {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    const single = candidates[0] ?? null;
    return single === null ? null : { product: single, isGuess: false };
  }
  const list = candidates
    .map(
      (candidate) =>
        `- ${candidate.productId}: ${candidate.name} (${candidate.price.toFixed(2)} €${
          candidate.onDeal ? ", Angebot" : ""
        })`,
    )
    .join("\n");
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "Du bist ein deutscher Lebensmittel-Einkaufsassistent. Wähle das Produkt, das die Zutat am besten trifft. Wenn kein Kandidat die Zutat wirklich trifft, wähle den nächstbesten Ersatz und setze isGuess auf true. Antworte NUR mit JSON.",
    },
    {
      role: "user",
      content: `Zutat: "${ingredientId.replace(/-/g, " ")}"\n\nKandidaten:\n${list}\n\nAntworte mit {"productId": "...", "isGuess": false}`,
    },
  ];
  const result = await completeJson(llm, MatchSchema, messages, { temperature: 0 });
  const found = candidates.find((candidate) => candidate.productId === result.productId);
  if (found) {
    return { product: found, isGuess: result.isGuess };
  }
  const fallback = bestByPrice(candidates);
  return fallback === null ? null : { product: fallback, isGuess: true };
}
