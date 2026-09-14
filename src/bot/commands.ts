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
