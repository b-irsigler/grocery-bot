# grocery-bot

A Telegram bot that plans a week of meals for a small family and assembles the
matching grocery cart on [Knuspr](https://www.knuspr.de) — so the only thing
left to do is review the cart and check out.

The bot picks a diverse set of recipes from a personal recipe pool, aggregates
ingredients across recipes (conventional math, no LLM), maps them to real
products via the official Knuspr MCP server, adds a weekly base assortment,
respects a dont-buy list, and shares the finished cart in the chat.

All user interaction is in German. Architecture decisions and the full design
live in [ARCHITECTURE.md](ARCHITECTURE.md).

## Using the bot

### Getting access (once)

1. Find out your Telegram chat ID by messaging [`@userinfobot`](https://t.me/userinfobot).
2. Send the ID to whoever operates the bot. They add it to `ALLOWED_CHAT_IDS`
   in `.env` and restart the bot.
3. Messages from chats that are not allowlisted are silently ignored.

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
4. On ✅ Übernehmen, the bot fills the Knuspr cart: cheaper products and deals
   are preferred, the dont-buy list is respected, and uncertain product
   matches are flagged in the summary it posts.
5. Review the cart in the Knuspr app and check out with your payment method —
   the bot never places the order itself.

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
- Knuspr account credentials

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
   | `KNUSPR_MCP_URL` | Knuspr MCP endpoint (defaults to `https://mcp.knuspr.de/mcp`) |
   | `KNUSPR_EMAIL` / `KNUSPR_PASSWORD` | Knuspr account credentials |
   | `DB_PATH` | SQLite path (defaults to `./data/grocery.db`) |

2. Install dependencies:

   ```sh
   npm install
   ```

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
npm run knuspr:check
```

See [WORKFLOW.md](WORKFLOW.md) for the two-model planning workflow used to
develop this repo.
