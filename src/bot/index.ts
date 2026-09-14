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
