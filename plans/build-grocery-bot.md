# Plan — build-grocery-bot

## Status: approved

Single-plan greenfield build of the Grocery Bot described in `ARCHITECTURE.md`,
expanded from `plans/build-grocery-bot.sketch.md`. Does not change the sketch's
architecture; only adds executor-level detail (exact file bodies, types,
verification).

Deviations from the sketch (approved in planner review):
- `ProductCandidate` gains `unitAmountUnit` (`"gram" | "ml" | "piece" | null`)
  so package round-up math is unit-aware.
- Product search uses per-ingredient `search_products` only.
  `batch_search_products` is kept as `TOOLS.batchSearch` for reference but is
  not used (its schema is undocumented; per-ingredient search suffices).
- `pickBestMatch` returns `{ product, isGuess }`; `isGuess` implements ADR 9 —
  substitute products are flagged to the user as "Ersatzprodukt".
- Amendment (2026-09-12, authorized by developer after executor STOP):
  `completeJson`/`tryParse` in `src/llm/json.ts` take
  `z.ZodType<T, z.ZodTypeDef, unknown>` instead of `z.ZodType<T>` so zod
  schemas using `.default(...)` (input ≠ output) type-check; `T` infers from
  the schema output. No behavior change.

## Goal

A Telegram bot in TypeScript/Node that lets two people maintain a recipe pool,
plan a week of meals in natural language, and have the bot assemble a Knuspr
shopping cart (base items + aggregated recipe ingredients) via the official
Knuspr MCP server. No checkout. All user-facing text in German.

## Non-goals

- No checkout/payment/delivery-slot booking (ADR 4, 13).
- No recipe scaling (recipes are fixed for 2 adults + 1 small child).
- No concurrency handling (ADR 16).
- No semantic unit/ingredient plausibility checks beyond enum membership (ADR 19).
- No MCP OAuth flow (headless header auth only).
- No i18n beyond German; no web UI.
- No LLM for arithmetic (ADR 8).

## Conventions

- ESM, TypeScript strict, extensionless relative imports.
- Runtime `tsx` everywhere (dev, production container). No build step.
- Pure logic lives in modules that do NOT import `src/config.ts`, so tests can
  import them without a populated `.env`. Config is imported only by
  `src/db/index.ts`, `src/llm/client.ts`, `src/knuspr/client.ts`,
  `src/bot/access.ts`, and `scripts/knuspr-check.ts`.
- `import type` for type-only imports so they are erased at runtime.

---

## Step 1 — Scaffold

Create these files.

### `package.json`

```json
{
  "name": "grocery-bot",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "dev": "tsx watch src/bot/index.ts",
    "start": "tsx src/bot/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "knuspr:check": "tsx scripts/knuspr-check.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "better-sqlite3": "^11.8.1",
    "dotenv": "^16.4.7",
    "grammy": "^1.35.0",
    "openai": "^4.85.0",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.13.0",
    "tsx": "^4.19.3",
    "typescript": "^5.7.3",
    "vitest": "^3.0.5"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  },
  "include": ["src", "scripts", "test"]
}
```

### `.env.example`

```dotenv
TELEGRAM_BOT_TOKEN=
ALLOWED_CHAT_IDS=11111111,22222222
LLM_API_KEY=
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
KNUSPR_MCP_URL=https://mcp.knuspr.de/mcp
KNUSPR_EMAIL=
KNUSPR_PASSWORD=
DB_PATH=./data/grocery.db
```

### `.gitignore`

```
node_modules/
data/
.env
dist/
*.log
```

Verification: `ls package.json tsconfig.json .env.example .gitignore` → all four listed.

---

## Step 2 — Core modules

### `src/util/slug.ts`

```ts
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
```

### `src/units.ts`

```ts
export const UNITS = ["piece", "clove", "gram", "ml", "package"] as const;
export type Unit = (typeof UNITS)[number];

const COUNTABLE: ReadonlySet<Unit> = new Set(["piece", "clove", "package"]);

export function isUnit(value: unknown): value is Unit {
  return typeof value === "string" && (UNITS as readonly string[]).includes(value);
}

export function isCountable(unit: Unit): boolean {
  return COUNTABLE.has(unit);
}

export function convertClovesToPieces(
  quantity: number,
  unit: Unit,
): { quantity: number; unit: Unit } {
  if (unit === "clove") {
    return { quantity, unit: "piece" };
  }
  return { quantity, unit };
}
```

### `src/config.ts`

```ts
import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  ALLOWED_CHAT_IDS: z.string().min(1),
  LLM_API_KEY: z.string().min(1),
  LLM_BASE_URL: z.string().url(),
  LLM_MODEL: z.string().min(1),
  KNUSPR_MCP_URL: z.string().url().default("https://mcp.knuspr.de/mcp"),
  KNUSPR_EMAIL: z.string().min(1),
  KNUSPR_PASSWORD: z.string().min(1),
  DB_PATH: z.string().min(1).default("./data/grocery.db"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues
    .map((issue) => issue.path.join("."))
    .join(", ");
  console.error(`Fehlende oder ungültige Konfiguration: ${problems}`);
  process.exit(1);
}

export const config = {
  telegramBotToken: parsed.data.TELEGRAM_BOT_TOKEN,
  allowedChatIds: parsed.data.ALLOWED_CHAT_IDS.split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0),
  llmApiKey: parsed.data.LLM_API_KEY,
  llmBaseUrl: parsed.data.LLM_BASE_URL,
  llmModel: parsed.data.LLM_MODEL,
  knusprMcpUrl: parsed.data.KNUSPR_MCP_URL,
  knusprEmail: parsed.data.KNUSPR_EMAIL,
  knusprPassword: parsed.data.KNUSPR_PASSWORD,
  dbPath: parsed.data.DB_PATH,
} as const;
```

### `src/db/index.ts`

```ts
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { config } from "../config";

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL UNIQUE,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS recipe_ingredients (
      id TEXT PRIMARY KEY,
      recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      ingredient_id TEXT NOT NULL,
      quantity REAL NOT NULL CHECK (quantity > 0),
      unit TEXT NOT NULL CHECK (unit IN ('piece','clove','gram','ml','package')),
      alt_group TEXT
    );

    CREATE TABLE IF NOT EXISTS base_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      quantity REAL NOT NULL CHECK (quantity > 0),
      unit TEXT NOT NULL CHECK (unit IN ('piece','clove','gram','ml','package'))
    );

    CREATE TABLE IF NOT EXISTS dont_buy (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      knuspr_product_id TEXT,
      name TEXT NOT NULL
    );
  `);
}
```

### `src/db/repo.ts`

```ts
import { randomUUID } from "node:crypto";
import { slugify } from "../util/slug";
import type { Unit } from "../units";
import { db } from "./index";

export interface Recipe {
  id: string;
  title: string;
  tags: string[];
}

export interface RecipeIngredient {
  id: string;
  recipeId: string;
  ingredientId: string;
  quantity: number;
  unit: Unit;
  altGroup: string | null;
}

export interface RecipeWithIngredients extends Recipe {
  ingredients: RecipeIngredient[];
}

export interface IngredientInput {
  ingredientId: string;
  quantity: number;
  unit: Unit;
  altGroup: string | null;
}

export interface BaseItem {
  id: string;
  name: string;
  quantity: number;
  unit: Unit;
}

export interface DontBuyItem {
  id: number;
  knusprProductId: string | null;
  name: string;
}

interface RecipeRow {
  id: string;
  title: string;
  tags: string;
}

interface IngredientRow {
  id: string;
  recipe_id: string;
  ingredient_id: string;
  quantity: number;
  unit: Unit;
  alt_group: string | null;
}

interface BaseRow {
  id: string;
  name: string;
  quantity: number;
  unit: Unit;
}

interface DontBuyRow {
  id: number;
  knuspr_product_id: string | null;
  name: string;
}

function rowToRecipe(row: RecipeRow): Recipe {
  return { id: row.id, title: row.title, tags: JSON.parse(row.tags) as string[] };
}

function rowToIngredient(row: IngredientRow): RecipeIngredient {
  return {
    id: row.id,
    recipeId: row.recipe_id,
    ingredientId: row.ingredient_id,
    quantity: row.quantity,
    unit: row.unit,
    altGroup: row.alt_group,
  };
}

export function listRecipes(): Recipe[] {
  const rows = db
    .prepare("SELECT id, title, tags FROM recipes ORDER BY title")
    .all() as RecipeRow[];
  return rows.map(rowToRecipe);
}

export function listRecipeIngredients(recipeId: string): RecipeIngredient[] {
  const rows = db
    .prepare(
      "SELECT id, recipe_id, ingredient_id, quantity, unit, alt_group FROM recipe_ingredients WHERE recipe_id = ? ORDER BY rowid",
    )
    .all(recipeId) as IngredientRow[];
  return rows.map(rowToIngredient);
}

export function getRecipe(id: string): RecipeWithIngredients | undefined {
  const row = db
    .prepare("SELECT id, title, tags FROM recipes WHERE id = ?")
    .get(id) as RecipeRow | undefined;
  if (!row) return undefined;
  return { ...rowToRecipe(row), ingredients: listRecipeIngredients(row.id) };
}

export function getRecipeByTitle(title: string): RecipeWithIngredients | undefined {
  const row = db
    .prepare("SELECT id, title, tags FROM recipes WHERE lower(title) = lower(?)")
    .get(title.trim()) as RecipeRow | undefined;
  if (!row) return undefined;
  return { ...rowToRecipe(row), ingredients: listRecipeIngredients(row.id) };
}

function insertIngredients(recipeId: string, ingredients: IngredientInput[]): void {
  const statement = db.prepare(
    "INSERT INTO recipe_ingredients (id, recipe_id, ingredient_id, quantity, unit, alt_group) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const ingredient of ingredients) {
    statement.run(
      randomUUID(),
      recipeId,
      ingredient.ingredientId,
      ingredient.quantity,
      ingredient.unit,
      ingredient.altGroup,
    );
  }
}

export function createRecipe(
  title: string,
  tags: string[],
  ingredients: IngredientInput[],
): RecipeWithIngredients {
  const id = slugify(title);
  if (id.length === 0) {
    throw new Error("Der Rezepttitel ist ungültig.");
  }
  const existing = db
    .prepare("SELECT id FROM recipes WHERE id = ? OR lower(title) = lower(?)")
    .get(id, title.trim());
  if (existing) {
    throw new Error(`Ein Rezept mit dem Titel "${title}" existiert bereits.`);
  }
  const transaction = db.transaction(() => {
    db.prepare("INSERT INTO recipes (id, title, tags) VALUES (?, ?, ?)").run(
      id,
      title.trim(),
      JSON.stringify(tags),
    );
    insertIngredients(id, ingredients);
  });
  transaction();
  return getRecipe(id) as RecipeWithIngredients;
}

export function updateRecipe(
  id: string,
  title: string,
  tags: string[],
  ingredients: IngredientInput[],
): RecipeWithIngredients {
  const existing = db.prepare("SELECT id FROM recipes WHERE id = ?").get(id);
  if (!existing) {
    throw new Error(`Rezept "${id}" nicht gefunden.`);
  }
  const transaction = db.transaction(() => {
    db.prepare("UPDATE recipes SET title = ?, tags = ? WHERE id = ?").run(
      title.trim(),
      JSON.stringify(tags),
      id,
    );
    db.prepare("DELETE FROM recipe_ingredients WHERE recipe_id = ?").run(id);
    insertIngredients(id, ingredients);
  });
  transaction();
  return getRecipe(id) as RecipeWithIngredients;
}

export function deleteRecipe(id: string): boolean {
  const result = db.prepare("DELETE FROM recipes WHERE id = ?").run(id);
  return result.changes > 0;
}

export function listBaseItems(): BaseItem[] {
  const rows = db
    .prepare("SELECT id, name, quantity, unit FROM base_items ORDER BY rowid")
    .all() as BaseRow[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
  }));
}

export function addBaseItem(name: string, quantity: number, unit: Unit): BaseItem {
  const id = randomUUID();
  db.prepare("INSERT INTO base_items (id, name, quantity, unit) VALUES (?, ?, ?, ?)").run(
    id,
    name.trim(),
    quantity,
    unit,
  );
  return { id, name: name.trim(), quantity, unit };
}

export function deleteBaseItem(id: string): boolean {
  const result = db.prepare("DELETE FROM base_items WHERE id = ?").run(id);
  return result.changes > 0;
}

export function replaceBaseItems(items: { name: string; quantity: number; unit: Unit }[]): void {
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM base_items").run();
    const statement = db.prepare(
      "INSERT INTO base_items (id, name, quantity, unit) VALUES (?, ?, ?, ?)",
    );
    for (const item of items) {
      statement.run(randomUUID(), item.name.trim(), item.quantity, item.unit);
    }
  });
  transaction();
}

export function listDontBuy(): DontBuyItem[] {
  const rows = db
    .prepare("SELECT id, knuspr_product_id, name FROM dont_buy ORDER BY name")
    .all() as DontBuyRow[];
  return rows.map((row) => ({
    id: row.id,
    knusprProductId: row.knuspr_product_id,
    name: row.name,
  }));
}

export function addDontBuy(name: string, knusprProductId: string | null): DontBuyItem {
  const result = db
    .prepare("INSERT INTO dont_buy (knuspr_product_id, name) VALUES (?, ?)")
    .run(knusprProductId, name.trim());
  return { id: Number(result.lastInsertRowid), knusprProductId, name: name.trim() };
}

export function removeDontBuy(id: number): boolean {
  const result = db.prepare("DELETE FROM dont_buy WHERE id = ?").run(id);
  return result.changes > 0;
}

export function findDontBuyByName(name: string): DontBuyItem | undefined {
  const row = db
    .prepare("SELECT id, knuspr_product_id, name FROM dont_buy WHERE lower(name) = lower(?)")
    .get(name.trim()) as DontBuyRow | undefined;
  return row
    ? { id: row.id, knusprProductId: row.knuspr_product_id, name: row.name }
    : undefined;
}
```

### `src/llm/types.ts`

```ts
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmClient {
  complete(messages: ChatMessage[], options?: { temperature?: number }): Promise<string>;
}
```

### `src/llm/client.ts`

```ts
import OpenAI from "openai";
import { config } from "../config";
import type { ChatMessage, LlmClient } from "./types";

export function createLlmClient(): LlmClient {
  const client = new OpenAI({ apiKey: config.llmApiKey, baseURL: config.llmBaseUrl });
  return {
    async complete(
      messages: ChatMessage[],
      options?: { temperature?: number },
    ): Promise<string> {
      const response = await client.chat.completions.create({
        model: config.llmModel,
        messages: messages as OpenAI.ChatCompletionMessageParam[],
        temperature: options?.temperature ?? 0,
      });
      return response.choices[0]?.message?.content ?? "";
    },
  };
}
```

### `src/llm/json.ts`

```ts
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
```

Verification: `ls src/util/slug.ts src/units.ts src/config.ts src/db/index.ts src/db/repo.ts src/llm/types.ts src/llm/client.ts src/llm/json.ts` → all listed.

---

## Step 3 — Mapping math (pure)

### `src/mapping/quantity.ts`

```ts
import { isCountable, type Unit } from "../units";

export interface PackageAmount {
  amount: number;
  unit: "gram" | "ml" | "piece";
}

export interface PackageLike {
  unitAmount: number | null;
  unitAmountUnit: "gram" | "ml" | "piece" | null;
}

function parseNumber(raw: string): number {
  return Number.parseFloat(raw.replace(",", "."));
}

export function parsePackageAmount(name: string): PackageAmount | null {
  const multipack = name.match(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i);
  if (multipack) {
    const count = parseNumber(multipack[1] as string);
    const size = parseNumber(multipack[2] as string);
    const rawUnit = (multipack[3] as string).toLowerCase();
    const factor = rawUnit === "kg" || rawUnit === "l" ? 1000 : 1;
    const unit = rawUnit === "kg" || rawUnit === "g" ? "gram" : "ml";
    return { amount: count * size * factor, unit };
  }
  const weight = name.match(/(\d+(?:[.,]\d+)?)\s*(kg|g)\b/i);
  if (weight) {
    const size = parseNumber(weight[1] as string);
    const isKg = (weight[2] as string).toLowerCase() === "kg";
    return { amount: isKg ? size * 1000 : size, unit: "gram" };
  }
  const volume = name.match(/(\d+(?:[.,]\d+)?)\s*(l|ml)\b/i);
  if (volume) {
    const size = parseNumber(volume[1] as string);
    const isLiter = (volume[2] as string).toLowerCase() === "l";
    return { amount: isLiter ? size * 1000 : size, unit: "ml" };
  }
  const pieces = name.match(/(\d+)\s*(stk|stück|stueck|st)\b/i);
  if (pieces) {
    return { amount: parseNumber(pieces[1] as string), unit: "piece" };
  }
  return null;
}

export function roundUpToPackages(
  need: { quantity: number; unit: Unit },
  product: PackageLike,
): number {
  if (isCountable(need.unit)) {
    return Math.max(1, Math.ceil(need.quantity));
  }
  if (product.unitAmount === null || product.unitAmountUnit === null || product.unitAmount <= 0) {
    return Math.max(1, Math.ceil(need.quantity));
  }
  const compatible =
    (need.unit === "gram" && product.unitAmountUnit === "gram") ||
    (need.unit === "ml" && product.unitAmountUnit === "ml");
  if (!compatible) {
    return Math.max(1, Math.ceil(need.quantity));
  }
  return Math.max(1, Math.ceil(need.quantity / product.unitAmount));
}
```

### `src/mapping/aggregate.ts`

```ts
import { convertClovesToPieces, type Unit } from "../units";
import type { RecipeIngredient } from "../db/repo";

export interface NeedLine {
  ingredientId: string;
  quantity: number;
  unit: Unit;
}

export interface IngredientNeed {
  ingredientId: string;
  quantity: number;
  unit: Unit;
}

export interface AlternativeGroup {
  key: string;
  recipeId: string;
  variants: RecipeIngredient[];
}

export function aggregateIngredients(ingredients: IngredientNeed[]): NeedLine[] {
  const totals = new Map<string, NeedLine>();
  for (const ingredient of ingredients) {
    const converted = convertClovesToPieces(ingredient.quantity, ingredient.unit);
    const key = `${ingredient.ingredientId}\u0000${converted.unit}`;
    const existing = totals.get(key);
    if (existing) {
      existing.quantity += converted.quantity;
    } else {
      totals.set(key, {
        ingredientId: ingredient.ingredientId,
        quantity: converted.quantity,
        unit: converted.unit,
      });
    }
  }
  return [...totals.values()].sort((a, b) => {
    const byIngredient = a.ingredientId.localeCompare(b.ingredientId);
    return byIngredient !== 0 ? byIngredient : a.unit.localeCompare(b.unit);
  });
}

export function groupAlternatives(
  recipes: { id: string; ingredients: RecipeIngredient[] }[],
): { mandatory: RecipeIngredient[]; groups: AlternativeGroup[] } {
  const mandatory: RecipeIngredient[] = [];
  const groups = new Map<string, AlternativeGroup>();
  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients) {
      if (ingredient.altGroup === null) {
        mandatory.push(ingredient);
        continue;
      }
      const key = `${recipe.id}\u0000${ingredient.altGroup}`;
      const group = groups.get(key);
      if (group) {
        group.variants.push(ingredient);
      } else {
        groups.set(key, { key, recipeId: recipe.id, variants: [ingredient] });
      }
    }
  }
  return { mandatory, groups: [...groups.values()] };
}
```

### `src/mapping/match.ts`

```ts
import { z } from "zod";
import { completeJson } from "../llm/json";
import type { ChatMessage, LlmClient } from "../llm/types";
import type { ProductCandidate } from "../knuspr/client";
import type { DontBuyItem } from "../db/repo";

const MatchSchema = z.object({
  productId: z.string(),
  isGuess: z.boolean().default(false),
});

export function isBlocked(product: ProductCandidate, dontBuy: DontBuyItem[]): boolean {
  const lowerName = product.name.trim().toLowerCase();
  return dontBuy.some(
    (item) =>
      (item.knusprProductId !== null && item.knusprProductId === product.productId) ||
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
```

Verification: `ls src/mapping/quantity.ts src/mapping/aggregate.ts src/mapping/match.ts` → all listed.

---

## Step 4 — Knuspr MCP client

### `src/knuspr/client.ts`

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { config } from "../config";
import { parsePackageAmount, type PackageAmount } from "../mapping/quantity";

export const TOOLS = {
  search: "search_products",
  batchSearch: "batch_search_products",
  addToCart: "add_items_to_cart",
  getCart: "get_cart",
} as const;

export interface ProductCandidate {
  productId: string;
  name: string;
  price: number;
  unitAmount: number | null;
  unitAmountUnit: PackageAmount["unit"] | null;
  onDeal: boolean;
}

export interface KnusprClient {
  searchProducts(keyword: string, limit?: number): Promise<ProductCandidate[]>;
  addToCart(productId: string, amount: number): Promise<void>;
  close(): Promise<void>;
}

function textFromResult(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type?: string; text?: string } =>
        typeof part === "object" && part !== null,
    )
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
}

function extractJsonPayload(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // keep trying
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // keep trying
    }
  }
  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    try {
      return JSON.parse(trimmed.slice(arrayStart, arrayEnd + 1));
    } catch {
      // keep trying
    }
  }
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    try {
      return JSON.parse(trimmed.slice(objectStart, objectEnd + 1));
    } catch {
      // give up
    }
  }
  return null;
}

function findProductArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["products", "results", "items", "data", "hits"]) {
      if (Array.isArray(record[key])) {
        return record[key] as unknown[];
      }
    }
  }
  return [];
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value.replace(",", "."));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function pickBoolean(record: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string" && /^(true|yes|1|sale|ja)$/i.test(value)) return true;
  }
  return false;
}

function normalizeUnit(raw: string | null): PackageAmount["unit"] | null {
  if (raw === null) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("ml") || lower === "l" || lower.includes("liter")) return "ml";
  if (lower.includes("kg") || lower.includes("gram") || lower === "g") return "gram";
  if (lower.includes("st") || lower.includes("piece") || lower.includes("stück")) return "piece";
  return null;
}

export function normalizeProduct(raw: unknown): ProductCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const name = pickString(record, ["name", "title", "productName", "product_name"]);
  const productId = pickString(record, ["id", "productId", "product_id", "slug", "code"]);
  const price = pickNumber(record, ["price", "priceVat", "unitPrice", "salesPrice", "currentPrice"]);
  if (name === null || productId === null || price === null) return null;
  const parsed = parsePackageAmount(name);
  const explicitAmount = pickNumber(record, ["amount", "unitAmount", "packageAmount", "content"]);
  const explicitUnit = normalizeUnit(
    pickString(record, ["unit", "unitAmountUnit", "contentUnit", "measureUnit"]),
  );
  const onDeal =
    pickBoolean(record, ["onSale", "onDeal", "isOnSale", "discounted", "promotion", "deal"]) ||
    pickNumber(record, ["discount", "discountPercent", "savings"]) !== null;
  return {
    productId,
    name,
    price,
    unitAmount: explicitAmount ?? parsed?.amount ?? null,
    unitAmountUnit: explicitUnit ?? parsed?.unit ?? null,
    onDeal,
  };
}

export async function createKnusprClient(): Promise<KnusprClient> {
  const transport = new StreamableHTTPClientTransport(new URL(config.knusprMcpUrl), {
    requestInit: {
      headers: {
        "rhl-email": config.knusprEmail,
        "rhl-pass": config.knusprPassword,
      },
    },
  });
  const mcp = new Client({ name: "grocery-bot", version: "1.0.0" });
  await mcp.connect(transport);

  async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await mcp.callTool({ name, arguments: args });
    if ((result as { isError?: boolean }).isError) {
      throw new Error(`Knuspr MCP Fehler bei ${name}.`);
    }
    return extractJsonPayload(textFromResult(result));
  }

  return {
    async searchProducts(keyword: string, limit = 10): Promise<ProductCandidate[]> {
      const payload = await callTool(TOOLS.search, { keyword, limit });
      return findProductArray(payload)
        .map(normalizeProduct)
        .filter((candidate): candidate is ProductCandidate => candidate !== null);
    },
    async addToCart(productId: string, amount: number): Promise<void> {
      const result = await mcp.callTool({
        name: TOOLS.addToCart,
        arguments: { items: [{ productId, quantity: amount }] },
      });
      if ((result as { isError?: boolean }).isError) {
        throw new Error("Knuspr MCP Fehler beim Hinzufügen zum Warenkorb.");
      }
    },
    async close(): Promise<void> {
      await mcp.close();
    },
  };
}
```

### `scripts/knuspr-check.ts`

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { config } from "../src/config";

async function main(): Promise<void> {
  const transport = new StreamableHTTPClientTransport(new URL(config.knusprMcpUrl), {
    requestInit: {
      headers: {
        "rhl-email": config.knusprEmail,
        "rhl-pass": config.knusprPassword,
      },
    },
  });
  const client = new Client({ name: "grocery-bot-check", version: "1.0.0" });
  await client.connect(transport);
  const tools = await client.listTools();
  console.log(JSON.stringify(tools, null, 2));
  await client.close();
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

Verification: `ls src/knuspr/client.ts scripts/knuspr-check.ts` → both listed.

---

## Step 5 — Planning (LLM)

### `src/planning/selector.ts`

```ts
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
```

### `src/planning/extract.ts`

```ts
import { z } from "zod";
import { UNITS } from "../units";
import { completeJson } from "../llm/json";
import type { ChatMessage, LlmClient } from "../llm/types";

const IngredientSchema = z.object({
  ingredientId: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.enum(UNITS),
  altGroup: z.string().nullable().default(null),
});

const RecipeSchema = z.object({
  title: z.string().min(1),
  tags: z.array(z.string()).default([]),
  ingredients: z.array(IngredientSchema).min(1),
});

export type ExtractedRecipe = z.infer<typeof RecipeSchema>;

export async function extractRecipe(llm: LlmClient, text: string): Promise<ExtractedRecipe> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "Du extrahierst Rezepte aus deutschen Beschreibungen. ingredientId ist ein kebab-case deutscher Zutatenname. Antworte NUR mit JSON.",
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
        quantity: z.number().positive(),
        unit: z.enum(UNITS),
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
        "Du extrahierst eine Grundsortiment-Liste aus deutschen Beschreibungen. Antworte NUR mit JSON.",
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
```

Verification: `ls src/planning/selector.ts src/planning/extract.ts` → both listed.

---

## Step 6 — Cart assembly

### `src/cart/assemble.ts`

```ts
import type { LlmClient } from "../llm/types";
import type { KnusprClient, ProductCandidate } from "../knuspr/client";
import { aggregateIngredients, groupAlternatives } from "../mapping/aggregate";
import { filterCandidates, pickBestMatch } from "../mapping/match";
import { roundUpToPackages } from "../mapping/quantity";
import { slugify } from "../util/slug";
import type { Unit } from "../units";
import type { BaseItem, DontBuyItem, RecipeIngredient, RecipeWithIngredients } from "../db/repo";

export interface CartLine {
  ingredientId: string;
  product: ProductCandidate;
  amount: number;
  source: "recipe" | "base";
  isGuess: boolean;
}

export interface BlockedLine {
  ingredientId: string;
  reason: "dont_buy" | "no_match";
}

export interface CartResult {
  lines: CartLine[];
  blocked: BlockedLine[];
}

interface ChosenNeed {
  ingredientId: string;
  quantity: number;
  unit: Unit;
  source: "recipe" | "base";
}

export async function assembleCart(
  llm: LlmClient,
  knuspr: KnusprClient,
  recipes: RecipeWithIngredients[],
  baseItems: BaseItem[],
  dontBuy: DontBuyItem[],
): Promise<CartResult> {
  const { mandatory, groups } = groupAlternatives(
    recipes.map((recipe) => ({ id: recipe.id, ingredients: recipe.ingredients })),
  );

  const chosen: ChosenNeed[] = [
    ...mandatory.map((ingredient) => ({
      ingredientId: ingredient.ingredientId,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      source: "recipe" as const,
    })),
    ...baseItems.map((item) => ({
      ingredientId: slugify(item.name),
      quantity: item.quantity,
      unit: item.unit,
      source: "base" as const,
    })),
  ];

  const blocked: BlockedLine[] = [];
  const rawCache = new Map<string, ProductCandidate[]>();
  const productCache = new Map<string, { product: ProductCandidate; isGuess: boolean }>();

  async function rawCandidates(ingredientId: string): Promise<ProductCandidate[]> {
    const cached = rawCache.get(ingredientId);
    if (cached) return cached;
    const keyword = ingredientId.replace(/-/g, " ");
    const fetched = await knuspr.searchProducts(keyword, 10);
    rawCache.set(ingredientId, fetched);
    return fetched;
  }

  async function allowedCandidates(ingredientId: string): Promise<ProductCandidate[]> {
    return filterCandidates(await rawCandidates(ingredientId), dontBuy);
  }

  function recordBlock(ingredientId: string, raw: ProductCandidate[]): void {
    if (blocked.some((entry) => entry.ingredientId === ingredientId)) return;
    blocked.push({ ingredientId, reason: raw.length === 0 ? "no_match" : "dont_buy" });
  }

  for (const group of groups) {
    let winner: {
      ingredient: RecipeIngredient;
      product: ProductCandidate;
      isGuess: boolean;
      total: number;
    } | null = null;
    for (const variant of group.variants) {
      const candidates = await allowedCandidates(variant.ingredientId);
      if (candidates.length === 0) continue;
      const match = await pickBestMatch(llm, variant.ingredientId, candidates);
      if (!match) continue;
      const amount = roundUpToPackages(
        { quantity: variant.quantity, unit: variant.unit },
        match.product,
      );
      const total = match.product.price * amount;
      if (!winner || total < winner.total) {
        winner = { ingredient: variant, product: match.product, isGuess: match.isGuess, total };
      }
    }
    if (!winner) {
      const first = group.variants[0];
      if (first) {
        recordBlock(first.ingredientId, await rawCandidates(first.ingredientId));
      }
      continue;
    }
    chosen.push({
      ingredientId: winner.ingredient.ingredientId,
      quantity: winner.ingredient.quantity,
      unit: winner.ingredient.unit,
      source: "recipe",
    });
    productCache.set(winner.ingredient.ingredientId, {
      product: winner.product,
      isGuess: winner.isGuess,
    });
  }

  const needLines = aggregateIngredients(chosen);
  const lines: CartLine[] = [];

  for (const need of needLines) {
    let entry = productCache.get(need.ingredientId) ?? null;
    if (!entry) {
      const candidates = await allowedCandidates(need.ingredientId);
      if (candidates.length === 0) {
        recordBlock(need.ingredientId, await rawCandidates(need.ingredientId));
        continue;
      }
      entry = await pickBestMatch(llm, need.ingredientId, candidates);
      if (!entry) {
        recordBlock(need.ingredientId, await rawCandidates(need.ingredientId));
        continue;
      }
    }
    const amount = roundUpToPackages(need, entry.product);
    const source = chosen.find((item) => item.ingredientId === need.ingredientId)?.source ?? "recipe";
    lines.push({
      ingredientId: need.ingredientId,
      product: entry.product,
      amount,
      source,
      isGuess: entry.isGuess,
    });
    await knuspr.addToCart(entry.product.productId, amount);
  }

  return { lines, blocked };
}
```

Verification: `ls src/cart/assemble.ts` → listed.

---

## Step 7 — Bot

### `src/bot/access.ts`

```ts
import type { Context, NextFunction } from "grammy";
import { config } from "../config";

export async function requireAllowedChat(ctx: Context, next: NextFunction): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined || !config.allowedChatIds.includes(String(chatId))) {
    return;
  }
  await next();
}
```

### `src/bot/state.ts`

```ts
import type { RecipeWithIngredients } from "../db/repo";

export type Pending =
  | {
      kind: "start";
      step: "confirm" | "feedback";
      mealCount: number;
      recipes: RecipeWithIngredients[];
    }
  | { kind: "add_recipe"; step: "describe" }
  | { kind: "edit_recipe"; step: "describe"; recipeId: string }
  | { kind: "edit_base"; step: "describe" }
  | { kind: "add_dont_buy"; step: "describe" }
  | { kind: "confirm_change"; summary: string; apply: () => void | Promise<void> };

const pending = new Map<string, Pending>();

export function setPending(chatId: number | string, value: Pending): void {
  pending.set(String(chatId), value);
}

export function getPending(chatId: number | string): Pending | undefined {
  return pending.get(String(chatId));
}

export function clearPending(chatId: number | string): void {
  pending.delete(String(chatId));
}
```

### `src/bot/nl.ts`

```ts
import { z } from "zod";
import { completeJson } from "../llm/json";
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
  argument: z.string().nullable().default(null),
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
```

### `src/bot/format.ts`

```ts
import type { CartResult } from "../cart/assemble";
import type { RecipeWithIngredients } from "../db/repo";

export function formatRecipeList(recipes: RecipeWithIngredients[]): string {
  return recipes
    .map((recipe, index) => `${index + 1}. ${recipe.title} [${recipe.tags.join(", ")}]`)
    .join("\n");
}

export function formatCartResult(result: CartResult): string {
  const lines = result.lines
    .map(
      (line) =>
        `- ${line.amount} × ${line.product.name} – ${(line.product.price * line.amount).toFixed(2)} €${
          line.product.onDeal ? " (Angebot)" : ""
        }${line.isGuess ? " (Ersatzprodukt)" : ""}${
          line.source === "base" ? " [Grundsortiment]" : ""
        }`,
    )
    .join("\n");
  const blocked = result.blocked
    .map(
      (entry) =>
        `- ${entry.ingredientId.replace(/-/g, " ")} ${
          entry.reason === "dont_buy"
            ? "(steht auf der Nicht-kaufen-Liste)"
            : "(kein passendes Produkt gefunden)"
        }`,
    )
    .join("\n");
  const total = result.lines.reduce(
    (sum, line) => sum + line.product.price * line.amount,
    0,
  );
  const parts = [
    "🛒 Dein Warenkorb wurde zusammengestellt:",
    "",
    lines.length > 0 ? lines : "(leer)",
    "",
    `Gesamtsumme: ${total.toFixed(2)} €`,
  ];
  if (blocked.length > 0) {
    parts.push("", "⚠️ Nicht hinzugefügt:", blocked);
  }
  parts.push(
    "",
    "Bitte prüfe den Warenkorb im Knuspr-Shop und schließe die Bestellung dort ab.",
  );
  return parts.join("\n");
}
```

### `src/bot/commands.ts`

```ts
import { Bot, InlineKeyboard, type Context } from "grammy";
import { createKnusprClient } from "../knuspr/client";
import type { LlmClient } from "../llm/types";
import { assembleCart } from "../cart/assemble";
import {
  addDontBuy,
  createRecipe,
  deleteRecipe,
  findDontBuyByName,
  getRecipe,
  getRecipeByTitle,
  listBaseItems,
  listDontBuy,
  listRecipes,
  removeDontBuy,
  replaceBaseItems,
  updateRecipe,
  type RecipeWithIngredients,
} from "../db/repo";
import { extractBaseItems, extractRecipe } from "../planning/extract";
import { selectRecipes } from "../planning/selector";
import { routeIntent } from "./nl";
import { clearPending, getPending, setPending, type Pending } from "./state";
import { formatCartResult, formatRecipeList } from "./format";

const HELP_TEXT = [
  "Verfügbare Befehle:",
  "/start <Anzahl> – Wochenplan erstellen und Warenkorb zusammenstellen",
  "/add_recipe – Rezept hinzufügen (natürliche Sprache)",
  "/edit_recipe <Name> – Rezept bearbeiten",
  "/remove_recipe <Name> – Rezept entfernen",
  "/edit_base – Grundsortiment bearbeiten",
  "/add_dont_buy <Produkt> – Produkt zur Nicht-kaufen-Liste hinzufügen",
  "/remove_dont_buy <Produkt> – Produkt von der Nicht-kaufen-Liste entfernen",
  "/list_dont_buy – Nicht-kaufen-Liste anzeigen",
  "/help – Diese Hilfe",
  "",
  "Alle Befehle funktionieren auch in natürlicher Sprache.",
].join("\n");

function confirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("✅ Speichern", "confirm").text("❌ Abbrechen", "cancel");
}

function selectionKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Übernehmen", "confirm")
    .text("✏️ Ändern", "start_change")
    .text("❌ Abbrechen", "cancel");
}

function chatIdOf(ctx: Context): number | undefined {
  return ctx.chat?.id;
}

export function registerCommandHandlers(bot: Bot, llm: LlmClient): void {
  bot.command("help", async (ctx) => {
    await ctx.reply(HELP_TEXT);
  });

  bot.command("list_dont_buy", async (ctx) => {
    const items = listDontBuy();
    await ctx.reply(
      items.length === 0
        ? "Die Nicht-kaufen-Liste ist leer."
        : "Nicht kaufen:\n" + items.map((item) => `- ${item.name}`).join("\n"),
    );
  });

  bot.command("add_dont_buy", async (ctx) => {
    const chatId = chatIdOf(ctx);
    if (chatId === undefined) return;
    const name = (ctx.match ?? "").trim();
    if (name.length > 0) {
      await proposeDontBuy(ctx, chatId, name);
      return;
    }
    setPending(chatId, { kind: "add_dont_buy", step: "describe" });
    await ctx.reply("Welches Produkt soll nie in den Warenkorb?");
  });

  bot.command("remove_dont_buy", async (ctx) => {
    const chatId = chatIdOf(ctx);
    if (chatId === undefined) return;
    const name = (ctx.match ?? "").trim();
    if (name.length === 0) {
      await ctx.reply("Bitte so verwenden: /remove_dont_buy <Produkt>");
      return;
    }
    const item = findDontBuyByName(name);
    if (!item) {
      await ctx.reply(`"${name}" steht nicht auf der Nicht-kaufen-Liste.`);
      return;
    }
    setPending(chatId, {
      kind: "confirm_change",
      summary: `"${item.name}" entfernen?`,
      apply: () => {
        removeDontBuy(item.id);
      },
    });
    await ctx.reply(`"${item.name}" von der Nicht-kaufen-Liste entfernen?`, {
      reply_markup: confirmKeyboard(),
    });
  });

  bot.command("remove_recipe", async (ctx) => {
    const chatId = chatIdOf(ctx);
    if (chatId === undefined) return;
    const name = (ctx.match ?? "").trim();
    const recipe = name.length > 0 ? getRecipeByTitle(name) : undefined;
    if (!recipe) {
      await ctx.reply("Bitte so verwenden: /remove_recipe <Rezeptname>");
      return;
    }
    await proposeRemoveRecipe(ctx, chatId, recipe.id, recipe.title);
  });

  bot.command("add_recipe", async (ctx) => {
    const chatId = chatIdOf(ctx);
    if (chatId === undefined) return;
    setPending(chatId, { kind: "add_recipe", step: "describe" });
    await ctx.reply(
      "Beschreibe das Rezept (Titel, Tags, Zutaten mit Mengen). Alternativen wie Garnelen oder Hähnchen kannst du angeben.",
    );
  });

  bot.command("edit_recipe", async (ctx) => {
    const chatId = chatIdOf(ctx);
    if (chatId === undefined) return;
    const name = (ctx.match ?? "").trim();
    const recipe = name.length > 0 ? getRecipeByTitle(name) : undefined;
    if (!recipe) {
      await ctx.reply("Bitte so verwenden: /edit_recipe <Rezeptname>");
      return;
    }
    setPending(chatId, { kind: "edit_recipe", step: "describe", recipeId: recipe.id });
    await ctx.reply(`Beschreibe die neue Version von "${recipe.title}".`);
  });

  bot.command("edit_base", async (ctx) => {
    const chatId = chatIdOf(ctx);
    if (chatId === undefined) return;
    setPending(chatId, { kind: "edit_base", step: "describe" });
    await ctx.reply("Beschreibe das neue Grundsortiment (z. B. Milch, Brot, Eier).");
  });

  bot.command("start", async (ctx) => {
    const count = Number.parseInt((ctx.match ?? "").trim(), 10);
    if (!Number.isInteger(count) || count < 1) {
      await ctx.reply("Bitte so verwenden: /start <Anzahl der Mahlzeiten>, z. B. /start 5");
      return;
    }
    await beginStart(ctx, llm, count);
  });

  bot.callbackQuery("confirm", async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = chatIdOf(ctx);
    if (chatId === undefined) return;
    const current = getPending(chatId);
    if (!current) {
      await ctx.reply("Es gibt nichts zu bestätigen.");
      return;
    }
    if (current.kind === "confirm_change") {
      await current.apply();
      clearPending(chatId);
      await ctx.reply("Erledigt.");
      return;
    }
    if (current.kind === "start") {
      await runCart(ctx, llm, current.recipes);
      return;
    }
    await ctx.reply("Es gibt nichts zu bestätigen.");
  });

  bot.callbackQuery("cancel", async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = chatIdOf(ctx);
    if (chatId === undefined) return;
    clearPending(chatId);
    await ctx.reply("Abgebrochen.");
  });

  bot.callbackQuery("start_change", async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = chatIdOf(ctx);
    if (chatId === undefined) return;
    const current = getPending(chatId);
    if (!current || current.kind !== "start") {
      await ctx.reply("Es gibt nichts zu ändern.");
      return;
    }
    setPending(chatId, { ...current, step: "feedback" });
    await ctx.reply("Was möchtest du ändern?");
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.msg?.text;
    if (!text) return;
    await handleText(ctx, llm, text);
  });
}

async function beginStart(ctx: Context, llm: LlmClient, count: number): Promise<void> {
  const chatId = chatIdOf(ctx);
  if (chatId === undefined) return;
  const pool = listRecipes();
  if (pool.length === 0) {
    await ctx.reply("Es sind noch keine Rezepte vorhanden. Bitte zuerst /add_recipe nutzen.");
    return;
  }
  const recipeIds = await selectRecipes(llm, pool, Math.min(count, pool.length));
  const recipes = recipeIds
    .map((id) => getRecipe(id))
    .filter((recipe): recipe is RecipeWithIngredients => Boolean(recipe));
  setPending(chatId, { kind: "start", step: "confirm", mealCount: count, recipes });
  await ctx.reply(`Vorschlag für ${recipes.length} Mahlzeiten:\n\n${formatRecipeList(recipes)}`, {
    reply_markup: selectionKeyboard(),
  });
}

async function runCart(
  ctx: Context,
  llm: LlmClient,
  recipes: RecipeWithIngredients[],
): Promise<void> {
  const chatId = chatIdOf(ctx);
  if (chatId === undefined) return;
  clearPending(chatId);
  await ctx.reply("Ich suche passende Produkte und stelle den Warenkorb zusammen …");
  const knuspr = await createKnusprClient();
  try {
    const result = await assembleCart(llm, knuspr, recipes, listBaseItems(), listDontBuy());
    await ctx.reply(formatCartResult(result));
  } finally {
    await knuspr.close().catch(() => undefined);
  }
}

async function proposeDontBuy(ctx: Context, chatId: number, name: string): Promise<void> {
  setPending(chatId, {
    kind: "confirm_change",
    summary: `"${name}" hinzufügen?`,
    apply: () => {
      addDontBuy(name, null);
    },
  });
  await ctx.reply(`"${name}" zur Nicht-kaufen-Liste hinzufügen?`, {
    reply_markup: confirmKeyboard(),
  });
}

async function proposeRemoveRecipe(
  ctx: Context,
  chatId: number,
  recipeId: string,
  title: string,
): Promise<void> {
  setPending(chatId, {
    kind: "confirm_change",
    summary: `Rezept "${title}" entfernen?`,
    apply: () => {
      deleteRecipe(recipeId);
    },
  });
  await ctx.reply(`Rezept "${title}" entfernen?`, { reply_markup: confirmKeyboard() });
}

async function handleText(ctx: Context, llm: LlmClient, text: string): Promise<void> {
  const chatId = chatIdOf(ctx);
  if (chatId === undefined) return;
  const current = getPending(chatId);
  if (current) {
    await handlePendingText(ctx, chatId, llm, current, text);
    return;
  }
  const { intent, argument } = await routeIntent(llm, text);
  await dispatchIntent(ctx, chatId, llm, intent, argument, text);
}

async function handlePendingText(
  ctx: Context,
  chatId: number,
  llm: LlmClient,
  pending: Pending,
  text: string,
): Promise<void> {
  if (pending.kind === "start" && pending.step === "feedback") {
    const pool = listRecipes();
    const previous = pending.recipes.map((recipe) => recipe.id);
    const recipeIds = await selectRecipes(
      llm,
      pool,
      Math.min(pending.mealCount, pool.length),
      previous,
      text,
    );
    const recipes = recipeIds
      .map((id) => getRecipe(id))
      .filter((recipe): recipe is RecipeWithIngredients => Boolean(recipe));
    setPending(chatId, {
      kind: "start",
      step: "confirm",
      mealCount: pending.mealCount,
      recipes,
    });
    await ctx.reply(`Neuer Vorschlag:\n\n${formatRecipeList(recipes)}`, {
      reply_markup: selectionKeyboard(),
    });
    return;
  }
  if (pending.kind === "add_recipe" && pending.step === "describe") {
    const recipe = await extractRecipe(llm, text);
    setPending(chatId, {
      kind: "confirm_change",
      summary: `Rezept "${recipe.title}" speichern?`,
      apply: () => {
        createRecipe(recipe.title, recipe.tags, recipe.ingredients);
      },
    });
    await ctx.reply(
      `Rezept "${recipe.title}" speichern?\nTags: ${recipe.tags.join(", ") || "–"}\nZutaten: ${
        recipe.ingredients.length
      }`,
      { reply_markup: confirmKeyboard() },
    );
    return;
  }
  if (pending.kind === "edit_recipe" && pending.step === "describe") {
    const recipe = await extractRecipe(llm, text);
    setPending(chatId, {
      kind: "confirm_change",
      summary: `Rezept "${recipe.title}" aktualisieren?`,
      apply: () => {
        updateRecipe(pending.recipeId, recipe.title, recipe.tags, recipe.ingredients);
      },
    });
    await ctx.reply(`Rezept "${recipe.title}" aktualisieren?`, {
      reply_markup: confirmKeyboard(),
    });
    return;
  }
  if (pending.kind === "edit_base" && pending.step === "describe") {
    const base = await extractBaseItems(llm, text);
    setPending(chatId, {
      kind: "confirm_change",
      summary: "Grundsortiment aktualisieren?",
      apply: () => {
        replaceBaseItems(base.items);
      },
    });
    await ctx.reply(`Grundsortiment mit ${base.items.length} Einträgen aktualisieren?`, {
      reply_markup: confirmKeyboard(),
    });
    return;
  }
  if (pending.kind === "add_dont_buy" && pending.step === "describe") {
    await proposeDontBuy(ctx, chatId, text.trim());
    return;
  }
  await ctx.reply("Bitte nutze die Buttons oder /help.");
}

async function dispatchIntent(
  ctx: Context,
  chatId: number,
  llm: LlmClient,
  intent: string,
  argument: string | null,
  text: string,
): Promise<void> {
  switch (intent) {
    case "start": {
      const count = Number.parseInt(argument ?? text, 10);
      if (!Number.isInteger(count) || count < 1) {
        await ctx.reply("Wie viele Mahlzeiten? Bitte z. B. /start 5.");
        return;
      }
      await beginStart(ctx, llm, count);
      return;
    }
    case "add_recipe":
      setPending(chatId, { kind: "add_recipe", step: "describe" });
      await ctx.reply("Beschreibe das Rezept.");
      return;
    case "edit_recipe": {
      const recipe = argument ? getRecipeByTitle(argument) : undefined;
      if (!recipe) {
        await ctx.reply("Welches Rezept möchtest du bearbeiten? Bitte Namen angeben.");
        return;
      }
      setPending(chatId, { kind: "edit_recipe", step: "describe", recipeId: recipe.id });
      await ctx.reply(`Beschreibe die neue Version von "${recipe.title}".`);
      return;
    }
    case "remove_recipe": {
      const recipe = argument ? getRecipeByTitle(argument) : undefined;
      if (!recipe) {
        await ctx.reply("Welches Rezept soll entfernt werden? Bitte Namen angeben.");
        return;
      }
      await proposeRemoveRecipe(ctx, chatId, recipe.id, recipe.title);
      return;
    }
    case "edit_base":
      setPending(chatId, { kind: "edit_base", step: "describe" });
      await ctx.reply("Beschreibe das neue Grundsortiment.");
      return;
    case "add_dont_buy":
      if (argument) {
        await proposeDontBuy(ctx, chatId, argument);
        return;
      }
      setPending(chatId, { kind: "add_dont_buy", step: "describe" });
      await ctx.reply("Welches Produkt soll nie in den Warenkorb?");
      return;
    case "remove_dont_buy": {
      const item = argument ? findDontBuyByName(argument) : undefined;
      if (!item) {
        await ctx.reply("Welches Produkt soll von der Nicht-kaufen-Liste entfernt werden?");
        return;
      }
      setPending(chatId, {
        kind: "confirm_change",
        summary: `"${item.name}" entfernen?`,
        apply: () => {
          removeDontBuy(item.id);
        },
      });
      await ctx.reply(`"${item.name}" von der Nicht-kaufen-Liste entfernen?`, {
        reply_markup: confirmKeyboard(),
      });
      return;
    }
    case "list_dont_buy": {
      const items = listDontBuy();
      await ctx.reply(
        items.length === 0
          ? "Die Nicht-kaufen-Liste ist leer."
          : items.map((item) => `- ${item.name}`).join("\n"),
      );
      return;
    }
    case "help":
      await ctx.reply(HELP_TEXT);
      return;
    default:
      await ctx.reply("Das habe ich nicht verstanden. Nutze /help für alle Befehle.");
  }
}
```

### `src/bot/index.ts`

```ts
import { Bot } from "grammy";
import { config } from "../config";
import { migrate } from "../db/index";
import { createLlmClient } from "../llm/client";
import { requireAllowedChat } from "./access";
import { registerCommandHandlers } from "./commands";

async function main(): Promise<void> {
  migrate();
  const bot = new Bot(config.telegramBotToken);
  bot.use(requireAllowedChat);
  const llm = createLlmClient();
  registerCommandHandlers(bot, llm);
  bot.catch((error) => {
    console.error("Bot-Fehler:", error.error);
    void error.ctx
      .reply("Es ist ein Fehler aufgetreten. Bitte versuche es erneut.")
      .catch(() => undefined);
  });
  await bot.api.setMyCommands([
    { command: "start", description: "Wochenplan und Warenkorb erstellen" },
    { command: "add_recipe", description: "Rezept hinzufügen" },
    { command: "edit_recipe", description: "Rezept bearbeiten" },
    { command: "remove_recipe", description: "Rezept entfernen" },
    { command: "edit_base", description: "Grundsortiment bearbeiten" },
    { command: "add_dont_buy", description: "Produkt zur Nicht-kaufen-Liste hinzufügen" },
    { command: "remove_dont_buy", description: "Produkt von der Nicht-kaufen-Liste entfernen" },
    { command: "list_dont_buy", description: "Nicht-kaufen-Liste anzeigen" },
    { command: "help", description: "Hilfe anzeigen" },
  ]);
  console.log("Grocery-Bot läuft.");
  await bot.start();
}

void main().catch((error) => {
  console.error("Startfehler:", error);
  process.exit(1);
});
```

Verification: `ls src/bot/access.ts src/bot/state.ts src/bot/nl.ts src/bot/format.ts src/bot/commands.ts src/bot/index.ts` → all listed.

---

## Step 8 — Tests (vitest)

### `test/units.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { convertClovesToPieces, isCountable, isUnit } from "../src/units";

describe("units", () => {
  it("accepts only known units", () => {
    expect(isUnit("gram")).toBe(true);
    expect(isUnit("ounce")).toBe(false);
    expect(isUnit(42)).toBe(false);
  });

  it("marks countable units", () => {
    expect(isCountable("piece")).toBe(true);
    expect(isCountable("clove")).toBe(true);
    expect(isCountable("package")).toBe(true);
    expect(isCountable("gram")).toBe(false);
    expect(isCountable("ml")).toBe(false);
  });

  it("converts cloves to pieces", () => {
    expect(convertClovesToPieces(3, "clove")).toEqual({ quantity: 3, unit: "piece" });
    expect(convertClovesToPieces(500, "gram")).toEqual({ quantity: 500, unit: "gram" });
  });
});
```

### `test/quantity.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { parsePackageAmount, roundUpToPackages } from "../src/mapping/quantity";

describe("parsePackageAmount", () => {
  it("parses grams", () => {
    expect(parsePackageAmount("Basmatireis 500 g")).toEqual({ amount: 500, unit: "gram" });
    expect(parsePackageAmount("Mehl 1kg")).toEqual({ amount: 1000, unit: "gram" });
  });

  it("parses volume", () => {
    expect(parsePackageAmount("Vollmilch 1,5 l")).toEqual({ amount: 1500, unit: "ml" });
    expect(parsePackageAmount("Saft 500ml")).toEqual({ amount: 500, unit: "ml" });
  });

  it("parses pieces", () => {
    expect(parsePackageAmount("Eier 6 Stk")).toEqual({ amount: 6, unit: "piece" });
  });

  it("parses multipacks", () => {
    expect(parsePackageAmount("Joghurt 4x125g")).toEqual({ amount: 500, unit: "gram" });
  });

  it("returns null when nothing is parseable", () => {
    expect(parsePackageAmount("Bananen")).toBeNull();
  });
});

describe("roundUpToPackages", () => {
  const product = (overrides: Partial<{ unitAmount: number | null; unitAmountUnit: "gram" | "ml" | "piece" | null }> = {}) => ({
    unitAmount: 500 as number | null,
    unitAmountUnit: "gram" as "gram" | "ml" | "piece" | null,
    ...overrides,
  });

  it("rounds weight up to package multiples", () => {
    expect(roundUpToPackages({ quantity: 700, unit: "gram" }, product())).toBe(2);
    expect(roundUpToPackages({ quantity: 500, unit: "gram" }, product())).toBe(1);
  });

  it("rounds countable needs up to whole items", () => {
    expect(
      roundUpToPackages({ quantity: 2.2, unit: "piece" }, product({ unitAmount: null, unitAmountUnit: null })),
    ).toBe(3);
  });

  it("falls back to one package when size is unknown", () => {
    expect(
      roundUpToPackages({ quantity: 300, unit: "gram" }, product({ unitAmount: null, unitAmountUnit: null })),
    ).toBe(300);
  });
});
```

### `test/aggregate.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { aggregateIngredients, groupAlternatives } from "../src/mapping/aggregate";
import type { RecipeIngredient } from "../src/db/repo";

function ingredient(overrides: Partial<RecipeIngredient>): RecipeIngredient {
  return {
    id: "i",
    recipeId: "r1",
    ingredientId: "x",
    quantity: 1,
    unit: "piece",
    altGroup: null,
    ...overrides,
  };
}

describe("aggregateIngredients", () => {
  it("aggregates across recipes", () => {
    expect(
      aggregateIngredients([
        { ingredientId: "zwiebel", quantity: 1, unit: "piece" },
        { ingredientId: "zwiebel", quantity: 2, unit: "piece" },
        { ingredientId: "reis", quantity: 300, unit: "gram" },
      ]),
    ).toEqual([
      { ingredientId: "reis", quantity: 300, unit: "gram" },
      { ingredientId: "zwiebel", quantity: 3, unit: "piece" },
    ]);
  });

  it("converts cloves and keeps mixed units separate", () => {
    expect(
      aggregateIngredients([
        { ingredientId: "knoblauch", quantity: 3, unit: "clove" },
        { ingredientId: "knoblauch", quantity: 1, unit: "piece" },
        { ingredientId: "knoblauch", quantity: 50, unit: "gram" },
      ]),
    ).toEqual([
      { ingredientId: "knoblauch", quantity: 50, unit: "gram" },
      { ingredientId: "knoblauch", quantity: 4, unit: "piece" },
    ]);
  });
});

describe("groupAlternatives", () => {
  it("separates mandatory ingredients from interchangeable groups", () => {
    const recipes = [
      {
        id: "r1",
        ingredients: [
          ingredient({ id: "i1", ingredientId: "garnelen", quantity: 300, unit: "gram", altGroup: "protein" }),
          ingredient({ id: "i2", ingredientId: "haehnchen", quantity: 400, unit: "gram", altGroup: "protein" }),
          ingredient({ id: "i3", ingredientId: "reis", quantity: 200, unit: "gram", altGroup: null }),
        ],
      },
    ];
    const { mandatory, groups } = groupAlternatives(recipes);
    expect(mandatory.map((entry) => entry.ingredientId)).toEqual(["reis"]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.variants.map((entry) => entry.ingredientId)).toEqual(["garnelen", "haehnchen"]);
  });
});
```

### `test/match.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { bestByPrice, filterCandidates, isBlocked, pickBestMatch } from "../src/mapping/match";
import type { ProductCandidate } from "../src/knuspr/client";
import type { DontBuyItem } from "../src/db/repo";
import type { LlmClient } from "../src/llm/types";

function product(overrides: Partial<ProductCandidate>): ProductCandidate {
  return {
    productId: "p",
    name: "Produkt",
    price: 1,
    unitAmount: null,
    unitAmountUnit: null,
    onDeal: false,
    ...overrides,
  };
}

const llmReturning = (text: string): LlmClient => ({ complete: async () => text });

describe("dont-buy filtering", () => {
  it("blocks by product id and by exact name", () => {
    const dontBuy: DontBuyItem[] = [
      { id: 1, knusprProductId: "p1", name: "Egal" },
      { id: 2, knusprProductId: null, name: "Billig-Cola" },
    ];
    expect(isBlocked(product({ productId: "p1" }), dontBuy)).toBe(true);
    expect(isBlocked(product({ productId: "p9", name: "billig-cola" }), dontBuy)).toBe(true);
    expect(isBlocked(product({ productId: "p9", name: "Wasser" }), dontBuy)).toBe(false);
    expect(filterCandidates([product({ productId: "p1" }), product({ productId: "p2" })], dontBuy)).toHaveLength(1);
  });
});

describe("bestByPrice", () => {
  it("prefers deals, then the cheapest price", () => {
    const cheap = product({ productId: "cheap", price: 1 });
    const deal = product({ productId: "deal", price: 2, onDeal: true });
    expect(bestByPrice([cheap, deal])?.productId).toBe("deal");
    expect(bestByPrice([cheap, product({ productId: "expensive", price: 3 })])?.productId).toBe("cheap");
    expect(bestByPrice([])).toBeNull();
  });
});

describe("pickBestMatch", () => {
  it("returns the single candidate without asking the LLM", async () => {
    const only = product({ productId: "only" });
    const result = await pickBestMatch(llmReturning("{}"), "reis", [only]);
    expect(result?.product.productId).toBe("only");
    expect(result?.isGuess).toBe(false);
  });

  it("uses a valid LLM pick", async () => {
    const llm = llmReturning('{"productId": "b"}');
    const candidates = [product({ productId: "a", price: 1 }), product({ productId: "b", price: 2 })];
    const result = await pickBestMatch(llm, "reis", candidates);
    expect(result?.product.productId).toBe("b");
    expect(result?.isGuess).toBe(false);
  });

  it("falls back to the cheapest candidate on an invalid LLM pick", async () => {
    const llm = llmReturning('{"productId": "does-not-exist"}');
    const candidates = [product({ productId: "a", price: 1 }), product({ productId: "b", price: 2 })];
    const result = await pickBestMatch(llm, "reis", candidates);
    expect(result?.product.productId).toBe("a");
    expect(result?.isGuess).toBe(true);
  });
});
```

### `test/selector.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { selectRecipes } from "../src/planning/selector";
import type { LlmClient } from "../src/llm/types";

const llmReturning = (text: string): LlmClient => ({ complete: async () => text });

const pool = [
  { id: "a", title: "A", tags: [] },
  { id: "b", title: "B", tags: [] },
  { id: "c", title: "C", tags: [] },
];

describe("selectRecipes", () => {
  it("filters ids that are not in the pool and de-duplicates", async () => {
    const llm = llmReturning('{"recipeIds": ["a", "zzz", "a", "b"]}');
    expect(await selectRecipes(llm, pool, 2)).toEqual(["a", "b"]);
  });

  it("throws when no valid id is returned", async () => {
    const llm = llmReturning('{"recipeIds": ["zzz"]}');
    await expect(selectRecipes(llm, pool, 1)).rejects.toThrow();
  });
});
```

### `test/nl.test.ts`

```ts
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
});
```

### `test/assemble.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { assembleCart } from "../src/cart/assemble";
import type { KnusprClient, ProductCandidate } from "../src/knuspr/client";
import type { BaseItem, DontBuyItem, RecipeWithIngredients } from "../src/db/repo";
import type { LlmClient } from "../src/llm/types";

const product = (overrides: Partial<ProductCandidate>): ProductCandidate => ({
  productId: "p",
  name: "Produkt",
  price: 1,
  unitAmount: null,
  unitAmountUnit: null,
  onDeal: false,
  ...overrides,
});

const llmPickingFirst: LlmClient = {
  async complete(messages) {
    const last = messages[messages.length - 1]?.content ?? "";
    const match = last.match(/-\s+([^:\s]+):/);
    return JSON.stringify({ productId: match?.[1] ?? "" });
  },
};

function fakeKnuspr(byKeyword: Record<string, ProductCandidate[]>): {
  client: KnusprClient;
  added: { productId: string; amount: number }[];
} {
  const added: { productId: string; amount: number }[] = [];
  const client: KnusprClient = {
    async searchProducts(keyword) {
      return byKeyword[keyword] ?? [];
    },
    async addToCart(productId, amount) {
      added.push({ productId, amount });
    },
    async close() {},
  };
  return { client, added };
}

const recipe: RecipeWithIngredients = {
  id: "r1",
  title: "Reis mit Zwiebeln",
  tags: ["test"],
  ingredients: [
    { id: "i1", recipeId: "r1", ingredientId: "zwiebel", quantity: 2, unit: "piece", altGroup: null },
    { id: "i2", recipeId: "r1", ingredientId: "reis", quantity: 300, unit: "gram", altGroup: null },
  ],
};

const baseItems: BaseItem[] = [
  { id: "b1", name: "Hafermilch", quantity: 2, unit: "package" },
];

describe("assembleCart", () => {
  it("maps, rounds and adds ingredients plus base items", async () => {
    const { client, added } = fakeKnuspr({
      zwiebel: [product({ productId: "p-zwiebel", name: "Zwiebeln 500 g", price: 1.29, unitAmount: 500, unitAmountUnit: "gram" })],
      reis: [product({ productId: "p-reis", name: "Basmatireis 500 g", price: 2.49, unitAmount: 500, unitAmountUnit: "gram" })],
      hafermilch: [product({ productId: "p-milch", name: "Hafermilch 1 l", price: 1.99, unitAmount: 1000, unitAmountUnit: "ml" })],
    });

    const result = await assembleCart(llmPickingFirst, client, [recipe], baseItems, []);

    expect(result.blocked).toEqual([]);
    expect(result.lines.map((line) => [line.ingredientId, line.amount])).toEqual([
      ["hafermilch", 2],
      ["reis", 1],
      ["zwiebel", 2],
    ]);
    expect(result.lines.every((line) => line.isGuess === false)).toBe(true);
    expect(added).toEqual([
      { productId: "p-milch", amount: 2 },
      { productId: "p-reis", amount: 1 },
      { productId: "p-zwiebel", amount: 2 },
    ]);
  });

  it("reports dont-buy blocks and adds nothing for them", async () => {
    const dontBuy: DontBuyItem[] = [{ id: 1, knusprProductId: "p-reis", name: "Basmatireis 500 g" }];
    const { client, added } = fakeKnuspr({
      zwiebel: [product({ productId: "p-zwiebel", name: "Zwiebeln 500 g", price: 1.29, unitAmount: 500, unitAmountUnit: "gram" })],
      reis: [product({ productId: "p-reis", name: "Basmatireis 500 g", price: 2.49, unitAmount: 500, unitAmountUnit: "gram" })],
      hafermilch: [product({ productId: "p-milch", name: "Hafermilch 1 l", price: 1.99, unitAmount: 1000, unitAmountUnit: "ml" })],
    });

    const result = await assembleCart(llmPickingFirst, client, [recipe], baseItems, dontBuy);

    expect(result.blocked).toContainEqual({ ingredientId: "reis", reason: "dont_buy" });
    expect(result.lines.some((line) => line.ingredientId === "reis")).toBe(false);
    expect(added.some((entry) => entry.productId === "p-reis")).toBe(false);
  });
});
```

Verification: `npm test` → 7 test files pass, 0 failures.

---

## Step 9 — Docker deployment

### `Dockerfile`

```dockerfile
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

RUN mkdir -p /app/data

CMD ["npx", "tsx", "src/bot/index.ts"]
```

### `docker-compose.yml`

```yaml
services:
  bot:
    build: .
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./data:/app/data
```

Verification: `ls Dockerfile docker-compose.yml` → both listed.

---

## Final verification (run in this order, read each output before the next)

1. `npm install` → exits 0; creates `node_modules` and `package-lock.json`.
2. `npm run typecheck` → exits 0, no output.
3. `npm test` → all test files pass (`Test Files 7 passed`, `Tests ... passed`), exit 0.
4. Developer-run (needs a real `.env`, not for CI; the executor skips these and
   reports them as unverified):
   - `npm run dev` → logs `Grocery-Bot läuft.` and stays running.
   - `npm run knuspr:check` → prints the MCP `tools/list` JSON. Confirm the
     tool names match `TOOLS` in `src/knuspr/client.ts`; if not, STOP and report
     to the planner.
   - `docker compose config` → exits 0, prints the `bot` service (requires an
     existing `.env`; compose validates `env_file`).
   - `docker compose up --build` → container logs `Grocery-Bot läuft.`

## Rollback / do not touch

- Never edit: `ARCHITECTURE.md`, `WORKFLOW.md`, `plans/*.md`.
- Never commit or create: `.env` (only `.env.example`), `data/`, `node_modules/`.
- Do not modify `plans/build-grocery-bot.sketch.md`.

## Edge cases and how to handle each

1. **MCP tool names/schema differ from evidence.** The tool names in `TOOLS`
   and the argument shapes (`{ keyword, limit }`, `{ items: [{ productId,
   quantity }] }`) come from public documentation/examples, not the live
   server. Run `npm run knuspr:check` with real credentials and compare
   `tools/list` (names + `inputSchema`). Adjust only `TOOLS`/`callTool`
   arguments in `src/knuspr/client.ts`. If the response shape is materially
   different (e.g. no parseable `name`/`price`/`id`), STOP and report to the
   planner — do not redesign `normalizeProduct`.
2. **Product price units.** If prices come back in cents (integers like `129`)
   or as formatted strings, `pickNumber`/`normalizeProduct` already accept
   numeric strings. If they arrive as objects (e.g. `{ amount, currency }`),
   that is a schema change → STOP and report.
3. **Telegram command names.** Telegram only allows `[a-z0-9_]` in slash
   commands, so hyphens from `ARCHITECTURE.md` (§Functions) are registered with
   underscores (`/add_recipe`, `/edit_recipe`, `/remove_recipe`,
   `/add_dont_buy`, `/remove_dont_buy`, `/list_dont_buy`). Natural language and
   the `routeIntent` router still accept the hyphenated wording.
4. **better-sqlite3 native build in Docker.** `node:22-slim` is Debian-based and
   better-sqlite3 ships prebuilt binaries, so `npm install` should not compile.
   If it does fail with `node-gyp`, add
   `RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*`
   before `npm install` and remove the build tools afterwards. This is the only
   permitted Dockerfile change.
5. **OpenAI-compatible providers without strict tool/JSON support.** The design
   only uses `chat.completions` with plain text and requires JSON in the
   response; `completeJson` strips markdown fences and retries once. If the
   configured model cannot return JSON even after retry, the bot sends the
   German error from `bot.catch` — do not add provider-specific code.
6. **Mixed units for one ingredient.** `aggregateIngredients` intentionally
   keeps `gram` and `piece` lines separate (over-buy safe). This is expected,
   not a bug.
7. **`clove` is only meaningful for garlic-like ingredients.** `clove → piece`
   is 1:1 per ADR 19; no other conversion exists.
8. **Duplicate recipe title.** `createRecipe` throws a German error; the
   `bot.catch` middleware reports a generic error. Do not silently overwrite.
9. **Tests must not need `.env`.** If a test fails because `src/config.ts`
   exited, the offending module imported config at runtime instead of
   `import type`. Fix the import; do not set dummy env values in tests.
10. **Package versions.** If a dependency version in `package.json` fails to
    resolve, run `npm view <package> version` and use the latest published
    version. Do not change any API usage to accommodate a version.
