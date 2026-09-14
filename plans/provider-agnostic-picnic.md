# Plan — provider-agnostic-grocery (add Picnic)

## Status: draft

Refactor the existing Knuspr-only bot into a delivery-provider-agnostic design and
add a Picnic adapter using the community MCP server
[`ivo-toby/mcp-picnic`](https://github.com/ivo-toby/mcp-picnic) (npm package
`mcp-picnic`, latest 1.15.1, MIT, unofficial). One provider is active at a time,
selected with `GROCERY_PROVIDER=knuspr|picnic` (default `knuspr`, fully
backward compatible).

Derived from the design discussion. The existing seam is already good: everything
outside `src/knuspr/client.ts` depends only on the `KnusprClient` interface
(`searchProducts` / `addToCart` / `close`) and the `ProductCandidate` type, so the
refactor is mostly moving files and renaming types. The only genuinely new logic is
the Picnic adapter and its response normalizer.

Amendments from the plan review (2026-09-14, verified against the live repo):

- `src/config.ts` normalizes blank env values to unset (`emptyToUndefined`):
  dotenv turns `KNUSPR_EMAIL=` into `""`, and `z.string().min(1).optional()` fails
  on `""` — a Picnic user leaving the Knuspr lines blank in `.env` would hit
  `exit(1)` without this.
- `mcp.connect(..., { timeout: 120_000 })` in the Picnic client and in
  `scripts/mcp-check.ts`: the SDK default request timeout is 60 s
  (`DEFAULT_REQUEST_TIMEOUT_MSEC = 60000`, verified in the installed SDK) and a
  cold `npx -y mcp-picnic@…` download can exceed it.
- Verification greps use `grep -rnE` with `\bKnusprClient\b` — `rg` is not
  installed here, and unanchored `KnusprClient` would false-positive on
  `createKnusprClient` in `src/grocery/knuspr.ts` / `src/grocery/index.ts`.
- `test/picnic.test.ts` now asserts a literal `"500 gr"` unit (the Picnic format
  the `gr` regex extension exists for); the draft only tested `"1 kg"`.
- Documented pre-existing behavior: `parsePackageAmount` has never matched
  spelled-out `"gram"` (regex needs a boundary after `g`) — unchanged here.
- Docker: `Dockerfile` / `docker-compose.yml` need no changes; `env_file` passes
  the new vars through, and the node image ships `npx`. The container needs
  network on the first Picnic run (see edge case 5).

Empirical claims re-verified during review: `PRAGMA table_info` via
`db.prepare(...).all()` works in better-sqlite3; `ALTER TABLE … RENAME COLUMN`
works (bundled SQLite 3.49.2); the guard is idempotent; the `gr` regex extension
matches `"500 gr"`/`"4x125gr"` without false positives; `getDefaultEnvironment()`
forwards `HOME`, `PATH` (and `LOGNAME`, `SHELL`, `TERM`, `USER`);
`Client.connect(transport, options?)` accepts `RequestOptions.timeout`.

## Goal

- Extract a provider-neutral contract (`GroceryClient`, `ProductCandidate`) and a
  factory `createGroceryClient()`.
- Keep the Knuspr adapter behavior byte-for-byte identical (HTTP transport,
  `rhl-*` headers, tool names, defensive normalization).
- Add a Picnic adapter (stdio transport, `picnic_search` + `picnic_add_to_cart`).
- Rename the DB column `dont_buy.knuspr_product_id` → `product_id` with a one-time,
  idempotent migration.
- Rename the dev check script to a provider-aware `mcp:check`.
- Keep `npm run typecheck` and `npm test` green; tests must not need `.env`.

## Non-goals

- Running several providers simultaneously / splitting one cart across shops.
  Decision: exactly one active provider per process (`GROCERY_PROVIDER`).
- Delivery-slot selection or checkout (unchanged: the user reviews/checks out in the
  provider app). Picnic requires a slot before ordering; out of scope.
- Preserving `dont_buy` product IDs across providers (IDs are provider-specific; see
  edge case 6).
- A Picnic 2FA onboarding flow in the bot (see edge case 4).
- Reflecting Picnic weekly promotions in `onDeal` (see optional Step 10).
- Editing `plans/build-grocery-bot.md` / `plans/build-grocery-bot.sketch.md`
  (historical, do not touch).

## Conventions (unchanged from the build plan)

- ESM, TypeScript strict, extensionless relative imports, `import type` for types.
- Runtime `tsx` everywhere; no build step.
- Pure logic (types + normalizers) must NOT import `src/config.ts`, so tests can
  import it without a populated `.env`. Config is imported only by the transport
  factories/clients, `src/db/index.ts`, `src/llm/client.ts`, `src/bot/access.ts`,
  and `scripts/mcp-check.ts`.
- All user-facing strings stay German.

## Target layout

```
src/grocery/types.ts      # ProductCandidate + GroceryClient (config-free)
src/grocery/mcp.ts        # MCP result envelope decoding (config-free)
src/grocery/normalize.ts  # normalizeProduct (Knuspr) + normalizePicnicProduct (config-free)
src/grocery/knuspr.ts     # Knuspr transport + client
src/grocery/picnic.ts     # Picnic transport + client
src/grocery/index.ts      # createGroceryTransport / createGroceryClient factory
scripts/mcp-check.ts      # provider-aware tools/list dump
```

`src/knuspr/client.ts` and `scripts/knuspr-check.ts` are deleted.

---

## Step 1 — Shared contract (config-free)

### `src/grocery/types.ts` (new)

```ts
import type { PackageAmount } from "../mapping/quantity";

export interface ProductCandidate {
  productId: string;
  name: string;
  price: number;
  unitAmount: number | null;
  unitAmountUnit: PackageAmount["unit"] | null;
  onDeal: boolean;
}

export interface GroceryClient {
  searchProducts(keyword: string, limit?: number): Promise<ProductCandidate[]>;
  addToCart(productId: string, amount: number): Promise<void>;
  close(): Promise<void>;
}
```

### `src/grocery/mcp.ts` (new — move generic envelope helpers out of the old client)

Move `textFromResult`, `extractJsonPayload`, `findProductArray` verbatim from
`src/knuspr/client.ts` (lines 28–88). No config import. `findProductArray` already
recognizes the `results` key that `picnic_search` returns.

```ts
export function textFromResult(result: unknown): string { /* verbatim */ }
export function extractJsonPayload(text: string): unknown { /* verbatim */ }
export function findProductArray(payload: unknown): unknown[] { /* verbatim */ }
```

### `src/grocery/normalize.ts` (new — config-free)

Move `pickString`, `pickNumber`, `pickBoolean`, `normalizeUnit`, `normalizeProduct`
verbatim from `src/knuspr/client.ts` (lines 90–151), import `ProductCandidate` from
`./types`. Add `"gr"` to `normalizeUnit` (`lower === "g" || lower === "gr"`). Add the
Picnic normalizer:

```ts
import { parsePackageAmount, type PackageAmount } from "../mapping/quantity";
import type { ProductCandidate } from "./types";

function pickString(record: Record<string, unknown>, keys: string[]): string | null { /* moved */ }
function pickNumber(record: Record<string, unknown>, keys: string[]): number | null { /* moved */ }
function pickBoolean(record: Record<string, unknown>, keys: string[]): boolean { /* moved */ }
function normalizeUnit(raw: string | null): PackageAmount["unit"] | null {
  if (raw === null) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("ml") || lower === "l" || lower.includes("liter")) return "ml";
  if (lower.includes("kg") || lower.includes("gram") || lower === "g" || lower === "gr") return "gram";
  if (lower.includes("st") || lower.includes("piece") || lower.includes("stück")) return "piece";
  return null;
}

export function normalizeProduct(raw: unknown): ProductCandidate | null { /* moved verbatim */ }

// Picnic `picnic_search` returns { results: [{ id, name, price, unit, image_id? }] }.
// `price` is in cents; `unit` is a package string such as "500 g", "1 l", "6 st".
export function normalizePicnicProduct(raw: unknown): ProductCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const productId = typeof record.id === "string" ? record.id : null;
  const name = typeof record.name === "string" ? record.name : null;
  const rawPrice = typeof record.price === "number" ? record.price : null;
  if (productId === null || name === null || rawPrice === null) return null;
  const unitText = typeof record.unit === "string" ? record.unit : "";
  const parsed = parsePackageAmount(unitText) ?? parsePackageAmount(name);
  return {
    productId,
    name,
    price: rawPrice / 100,
    unitAmount: parsed?.amount ?? null,
    unitAmountUnit: parsed?.unit ?? null,
    onDeal: false,
  };
}
```

### `src/mapping/quantity.ts` — accept the Picnic "gr" suffix

Extend the two gram regexes so `"500 gr"` parses like `"500 g"`:

- multipack: `(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b` → `(kg|gr|g|ml|l)`;
  its unit check `rawUnit === "kg" || rawUnit === "g" ? "gram" : "ml"` →
  `rawUnit === "kg" || rawUnit === "gr" || rawUnit === "g" ? "gram" : "ml"`.
- single weight: `(\d+(?:[.,]\d+)?)\s*(kg|g)\b` → `(kg|gr|g)`.

Add to `test/quantity.test.ts` in the `parses grams` case:
`expect(parsePackageAmount("Kartoffeln 1,5 kg")).toEqual({ amount: 1500, unit: "gram" });`
and `expect(parsePackageAmount("Mehl 500 gr")).toEqual({ amount: 500, unit: "gram" });`.

---

## Step 2 — Knuspr adapter

### `src/grocery/knuspr.ts` (new — old client, split)

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { config } from "../config";
import { extractJsonPayload, findProductArray, textFromResult } from "./mcp";
import { normalizeProduct } from "./normalize";
import type { GroceryClient, ProductCandidate } from "./types";

export const KNUSPR_TOOLS = {
  search: "search_products",
  batchSearch: "batch_search_products",
  addToCart: "add_items_to_cart",
  getCart: "get_cart",
} as const;

export function createKnusprTransport(): Transport {
  return new StreamableHTTPClientTransport(new URL(config.knuspr.mcpUrl), {
    requestInit: {
      headers: {
        "rhl-email": config.knuspr.email,
        "rhl-pass": config.knuspr.password,
      },
    },
  });
}

export async function createKnusprClient(): Promise<GroceryClient> {
  const mcp = new Client({ name: "grocery-bot", version: "1.0.0" });
  await mcp.connect(createKnusprTransport());

  async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await mcp.callTool({ name, arguments: args });
    if ((result as { isError?: boolean }).isError) {
      throw new Error(`Knuspr MCP Fehler bei ${name}.`);
    }
    return extractJsonPayload(textFromResult(result));
  }

  return {
    async searchProducts(keyword: string, limit = 10): Promise<ProductCandidate[]> {
      const payload = await callTool(KNUSPR_TOOLS.search, { keyword, limit });
      return findProductArray(payload)
        .map(normalizeProduct)
        .filter((candidate): candidate is ProductCandidate => candidate !== null);
    },
    async addToCart(productId: string, amount: number): Promise<void> {
      const result = await mcp.callTool({
        name: KNUSPR_TOOLS.addToCart,
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

`batchSearch` / `getCart` remain declared-but-unused, as in the old client.

---

## Step 3 — Picnic adapter

### `src/grocery/picnic.ts` (new)

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { config } from "../config";
import { extractJsonPayload, findProductArray, textFromResult } from "./mcp";
import { normalizePicnicProduct } from "./normalize";
import type { GroceryClient, ProductCandidate } from "./types";

export const PICNIC_TOOLS = {
  search: "picnic_search",
  addToCart: "picnic_add_to_cart",
} as const;

export function createPicnicTransport(): Transport {
  return new StdioClientTransport({
    command: config.picnic.command,
    args: config.picnic.args,
    env: {
      ...getDefaultEnvironment(),
      PICNIC_USERNAME: config.picnic.username,
      PICNIC_PASSWORD: config.picnic.password,
      PICNIC_COUNTRY_CODE: config.picnic.countryCode,
    },
    stderr: "inherit",
  });
}

export async function createPicnicClient(): Promise<GroceryClient> {
  const mcp = new Client({ name: "grocery-bot", version: "1.0.0" });
  // 120 s: a cold `npx` download of mcp-picnic can exceed the SDK's 60 s default.
  await mcp.connect(createPicnicTransport(), { timeout: 120_000 });

  async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await mcp.callTool({ name, arguments: args });
    if ((result as { isError?: boolean }).isError) {
      throw new Error(`Picnic MCP Fehler bei ${name}.`);
    }
    return extractJsonPayload(textFromResult(result));
  }

  return {
    async searchProducts(keyword: string, limit = 10): Promise<ProductCandidate[]> {
      const payload = await callTool(PICNIC_TOOLS.search, { query: keyword, limit });
      return findProductArray(payload)
        .map(normalizePicnicProduct)
        .filter((candidate): candidate is ProductCandidate => candidate !== null);
    },
    async addToCart(productId: string, amount: number): Promise<void> {
      await callTool(PICNIC_TOOLS.addToCart, { productId, count: amount });
    },
    async close(): Promise<void> {
      await mcp.close();
    },
  };
}
```

Tool facts (from `PICNIC_TOOLS.md`, verified 2026-09):
- `picnic_search`: `{ query, limit? (1–20, default 5), offset? }` → `{ results: [...] }`.
- `picnic_add_to_cart`: `{ productId, count? }` (one product per call, unlike
  Knuspr's batched `items[]`). The `GroceryClient.addToCart(productId, amount)`
  signature already hides this difference.
- Auth is env-driven; no manual login step in the normal case.

---

## Step 4 — Factory

### `src/grocery/index.ts` (new)

```ts
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { config } from "../config";
import { createKnusprClient, createKnusprTransport } from "./knuspr";
import { createPicnicClient, createPicnicTransport } from "./picnic";
import type { GroceryClient } from "./types";

export type { GroceryClient, ProductCandidate } from "./types";

export function createGroceryTransport(): Transport {
  return config.provider === "picnic" ? createPicnicTransport() : createKnusprTransport();
}

export async function createGroceryClient(): Promise<GroceryClient> {
  return config.provider === "picnic" ? createPicnicClient() : createKnusprClient();
}
```

## Step 5 — Config

### `src/config.ts` (replace body)

```ts
import "dotenv/config";
import { z } from "zod";

// dotenv turns `KEY=` into "" — treat blank values of optional/defaulted vars as
// unset so the inactive provider's blank credentials don't fail validation.
const emptyToUndefined = (schema: z.ZodTypeAny) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  ALLOWED_CHAT_IDS: z.string().min(1),
  LLM_API_KEY: z.string().min(1),
  LLM_BASE_URL: z.string().url(),
  LLM_MODEL: z.string().min(1),

  GROCERY_PROVIDER: emptyToUndefined(z.enum(["knuspr", "picnic"]).default("knuspr")),

  KNUSPR_MCP_URL: emptyToUndefined(
    z.string().url().default("https://mcp.knuspr.de/mcp"),
  ),
  KNUSPR_EMAIL: emptyToUndefined(z.string().min(1).optional()),
  KNUSPR_PASSWORD: emptyToUndefined(z.string().min(1).optional()),

  PICNIC_MCP_COMMAND: emptyToUndefined(z.string().min(1).default("npx")),
  PICNIC_MCP_ARGS: emptyToUndefined(
    z.string().min(1).default("-y mcp-picnic@1.15.1"),
  ),
  PICNIC_USERNAME: emptyToUndefined(z.string().min(1).optional()),
  PICNIC_PASSWORD: emptyToUndefined(z.string().min(1).optional()),
  PICNIC_COUNTRY_CODE: emptyToUndefined(z.enum(["DE", "NL"]).default("DE")),

  DB_PATH: emptyToUndefined(z.string().min(1).default("./data/grocery.db")),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
  console.error(`Fehlende oder ungültige Konfiguration: ${problems}`);
  process.exit(1);
}

const data = parsed.data;
const missing: string[] = [];
if (data.GROCERY_PROVIDER === "knuspr") {
  if (!data.KNUSPR_EMAIL) missing.push("KNUSPR_EMAIL");
  if (!data.KNUSPR_PASSWORD) missing.push("KNUSPR_PASSWORD");
}
if (data.GROCERY_PROVIDER === "picnic") {
  if (!data.PICNIC_USERNAME) missing.push("PICNIC_USERNAME");
  if (!data.PICNIC_PASSWORD) missing.push("PICNIC_PASSWORD");
}
if (missing.length > 0) {
  console.error(`Fehlende oder ungültige Konfiguration: ${missing.join(", ")}`);
  process.exit(1);
}

export const config = {
  telegramBotToken: data.TELEGRAM_BOT_TOKEN,
  allowedChatIds: data.ALLOWED_CHAT_IDS.split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0),
  llmApiKey: data.LLM_API_KEY,
  llmBaseUrl: data.LLM_BASE_URL,
  llmModel: data.LLM_MODEL,
  provider: data.GROCERY_PROVIDER,
  shopName: data.GROCERY_PROVIDER === "picnic" ? "Picnic" : "Knuspr",
  knuspr: {
    mcpUrl: data.KNUSPR_MCP_URL,
    email: data.KNUSPR_EMAIL ?? "",
    password: data.KNUSPR_PASSWORD ?? "",
  },
  picnic: {
    command: data.PICNIC_MCP_COMMAND,
    args: data.PICNIC_MCP_ARGS.split(" ")
      .map((arg) => arg.trim())
      .filter((arg) => arg.length > 0),
    username: data.PICNIC_USERNAME ?? "",
    password: data.PICNIC_PASSWORD ?? "",
    countryCode: data.PICNIC_COUNTRY_CODE,
  },
  dbPath: data.DB_PATH,
};
```

Note: drop the old `as const` (no longer needed; avoids readonly-array friction with
`StdioClientTransport.args`).

### `.env.example` (replace body)

```dotenv
TELEGRAM_BOT_TOKEN=
ALLOWED_CHAT_IDS=11111111,22222222
LLM_API_KEY=
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini

# Delivery provider: knuspr (default) or picnic
GROCERY_PROVIDER=knuspr

# --- Knuspr (used when GROCERY_PROVIDER=knuspr) ---
KNUSPR_MCP_URL=https://mcp.knuspr.de/mcp
KNUSPR_EMAIL=
KNUSPR_PASSWORD=

# --- Picnic (used when GROCERY_PROVIDER=picnic) ---
PICNIC_MCP_COMMAND=npx
PICNIC_MCP_ARGS=-y mcp-picnic@1.15.1
PICNIC_USERNAME=
PICNIC_PASSWORD=
PICNIC_COUNTRY_CODE=DE

DB_PATH=./data/grocery.db
```

---

## Step 6 — DB: rename `knuspr_product_id` → `product_id`

### `src/db/index.ts`

Change the `dont_buy` column in the `CREATE TABLE` block to `product_id TEXT`, then
append the idempotent migration after `db.exec(...)`:

```ts
export function migrate(): void {
  db.exec(`
    ...unchanged tables...

    CREATE TABLE IF NOT EXISTS dont_buy (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT,
      name TEXT NOT NULL
    );
  `);

  const columns = db
    .prepare("PRAGMA table_info(dont_buy)")
    .all() as { name: string }[];
  const hasLegacy = columns.some((column) => column.name === "knuspr_product_id");
  const hasNew = columns.some((column) => column.name === "product_id");
  if (hasLegacy && !hasNew) {
    db.exec("ALTER TABLE dont_buy RENAME COLUMN knuspr_product_id TO product_id;");
  }
}
```

Safe: better-sqlite3 11.10 bundles SQLite 3.49.2 (verified), so `RENAME COLUMN`
(3.25+) is supported. Fresh DBs never hit the legacy branch.

### `src/db/repo.ts`

- `DontBuyItem.knusprProductId: string | null` → `productId: string | null`.
- `DontBuyRow.knuspr_product_id: string | null` → `product_id: string | null`.
- `listDontBuy`: `SELECT id, product_id, name FROM dont_buy ORDER BY name`; map to
  `{ id, productId: row.product_id, name }`.
- `addDontBuy(name, productId)`: `INSERT INTO dont_buy (product_id, name) VALUES (?, ?)`
  and return `{ id, productId, name }` (rename the parameter).
- `findDontBuyByName`: select `product_id`, map to `productId`.

---

## Step 7 — Consumer renames

### `src/cart/assemble.ts`

- Line 2: `import type { GroceryClient, ProductCandidate } from "../grocery/types";`
- Function signature: `knuspr: KnusprClient` → `grocery: GroceryClient`.
- Line 69: `await knuspr.searchProducts(...)` → `grocery.searchProducts(...)`.
- Line 149: `await knuspr.addToCart(...)` → `grocery.addToCart(...)`.

### `src/mapping/match.ts`

- Line 4: `import type { ProductCandidate } from "../grocery/types";`
- Line 16: `item.knusprProductId` → `item.productId` (both occurrences).

### `src/bot/commands.ts`

- Line 2: `import { createGroceryClient } from "../grocery";`
- `runCart`: `const knuspr = await createKnusprClient();` → `const grocery = await createGroceryClient();`
  `assembleCart(llm, grocery, ...)`; `grocery.close().catch(() => undefined)`.
- `formatCartResult(result)` → `formatCartResult(result, config.shopName)` (add
  `import { config } from "../config";`).

### `src/bot/format.ts`

- `formatCartResult(result: CartResult)` → `formatCartResult(result: CartResult, shopName: string)`.
- Line 47 hardcoded text → `` `Bitte prüfe den Warenkorb im ${shopName}-Shop und schließe die Bestellung dort ab.` ``.

### `test/assemble.test.ts`

- Line 3: `import type { GroceryClient, ProductCandidate } from "../src/grocery/types";`
- `fakeKnuspr` → `fakeGrocery`; its `client: KnusprClient` → `client: GroceryClient`
  (update the two call sites at lines 58 and 82).
- DontBuy fixture line 81: `knusprProductId: "p-reis"` → `productId: "p-reis"`.

### `test/match.test.ts`

- Line 3: `import type { ProductCandidate } from "../src/grocery/types";`
- Fixtures lines 24–25: `knusprProductId` → `productId`.

### `test/picnic.test.ts` (new, config-free)

```ts
import { describe, expect, it } from "vitest";
import { normalizePicnicProduct } from "../src/grocery/normalize";

describe("normalizePicnicProduct", () => {
  it("converts cents to euros and parses the package size from unit", () => {
    expect(
      normalizePicnicProduct({ id: "p1", name: "Basmatireis", price: 249, unit: "500 g" }),
    ).toEqual({
      productId: "p1",
      name: "Basmatireis",
      price: 2.49,
      unitAmount: 500,
      unitAmountUnit: "gram",
      onDeal: false,
    });
  });

  it("parses gr/kg units and falls back to the name", () => {
    expect(normalizePicnicProduct({ id: "p2", name: "Mehl", price: 99, unit: "500 gr" })).toEqual({
      productId: "p2",
      name: "Mehl",
      price: 0.99,
      unitAmount: 500,
      unitAmountUnit: "gram",
      onDeal: false,
    });
    expect(normalizePicnicProduct({ id: "p3", name: "Eier 6 Stk", price: 199, unit: "" })?.unitAmount).toBe(6);
    expect(normalizePicnicProduct({ id: "p4", name: "Zucker", price: 129, unit: "1 kg" })?.price).toBe(1.29);
  });

  it("returns null for entries without id/name/price", () => {
    expect(normalizePicnicProduct({ name: "x", price: 1 })).toBeNull();
    expect(normalizePicnicProduct(null)).toBeNull();
  });
});
```

---

## Step 8 — Check script

### `scripts/mcp-check.ts` (new; replaces `scripts/knuspr-check.ts`)

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { config } from "../src/config";
import { createGroceryTransport } from "../src/grocery";

async function main(): Promise<void> {
  const transport = createGroceryTransport();
  const client = new Client({ name: "grocery-bot-check", version: "1.0.0" });
  await client.connect(transport, { timeout: 120_000 });
  console.log(`Provider: ${config.provider}`);
  const tools = await client.listTools();
  console.log(JSON.stringify(tools, null, 2));
  await client.close();
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

### `package.json`

Replace `"knuspr:check": "tsx scripts/knuspr-check.ts"` with
`"mcp:check": "tsx scripts/mcp-check.ts"`.

### Delete

- `src/knuspr/client.ts` (and the now-empty `src/knuspr/` directory).
- `scripts/knuspr-check.ts`.

Verify no source file still references the old contract (use `grep`, not `rg` —
`rg` is not installed here; `\b` avoids a false positive on `createKnusprClient`):

```sh
grep -rnE 'knuspr/client|knuspr-check|\bKnusprClient\b|knuspr_product_id|knusprProductId' src scripts test
```

Expected: the only match is `src/db/index.ts` (the migration must name the legacy
column: the `PRAGMA` check and `RENAME COLUMN ... knuspr_product_id TO product_id`).
No matches in `scripts/` or `test/`; no `src/grocery/knuspr.ts` false positive
(thanks to `\b`).

---

## Step 9 — Docs

### `README.md`

- Intro/architecture lines: say "delivery service (Knuspr or Picnic)" instead of
  Knuspr-only; note the provider is pluggable via `GROCERY_PROVIDER`.
- Requirements: add "A Picnic account (Germany/Netherlands) if using Picnic".
- Setup env table: add
  `GROCERY_PROVIDER` (default `knuspr`),
  `PICNIC_MCP_COMMAND` / `PICNIC_MCP_ARGS`,
  `PICNIC_USERNAME` / `PICNIC_PASSWORD`,
  `PICNIC_COUNTRY_CODE` (default `DE`); mark `KNUSPR_*` as "when
  `GROCERY_PROVIDER=knuspr`" and `PICNIC_*` as "when `GROCERY_PROVIDER=picnic`".
- Add a short "Picnic" subsection: it uses the **unofficial community MCP**
  `mcp-picnic` (pinned in `PICNIC_MCP_ARGS`); credentials via env; first run
  downloads the npm package via `npx`; if the account has 2FA, see the note in
  edge case 4.
- Development: `npm run knuspr:check` → `npm run mcp:check`.

### `ARCHITECTURE.md` (recommended; does not affect code)

- Lines 15/16, 35: replace "knuspr" with "the configured delivery service
  (Knuspr or Picnic)".
- Line 46 Tech Stack: `MCP: Knuspr (official) or Picnic (community)`.
- ADR 7: "we want to use an MCP server for product selection and cart assembly:
  the official Knuspr MCP or the community Picnic MCP, selected via
  `GROCERY_PROVIDER`."
- ADR 13: "…in the provider app (Knuspr or Picnic)."

---

## Step 10 — (Optional) Picnic deal enrichment for ADR 14

Skip for a first version (acceptable known limitation: `onDeal` is always `false`
for Picnic, so the cart is still cheapest-first but deals are not flagged). If
wanted, implement entirely inside `src/grocery/picnic.ts`, best-effort:

1. Add `PICNIC_TOOLS.promotions = "picnic_get_promotions"`.
2. Lazily call it once per client and build a `Set<string>` of promoted product IDs
   from the response (verify the exact field name live; the docs say the response
   includes a product ID and price).
3. In `searchProducts`, set `onDeal: promoted.has(id)`; if the call throws or the
   shape is unexpected, fall back to `false` (never fail the cart run).

Do not add this without a live `mcp:check` showing the promotion payload shape.

---

## Final verification (run in order, read each output)

1. `npm install` → exit 0.
2. `npm run typecheck` → exit 0, no output.
3. `npm test` → 8 test files pass (7 existing + `test/picnic.test.ts`), exit 0.
4. `grep -rnE 'knuspr/client|knuspr-check|\bKnusprClient\b|knuspr_product_id|knusprProductId' src scripts test`
   → only `src/db/index.ts` (migration names the legacy column); nothing else.
5. Developer-run with a real `.env` (executor reports as unverified if credentials
   are unavailable):
   - Default (Knuspr): `npm run mcp:check` → prints `Provider: knuspr` and the
     Knuspr tool list; names must match `KNUSPR_TOOLS`.
   - Picnic: set `GROCERY_PROVIDER=picnic` + `PICNIC_*` creds, run
     `npm run mcp:check` → prints `Provider: picnic` and the tool list; confirm
     `picnic_search` and `picnic_add_to_cart` exist and inspect their `inputSchema`.
   - `npm run dev` → logs `Grocery-Bot läuft.`, then a real `/start 3`:
     check that the summary shows plausible euro amounts (price in cents / 100),
     correct package amounts (from `unit`), and adds items to the provider cart.
   - Migration check: start once against an existing `grocery.db` and confirm
     `PRAGMA table_info(dont_buy)` shows `product_id` (and no `knuspr_product_id`).

## Rollback / do not touch

- Never edit/commit: `.env` (only `.env.example`), `data/`, `node_modules/`.
- Do not modify `plans/build-grocery-bot.md` or `plans/build-grocery-bot.sketch.md`
  (historical) or `WORKFLOW.md`.
- Rollback is `git checkout -- .` (all changes here are additive/moves plus the
  DB rename; the DB guard makes the rename safe to re-run).

## Edge cases and how to handle each

1. **Picnic response shape differs from `PICNIC_TOOLS.md`.** Adjust only
   `src/grocery/picnic.ts` (tool args) or `normalizePicnicProduct` in
   `src/grocery/normalize.ts`. If there is no per-item `id`/`name`/`price`, STOP and
   report to the planner — do not invent a new normalization strategy.
2. **Price unit.** Assumed cents (`rawPrice / 100`). If a live `/start` shows prices
   ~100× too high or too low, change the divisor in `normalizePicnicProduct` and add
   a test. This is a one-line, localized fix.
3. **`unit` string variants.** `parsePackageAmount` handles `g`, `gr`, `kg`, `ml`,
   `l`, `stk`, `stück`, `st`. If Picnic uses another token, extend the regex in
   `src/mapping/quantity.ts` and add a `test/quantity.test.ts` case; do not special-
   case it in the adapter. Pre-existing, unchanged: spelled-out `"gram"` has never
   matched (the regex needs a word boundary after `g`, which `"gr"` in "gram"
   doesn't have) — do not "fix" that silently in this refactor.
4. **Picnic account has 2FA.** Auto-login may fail because the bot never calls
   `picnic_generate_2fa_code` / `picnic_verify_2fa_code`. The adapter will surface
   the MCP error; the bot's `bot.catch` shows a generic German error. Do NOT build an
   interactive 2FA flow in this plan. Workarounds for the operator: disable 2FA, or
   pre-authenticate once with another MCP client (e.g. MCP inspector) so a session
   token is cached, or extend the adapter later. Report to the planner if this
   blocks.
5. **First `npx` run downloads `mcp-picnic`.** Needs network and a writable
   `HOME`; `getDefaultEnvironment()` forwards `HOME`/`PATH` (verified). Pin the
   version in `PICNIC_MCP_ARGS`. A cold download can outlast the SDK's 60 s
   default request timeout — hence the explicit `{ timeout: 120_000 }` on
   `connect()` in `createPicnicClient` and `scripts/mcp-check.ts`. To pre-warm,
   run `npx -y mcp-picnic@1.15.1 --version` once on the host. For fully
   offline/locked-down hosts, set `PICNIC_MCP_COMMAND`/`PICNIC_MCP_ARGS` to a
   locally installed binary. Docker: no `Dockerfile`/`docker-compose.yml` changes
   needed (`env_file` passes the new vars through; the node image ships `npx`),
   but the container needs network access on the first Picnic run.
6. **`dont_buy` IDs are provider-specific.** A row blocking a Knuspr product ID
   will not match Picnic IDs. Name-based blocking (stored `product_id = NULL`) still
   works across providers. Switching providers is a conscious operation; if the user
   switches often, tell them to prefer name-based entries. Multi-provider carts are
   explicitly out of scope (decision: one active provider).
7. **`onDeal` for Picnic is always `false`.** See optional Step 10. Knuspr behavior
   is unchanged. ADR 14 remains satisfied for Knuspr; document the Picnic gap.
8. **Tests must not need `.env`.** Keep `types.ts`, `mcp.ts`, and `normalize.ts`
   config-free; the adapter files import `config` and must not be imported by tests.
9. **Existing DBs.** The `RENAME COLUMN` guard is idempotent and only runs when the
   legacy column exists. No data copy needed; values are preserved.
10. **`format.ts` purity.** Keep it config-free by passing `config.shopName` from
    `commands.ts`; do not import config into the formatter.
