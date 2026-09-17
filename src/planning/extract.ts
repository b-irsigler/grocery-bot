import { z } from "zod";
import { buildAmount, type Amount } from "../amounts";
import { completeJson } from "../llm/json";
import { nullify } from "../util/normalize";
import type { ChatMessage, LlmClient } from "../llm/types";

const AMOUNT_KINDS = ["measured", "count", "container", "unquantified"] as const;
const MEASURES = ["gram", "ml"] as const;

function coerceNumber(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "" || /^null$/i.test(trimmed)) return null;
    const parsed = Number.parseFloat(trimmed.replace(",", "."));
    if (!Number.isNaN(parsed)) return parsed;
  }
  return value;
}

// Each nullable field gets a unique description: zod-to-json-schema otherwise
// collapses structurally identical subschemas into `$ref`s, which Google's
// structured-output endpoint rejects ("reference to undefined schema").
const NullableString = (label: string) =>
  z.preprocess(nullify, z.string().nullable()).describe(label);
const NullableNumber = (label: string) =>
  z.preprocess(coerceNumber, z.number().positive().nullable()).describe(label);
const NullableMeasure = (label: string) =>
  z.preprocess(nullify, z.enum(MEASURES).nullable()).describe(label);

const AmountFields = {
  amountText: z.string().min(1),
  amountKind: z.enum(AMOUNT_KINDS),
  amountValue: NullableNumber("amountValue"),
  amountMeasure: NullableMeasure("amountMeasure"),
  amountItem: NullableString("amountItem"),
};

const IngredientSchema = z.object({
  ingredientId: z.string().min(1),
  ...AmountFields,
  altGroup: NullableString("altGroup"),
});

const RecipeSchema = z.object({
  title: z.string().min(1),
  tags: z.array(z.string()),
  ingredients: z.array(IngredientSchema).min(1),
});

export interface ExtractedIngredient {
  ingredientId: string;
  amount: Amount;
  amountText: string;
  altGroup: string | null;
}

export interface ExtractedRecipe {
  title: string;
  tags: string[];
  ingredients: ExtractedIngredient[];
}

const CLASSIFY_INSTRUCTIONS =
  "Klassifiziere jede Mengenangabe, statt sie in feste Einheiten umzurechnen. " +
  "amountText ist die Angabe wörtlich (z. B. \"eine halbe Packung\", \"2 EL\"). " +
  "amountKind: measured (Gewicht/Volumen), count (zählbare Stücke), " +
  "container (Packung/Dose/Glas/Beutel/Bund/Flasche), unquantified (Prise/etwas/nach Geschmack). " +
  "Bei measured: amountMeasure gram|ml und amountValue in g bzw. ml " +
  "(kg/l umrechnen, EL≈15 ml, TL≈5 ml). " +
  "Bei count: amountItem = Nomen im Singular (z. B. karotte, zehe, scheibe). " +
  "Bei container: amountValue = Anzahl Packungen (auch 0.5). " +
  "Sonst amountValue/amountMeasure/amountItem null.";

export async function extractRecipe(llm: LlmClient, text: string): Promise<ExtractedRecipe> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "Du extrahierst Rezepte aus deutschen Beschreibungen. " +
        CLASSIFY_INSTRUCTIONS +
        " ingredientId ist ein kebab-case deutscher Zutatenname. Antworte NUR mit JSON.",
    },
    {
      role: "user",
      content:
        `Beschreibung:\n${text}\n\n` +
        'Gib JSON zurück: {"title": "...", "tags": ["kueche", "herzhaft"], "ingredients": ' +
        '[{"ingredientId": "kebab-case-deutsch", "amountText": "2 EL", "amountKind": "measured", ' +
        '"amountValue": 30, "amountMeasure": "ml", "amountItem": null, "altGroup": null}]}. ' +
        "Alternativen (z. B. Garnelen oder Hähnchen) teilen denselben altGroup-String, sonst null.",
    },
  ];
  const parsed = await completeJson(llm, RecipeSchema, messages, { temperature: 0 });
  return {
    title: parsed.title,
    tags: parsed.tags,
    ingredients: parsed.ingredients.map((ingredient) => ({
      ingredientId: ingredient.ingredientId,
      amount: buildAmount(
        ingredient.amountKind,
        ingredient.amountValue,
        ingredient.amountMeasure,
        ingredient.amountItem,
      ),
      amountText: ingredient.amountText,
      altGroup: ingredient.altGroup,
    })),
  };
}

const BaseItemSchema = z.object({
  name: z.string().min(1),
  ...AmountFields,
});

const BaseSchema = z.object({
  items: z.array(BaseItemSchema).min(1),
});

export interface ExtractedBaseItem {
  name: string;
  amount: Amount;
  amountText: string;
}

export interface ExtractedBase {
  items: ExtractedBaseItem[];
}

export async function extractBaseItems(llm: LlmClient, text: string): Promise<ExtractedBase> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "Du extrahierst eine Grundsortiment-Liste aus deutschen Beschreibungen. " +
        CLASSIFY_INSTRUCTIONS +
        " Antworte NUR mit JSON.",
    },
    {
      role: "user",
      content:
        `Beschreibung:\n${text}\n\n` +
        'Gib JSON zurück: {"items": [{"name": "Milch", "amountText": "1 Liter", "amountKind": "measured", ' +
        '"amountValue": 1000, "amountMeasure": "ml", "amountItem": null}]}.',
    },
  ];
  const parsed = await completeJson(llm, BaseSchema, messages, { temperature: 0 });
  return {
    items: parsed.items.map((item) => ({
      name: item.name,
      amount: buildAmount(
        item.amountKind,
        item.amountValue,
        item.amountMeasure,
        item.amountItem,
      ),
      amountText: item.amountText,
    })),
  };
}
