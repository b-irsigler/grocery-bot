# Sketch — build-grocery-bot

Design Summary from planner brainstorm (2026-09-12). The executioner expands
this into `plans/build-grocery-bot.md`. NOT the plan file; no `## Status:` yet.

## Settled decisions

- Node 22 LTS + TypeScript strict, ESM (`"type": "module"`). Runtime `tsx`
  everywhere, also in Docker — no separate build step.
- grammY long-polling (no webhook; VPS-friendly, stateless workflow ADR 11).
- DB: better-sqlite3 (sync, prebuilt binaries), WAL on, foreign keys on,
  single file at `$DB_PATH` (default `./data/grocery.db`).
- LLM: `openai` npm SDK, `baseURL` + `apiKey` from env (works with Z.ai,
  OpenRouter, OpenAI, ...). Only basic `chat.completions` with `tools`
  (broad provider compat). Model name from env `LLM_MODEL`.
- MCP: official `@modelcontextprotocol/sdk` client, StreamableHTTPClientTransport
  → `https://mcp.knuspr.de/mcp` with headers `rhl-email: $KNUSPR_EMAIL`,
  `rhl-pass: $KNUSPR_PASSWORD`. (OAuth needs a browser → not viable headless.)
- All bot text + LLM system prompts in German (ADR 15).
- Tests: vitest. LLM and Knuspr behind interfaces (`LlmClient`,
  `KnusprClient`) → mocked in tests, no live API in CI.

## Env (.env.example)

TELEGRAM_BOT_TOKEN, ALLOWED_CHAT_IDS (comma-sep), LLM_API_KEY, LLM_BASE_URL,
LLM_MODEL, KNUSPR_MCP_URL (default https://mcp.knuspr.de/mcp), KNUSPR_EMAIL,
KNUSPR_PASSWORD, DB_PATH (default ./data/grocery.db)

## Layout

```
package.json, tsconfig.json, .env.example, Dockerfile, docker-compose.yml
src/config.ts          # env parse+validate; exit(1) with German msg on missing
src/units.ts           # Unit type, UNITS const, clove→piece conversion
src/db/index.ts        # open DB, migrations (CREATE TABLE IF NOT EXISTS)
src/db/repo.ts         # recipes / recipe_ingredients / base_items / dont_buy CRUD
src/llm/client.ts      # LlmClient interface + OpenAI impl
src/knuspr/client.ts   # KnusprClient interface + MCP impl (ONLY place with tool names)
src/planning/selector.ts   # LLM: pick N diverse recipes (JSON), change loop
src/mapping/match.ts       # ingredient → candidates → product choice
src/mapping/quantity.ts    # package-size parsing + round-up math
src/cart/assemble.ts       # base + recipes → needs → products → cart lines
src/bot/index.ts       # grammY wiring, access middleware, error middleware
src/bot/commands.ts    # command handlers
src/bot/nl.ts          # NL → intent router via LLM tool-calling
src/bot/state.ts       # per-chat FSM (in-memory Map) for multi-step flows
scripts/knuspr-check.ts # dev script: tools/list against real MCP, print names
test/*.test.ts
```

## Data model (sqlite)

- recipes(id TEXT PK /*kebab slug of title*/, title TEXT UNIQUE, tags TEXT /*JSON string[]*/, created_at TEXT)
- recipe_ingredients(id TEXT PK /*uuid*/, recipe_id FK→recipes, ingredient_id TEXT /*kebab German slug, e.g. "knoblauch"*/, quantity REAL, unit TEXT CHECK(unit IN('piece','clove','gram','ml','package')), alt_group TEXT NULL)
  — rows sharing (recipe_id, alt_group) are interchangeable; exactly one per
  group is picked at mapping time (shrimp vs chicken). NULL = mandatory.
- base_items(id TEXT PK /*uuid*/, name TEXT, quantity REAL, unit TEXT /*same enum*/)
- dont_buy(id INTEGER PK AUTOINCREMENT, knuspr_product_id TEXT, name TEXT)
  — block by product_id OR case-insensitive exact name.
- ingredient_id doubles as MCP search keyword (dashes → spaces).

## Core types

```ts
type Unit = "piece" | "clove" | "gram" | "ml" | "package"
interface RecipeIngredient { ingredientId: string; quantity: number; unit: Unit; altGroup: string | null }
interface NeedLine { ingredientId: string; quantity: number; unit: Unit }   // after alt-resolution + aggregation
interface ProductCandidate { productId: string; name: string; price: number; unitAmount: number | null; onDeal: boolean }
interface CartLine { product: ProductCandidate; amount: number }
```

## Order of the /start workflow (per ARCHITECTURE.md §Order)

1. LLM selects N recipes (diversity via tags), alternatives stay OPEN.
2. Boolean needs = union of ingredient_ids of selected recipes.
3. Knuspr search per ingredient (`batch_search_products` if available, else
   per-ingredient `search_products`); filter dont_buy (hard no) + sold-out;
   LLM picks best-representing product from top ~10 (ADR 9 best guess,
   flagged to user); conventional price compare prefers onDeal then cheapest
   (ADR 10/14); this settles alternative groups by group-total price.
4. Math aggregates quantities over CHOSEN variants only (conventional, ADR 8):
   sum per (ingredient_id, unit); clove→piece ×1; mixed units for same
   ingredient → separate cart lines (over-buy safe, documented gotcha).
5. Package math: unitAmount parsed from product name via regex ("500 g",
   "0,5 l", "500ml", "1,5kg", "6 Stk"); weight/volume: amount =
   ceil(need/unitAmount); countable (piece/clove/package): amount = ceil(need);
   unitAmount null → max(1, ceil(need)).
6. Base items appended (same pipeline, always needed).
7. `add_items_to_cart` via MCP; verify with `get_cart`.
8. German summary to user: cart lines + prices, deals flagged, best-guess
   substitutions flagged, dont-buy blocks reported (ADR 18: if the only
   available product is on dont-buy list → notify, add nothing). Final note:
   review/checkout happens in Knuspr UI (ADR 4/13).

## Bot surface

- Access middleware: chat.id ∈ ALLOWED_CHAT_IDS, else silently drop (ADR 1/2).
- Commands: /start <N>, /add-recipe, /edit-recipe <name>, /remove-recipe <name>,
  /edit-base, /add-dont-buy, /remove-dont-buy, /list-dont-buy, /help.
- NL router (ADR 3): non-command text → LLM tool-call → dispatches to the same
  handlers as commands.
- Multi-step flows (add/edit recipe, edit-base, add/remove-dont-buy) keep
  per-chat state in an in-memory Map (ADR 12), prompt in German, and end with
  a validation message showing the planned change + inline keyboard
  Ja/Abbrechen before persisting (ADR 17). LLM extracts structured
  ingredients (incl. alt groups) from free text; unit must be in enum,
  quantity > 0 (ADR 19 — no semantic plausibility checks).
- Unit validation: only enum membership. zod for all LLM JSON outputs, one
  retry with "Antworte NUR mit JSON." on parse failure.
- temperatures: router/mapping 0, recipe selection 0.7.

## Error handling

- Missing config → exit(1), German message naming the missing keys.
- Failure during /start → German error + "Der Vorgang ist zustandslos, bitte
  einfach /start erneut aufrufen." (ADR 11). No cleanup of partial cart.
- grammY error middleware catches everything → friendly German message.

## Tests (vitest)

- Full coverage of pure logic: unit validation, aggregation (same ingredient
  across recipes, alt groups, clove→piece, mixed units → two lines), package
  regex table, round-up math, dont-buy filter, ADR-18 all-blocked case.
- selector / nl router / cart assembly tested against fake LlmClient +
  fake KnusprClient.
- No live Telegram/LLM/MCP in tests. Manual smoke: `npm run dev`,
  `npx tsx scripts/knuspr-check.ts` (developer, with real creds).

## Non-goals

No checkout/payment/delivery slots (ADR 4/13); no recipe scaling (fixed
2 adults + 1 child); no concurrency guards (ADR 16); no semantic
unit/ingredient checks (ADR 19); no MCP OAuth; no i18n beyond German; no web UI.

## Known risks (plan must address)

- MCP tool names from public evidence: `search_products`,
  `batch_search_products`, `add_items_to_cart`, `get_cart` — not verified
  against the live server. Keep them as constants in `src/knuspr/client.ts`;
  `scripts/knuspr-check.ts` prints the real tool list for verification. If
  names differ → executor STOPs and asks (planner question).
- LLM tool-calling compat varies across OpenAI-compatible providers: use
  minimal schema shapes, and for selection/mapping prefer
  JSON-in-text (zod-parsed) over tool-calls where possible.
