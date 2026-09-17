import { Bot } from "grammy";
import { config } from "../config";
import { migrate } from "../db/index";
import { PicnicAuthError } from "../grocery/auth";
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
    const message =
      error.error instanceof PicnicAuthError
        ? 'Picnic-Anmeldung/2FA erforderlich. Bitte einmalig "npm run picnic:auth" ausführen und den Code eingeben.'
        : "Es ist ein Fehler aufgetreten. Bitte versuche es erneut.";
    void error.ctx.reply(message).catch(() => undefined);
  });
  await bot.api.setMyCommands([
    { command: "start", description: "Wochenplan und Warenkorb erstellen" },
    { command: "add_recipe", description: "Rezept hinzufügen" },
    { command: "edit_recipe", description: "Rezept bearbeiten" },
    { command: "remove_recipe", description: "Rezept entfernen" },
    { command: "list_recipes", description: "Alle Rezepte anzeigen" },
    { command: "edit_base", description: "Grundsortiment bearbeiten" },
    { command: "list_base", description: "Grundsortiment anzeigen" },
    { command: "add_dont_buy", description: "Produkt zur Nicht-kaufen-Liste hinzufügen" },
    { command: "remove_dont_buy", description: "Produkt von der Nicht-kaufen-Liste entfernen" },
    { command: "list_dont_buy", description: "Nicht-kaufen-Liste anzeigen" },
    { command: "help", description: "Hilfe anzeigen" },
  ]);
  console.log("Grocery-Bot läuft.");
  const me = await bot.api.getMe();
  console.log(`Bot-Link: https://t.me/${me.username}`);
  await bot.start();
}

void main().catch((error) => {
  console.error("Startfehler:", error);
  process.exit(1);
});
