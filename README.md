# grocery-bot

A Telegram bot that plans a week of meals for a small family and assembles the
matching grocery cart on a delivery service — [Knuspr](https://www.knuspr.de) or
[Picnic](https://picnic.app) — so the only thing left to do is review the cart
and check out.

The bot picks a diverse set of recipes from a personal recipe pool, aggregates
ingredients across recipes (conventional math, no LLM), maps them to real
products via the configured MCP server, adds a weekly base assortment, respects
a dont-buy list, and shares the finished cart in the chat.

The delivery provider is pluggable and selected with `GROCERY_PROVIDER`
(`knuspr` or `picnic`); one provider is active at a time.

All user interaction is in German. Architecture decisions and the full design
live in [ARCHITECTURE.md](ARCHITECTURE.md).

## Using the bot

### Getting access (once)

1. Ask the operator for the bot link, e.g. `https://t.me/YourBotName`. The bot is
   created with [@BotFather](https://t.me/BotFather), where its username is set.
2. Open that link (or search for `@YourBotName` in Telegram) and tap **Start**.
   This is the chat you will use with the bot.
3. Find your own chat ID by messaging [`@userinfobot`](https://t.me/userinfobot)
   and send that ID to the operator.
4. The operator adds it to `ALLOWED_CHAT_IDS` and restarts the bot. Until then the
   bot silently ignores your messages, so don't worry if your first tap does
   nothing.
5. Once the operator confirms, send `/start <Anzahl>` (e.g. `/start 5`). Telegram's
   Start button only sends a bare `/start`, which the bot answers with usage help.

### First-time setup

1. Build the recipe pool with `/add_recipe`. Describe each recipe in German —
   title, tags, and ingredients with quantities. Alternatives are supported,
   e.g. "gebratener Reis mit Garnelen oder Hähnchen".
2. Set the weekly base assortment (milk, bread, etc.) with `/edit_base`.
3. Optionally add products that should never end up in the cart with
   `/add_dont_buy`.

Every command also works in natural language. All changes are confirmed via
inline buttons before they are applied.

### Weekly routine

1. Send `/start <Anzahl>` (e.g. `/start 5`).
2. The bot proposes a diverse set of recipes with three buttons:
   ✅ Übernehmen, ✏️ Ändern, ❌ Abbrechen.
3. Choose ✏️ Ändern and type what you want different in plain German to get
   a new proposal.
4. On ✅ Übernehmen, the bot fills the provider cart: cheaper products and deals
   are preferred, the dont-buy list is respected, and uncertain product
   matches are flagged in the summary it posts.
5. Review the cart in the Knuspr/Picnic app and check out with your payment
   method — the bot never places the order itself.

## Commands

| Command | Description |
| --- | --- |
| `/start <Anzahl>` | Create a weekly plan and assemble the cart |
| `/add_recipe` | Add a recipe (described in natural language) |
| `/edit_recipe <Name>` | Edit a recipe |
| `/remove_recipe <Name>` | Remove a recipe |
| `/edit_base` | Edit the weekly base assortment |
| `/add_dont_buy <Produkt>` | Never put this product in the cart |
| `/remove_dont_buy <Produkt>` | Remove a product from the dont-buy list |
| `/list_dont_buy` | Show the dont-buy list |
| `/help` | List all commands |

Every command also works in natural language. All changes are confirmed via
inline buttons before they are applied.

## Requirements

- Node.js >= 22
- A Telegram bot token ([@BotFather](https://t.me/BotFather))
- An API key for any OpenAI-compatible chat-completions endpoint
  (e.g. OpenAI or Scaleway Generative APIs)
- Knuspr account credentials (when `GROCERY_PROVIDER=knuspr`) or Picnic account
  credentials (when `GROCERY_PROVIDER=picnic`)

## Setup

1. Copy `.env.example` to `.env` and fill in the values:

   ```sh
   cp .env.example .env
   ```

   | Variable | Description |
   | --- | --- |
   | `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
   | `ALLOWED_CHAT_IDS` | Comma-separated Telegram chat IDs allowed to use the bot |
   | `LLM_API_KEY` | API key for the LLM endpoint |
   | `LLM_BASE_URL` | OpenAI-compatible base URL, e.g. `https://api.openai.com/v1` |
   | `LLM_MODEL` | Chat model name, e.g. `mistral-small-3.2-24b-instruct-2506` on Scaleway |
   | `GROCERY_PROVIDER` | `knuspr` (default) or `picnic` |
   | `KNUSPR_MCP_URL` | Knuspr MCP endpoint (defaults to `https://mcp.knuspr.de/mcp`), when `GROCERY_PROVIDER=knuspr` |
   | `KNUSPR_EMAIL` / `KNUSPR_PASSWORD` | Knuspr account credentials, when `GROCERY_PROVIDER=knuspr` |
   | `PICNIC_MCP_COMMAND` / `PICNIC_MCP_ARGS` | Picnic MCP command (defaults to `npx -y mcp-picnic@1.15.1`), when `GROCERY_PROVIDER=picnic` |
   | `PICNIC_USERNAME` / `PICNIC_PASSWORD` | Picnic account credentials, when `GROCERY_PROVIDER=picnic` |
   | `PICNIC_COUNTRY_CODE` | Picnic country, `DE` (default) or `NL` |
   | `DB_PATH` | SQLite path (defaults to `./data/grocery.db`) |

2. Install dependencies:

   ```sh
   npm install
   ```

3. Note the bot's username from [@BotFather](https://t.me/BotFather) — it is not
   part of `.env` — and share `https://t.me/<username>` with the users you add to
   `ALLOWED_CHAT_IDS` (see [Getting access](#getting-access-once)).

## Grocery delivery providers

The bot supports two delivery services and uses exactly one at a time, selected
with `GROCERY_PROVIDER` (`knuspr` or `picnic`). In both cases the assembled cart
is reviewed and checked out by hand in the provider's own app — the bot never
places an order.

### Knuspr (default)

Uses Knuspr's **official** MCP server, authenticated with your Knuspr account
credentials:

```dotenv
GROCERY_PROVIDER=knuspr
KNUSPR_MCP_URL=https://mcp.knuspr.de/mcp
KNUSPR_EMAIL=you@example.com
KNUSPR_PASSWORD=...
```

### Picnic

Picnic has no official MCP server. This uses the **unofficial community** server
[`mcp-picnic`](https://github.com/ivo-toby/mcp-picnic), which talks to the same
private, reverse-engineered API as the Picnic app. It is not affiliated with
Picnic and can stop working if Picnic changes that API.

```dotenv
GROCERY_PROVIDER=picnic
PICNIC_USERNAME=you@example.com
PICNIC_PASSWORD=...
PICNIC_COUNTRY_CODE=DE
PICNIC_MCP_ARGS=-y mcp-picnic@1.15.1
```

- The server runs via `npx`, so the first run downloads it and needs network
  access. To pre-warm the cache: `npx -y mcp-picnic@1.15.1 --version`.
- Pin the version in `PICNIC_MCP_ARGS` (as above) to keep behavior reproducible.
- Picnic supports `DE` and `NL` for `PICNIC_COUNTRY_CODE`.
- If the account has 2FA enabled, automatic login may require a one-time
  verification code that the bot cannot prompt for. Either disable 2FA for the
  account or complete the 2FA flow once with another MCP client (for example the
  MCP inspector) so a session is cached.
- Product IDs are provider-specific. The dont-buy list stores an optional ID;
  entries created with `/add_dont_buy` are name-based and work across providers.
  After switching providers, a Knuspr-specific ID entry would not match a Picnic
  product.

To switch providers, change `GROCERY_PROVIDER`, restart the bot, and run
`npm run mcp:check` to confirm the new provider's MCP tools are reachable.

## Run

```sh
# development
npm run dev

# production
npm start

# or via Docker (mounts ./data for the SQLite database)
docker compose up -d --build
```

## Development

```sh
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run mcp:check   # print the configured provider's MCP tools/list
```

See [WORKFLOW.md](WORKFLOW.md) for the two-model planning workflow used to
develop this repo.
