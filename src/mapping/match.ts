import { z } from "zod";
import { describeAmount, type Amount } from "../amounts";
import { completeJson } from "../llm/json";
import type { ChatMessage, LlmClient } from "../llm/types";
import type { ProductCandidate } from "../grocery/types";
import type { DontBuyItem } from "../db/repo";
import { resolvePackages } from "./quantity";

export interface IngredientNeed {
  ingredientId: string;
  amount: Amount;
  amountText: string;
}

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

export interface ProductChoice {
  product: ProductCandidate;
  packs: number;
  isGuess: boolean;
  total: number;
}

function coerceInt(value: unknown): unknown {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return value;
}

const PacksSchema = z.object({
  packs: z.preprocess(coerceInt, z.number().int().min(1).max(99)),
});

const MatchesSchema = z.object({
  matches: z.array(
    z.object({
      productId: z.string(),
      isGuess: z.boolean(),
    }),
  ),
});

function formatSize(product: ProductCandidate): string {
  if (product.unitAmount === null || product.unitAmountUnit === null) return "";
  const unit =
    product.unitAmountUnit === "gram"
      ? "g"
      : product.unitAmountUnit === "ml"
        ? "ml"
        : "Stück";
  return ` (${product.unitAmount} ${unit})`;
}

export async function resolvePackagesWithLlm(
  llm: LlmClient,
  need: IngredientNeed,
  product: ProductCandidate,
): Promise<number> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "Du hilfst beim Wocheneinkauf und schätzt Packungsmengen. Antworte NUR mit JSON.",
    },
    {
      role: "user",
      content:
        `Ein Rezept braucht: ${need.amountText} ${need.ingredientId.replace(/-/g, " ")} ` +
        `(${describeAmount(need.amount)}).\n` +
        `Produkt: ${product.name}${formatSize(product)}.\n` +
        `Wie viele Packungen dieses Produkts sind nötig? Antworte: {"packs": 1}`,
    },
  ];
  try {
    const parsed = await completeJson(llm, PacksSchema, messages, { temperature: 0 });
    return parsed.packs;
  } catch {
    return 1;
  }
}

async function matchCandidates(
  llm: LlmClient,
  need: IngredientNeed,
  candidates: ProductCandidate[],
): Promise<{ productId: string; isGuess: boolean }[]> {
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
        "Du bist ein deutscher Lebensmittel-Einkaufsassistent. Antworte NUR mit JSON.",
    },
    {
      role: "user",
      content:
        `Zutat: "${need.ingredientId.replace(/-/g, " ")}" (${describeAmount(need.amount)})\n\n` +
        `Kandidaten:\n${list}\n\n` +
        'Liste ALLE Kandidaten, die dieselbe Zutat darstellen, als ' +
        '{"matches":[{"productId":"...","isGuess":false}]}. ' +
        "Verschiedene Packungsgrößen oder Marken derselben Zutat gehören dazu " +
        "(der Preis entscheidet später). isGuess true nur für echte Ersatzprodukte, " +
        "also wenn die Zutat selbst nicht dabei ist. Maximal 5.",
    },
  ];
  try {
    const parsed = await completeJson(llm, MatchesSchema, messages, { temperature: 0 });
    return parsed.matches;
  } catch {
    return [];
  }
}

// Chooses a product and pack count. Among equally acceptable candidates the
// cheapest total (packs × price) wins; pack counts are deterministic where the
// need and pack size are comparable and otherwise estimated by the LLM.
export async function chooseProduct(
  llm: LlmClient,
  need: IngredientNeed,
  candidates: ProductCandidate[],
): Promise<ProductChoice | null> {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    const product = candidates[0] as ProductCandidate;
    const resolution = resolvePackages(need.amount, product);
    const packs = resolution.exact
      ? resolution.packs
      : await resolvePackagesWithLlm(llm, need, product);
    return { product, packs, isGuess: false, total: packs * product.price };
  }

  const matches = await matchCandidates(llm, need, candidates);
  const valid = matches.flatMap((match) => {
    const product = candidates.find((candidate) => candidate.productId === match.productId);
    return product ? [{ match, product }] : [];
  });

  const exact: ProductChoice[] = [];
  for (const entry of valid) {
    const resolution = resolvePackages(need.amount, entry.product);
    if (resolution.exact) {
      exact.push({
        product: entry.product,
        packs: resolution.packs,
        isGuess: entry.match.isGuess,
        total: resolution.packs * entry.product.price,
      });
    }
  }
  if (exact.length > 0) {
    return exact.reduce((best, current) => (current.total < best.total ? current : best));
  }

  const top = valid[0];
  if (top) {
    const packs = await resolvePackagesWithLlm(llm, need, top.product);
    return {
      product: top.product,
      packs,
      isGuess: top.match.isGuess,
      total: packs * top.product.price,
    };
  }

  const fallback = bestByPrice(candidates);
  if (!fallback) return null;
  const resolution = resolvePackages(need.amount, fallback);
  const packs = resolution.exact
    ? resolution.packs
    : await resolvePackagesWithLlm(llm, need, fallback);
  return { product: fallback, packs, isGuess: true, total: packs * fallback.price };
}
