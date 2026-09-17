import { z } from "zod";
import { UNITS, normalizeUnit } from "../units";
import { completeJson } from "../llm/json";
import { nullify } from "../util/normalize";
import type { ChatMessage, LlmClient } from "../llm/types";

function coerceQuantity(value: unknown): unknown {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(",", "."));
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return value;
}

const UnitSchema = z.preprocess(normalizeUnit, z.enum(UNITS));
const QuantitySchema = z.preprocess(coerceQuantity, z.number().positive());
const NullableStringSchema = z.preprocess(nullify, z.string().nullable().default(null));

const IngredientSchema = z.object({
  ingredientId: z.string().min(1),
  quantity: QuantitySchema,
  unit: UnitSchema,
  altGroup: NullableStringSchema,
});

const RecipeSchema = z.object({
  title: z.string().min(1),
  tags: z.array(z.string()),
  ingredients: z.array(IngredientSchema).min(1),
});

export type ExtractedRecipe = z.infer<typeof RecipeSchema>;

export async function extractRecipe(llm: LlmClient, text: string): Promise<ExtractedRecipe> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "Du extrahierst Rezepte aus deutschen Beschreibungen. ingredientId ist ein kebab-case deutscher Zutatenname. " +
        "Erlaubte Einheiten sind piece, clove, gram, ml, package. " +
        "Ordne deutsche Angaben zu: EL/Esslöffel → ml, TL/Teelöffel → ml, g/Gramm → gram, " +
        "Prise/Stück/Scheibe → piece, Zehe/Zehen → clove, Packung/Dose/Glas/Beutel/Bund → package. " +
        "Antworte NUR mit JSON.",
    },
    {
      role: "user",
      content:
        `Beschreibung:\n${text}\n\n` +
        'Gib JSON zurück: {"title": "...", "tags": ["kueche", "herzhaft"], "ingredients": ' +
        '[{"ingredientId": "kebab-case-deutsch", "quantity": 1, "unit": "piece|clove|gram|ml|package", "altGroup": null}]}. ' +
        "Alternativen (z. B. Garnelen oder Hähnchen) teilen denselben altGroup-String, sonst null.",
    },
  ];
  return completeJson(llm, RecipeSchema, messages, { temperature: 0 });
}

const BaseSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        quantity: QuantitySchema,
        unit: UnitSchema,
      }),
    )
    .min(1),
});

export type ExtractedBase = z.infer<typeof BaseSchema>;

export async function extractBaseItems(llm: LlmClient, text: string): Promise<ExtractedBase> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "Du extrahierst eine Grundsortiment-Liste aus deutschen Beschreibungen. " +
        "Erlaubte Einheiten sind piece, clove, gram, ml, package. " +
        "Ordne deutsche Angaben zu: EL/Esslöffel → ml, TL/Teelöffel → ml, g/Gramm → gram, " +
        "Prise/Stück/Scheibe → piece, Zehe/Zehen → clove, Packung/Dose/Glas/Beutel/Bund → package. " +
        "Antworte NUR mit JSON.",
    },
    {
      role: "user",
      content:
        `Beschreibung:\n${text}\n\n` +
        'Gib JSON zurück: {"items": [{"name": "...", "quantity": 1, "unit": "piece|clove|gram|ml|package"}]}.',
    },
  ];
  return completeJson(llm, BaseSchema, messages, { temperature: 0 });
}
