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
