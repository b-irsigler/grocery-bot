import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { config } from "../config";

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const CREATE_RECIPE_INGREDIENTS = `
  CREATE TABLE IF NOT EXISTS recipe_ingredients (
    id TEXT PRIMARY KEY,
    recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    ingredient_id TEXT NOT NULL,
    amount_kind TEXT NOT NULL CHECK (amount_kind IN ('measured','count','container','unquantified')),
    amount_value REAL,
    amount_measure TEXT CHECK (amount_measure IN ('gram','ml')),
    amount_item TEXT,
    amount_text TEXT NOT NULL DEFAULT '',
    alt_group TEXT
  );
`;

const CREATE_BASE_ITEMS = `
  CREATE TABLE IF NOT EXISTS base_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    amount_kind TEXT NOT NULL CHECK (amount_kind IN ('measured','count','container','unquantified')),
    amount_value REAL,
    amount_measure TEXT CHECK (amount_measure IN ('gram','ml')),
    amount_item TEXT
  );
`;

function hasColumn(table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((entry) => entry.name === column);
}

// Old schemas stored {quantity, unit} with a fixed five-value unit enum. Rebuild
// the tables into the amount-kind model and backfill existing rows.
function migrateIngredientTable(): void {
  if (!hasColumn("recipe_ingredients", "unit")) return;
  db.exec(`
    CREATE TABLE recipe_ingredients_new (
      id TEXT PRIMARY KEY,
      recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      ingredient_id TEXT NOT NULL,
      amount_kind TEXT NOT NULL CHECK (amount_kind IN ('measured','count','container','unquantified')),
      amount_value REAL,
      amount_measure TEXT CHECK (amount_measure IN ('gram','ml')),
      amount_item TEXT,
      amount_text TEXT NOT NULL DEFAULT '',
      alt_group TEXT
    );

    INSERT INTO recipe_ingredients_new
      (id, recipe_id, ingredient_id, amount_kind, amount_value, amount_measure, amount_item, amount_text, alt_group)
    SELECT
      id,
      recipe_id,
      ingredient_id,
      CASE unit
        WHEN 'gram' THEN 'measured'
        WHEN 'ml' THEN 'measured'
        WHEN 'piece' THEN 'count'
        WHEN 'clove' THEN 'count'
        WHEN 'package' THEN 'container'
        ELSE 'unquantified'
      END,
      CASE WHEN unit IN ('gram','ml','piece','clove','package') THEN quantity ELSE NULL END,
      CASE WHEN unit = 'gram' THEN 'gram' WHEN unit = 'ml' THEN 'ml' ELSE NULL END,
      CASE WHEN unit = 'clove' THEN 'zehe' ELSE NULL END,
      quantity || ' ' || unit,
      alt_group
    FROM recipe_ingredients;

    DROP TABLE recipe_ingredients;
    ALTER TABLE recipe_ingredients_new RENAME TO recipe_ingredients;
  `);
}

function migrateBaseTable(): void {
  if (!hasColumn("base_items", "unit")) return;
  db.exec(`
    CREATE TABLE base_items_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      amount_kind TEXT NOT NULL CHECK (amount_kind IN ('measured','count','container','unquantified')),
      amount_value REAL,
      amount_measure TEXT CHECK (amount_measure IN ('gram','ml')),
      amount_item TEXT
    );

    INSERT INTO base_items_new (id, name, amount_kind, amount_value, amount_measure, amount_item)
    SELECT
      id,
      name,
      CASE unit
        WHEN 'gram' THEN 'measured'
        WHEN 'ml' THEN 'measured'
        WHEN 'piece' THEN 'count'
        WHEN 'clove' THEN 'count'
        WHEN 'package' THEN 'container'
        ELSE 'unquantified'
      END,
      CASE WHEN unit IN ('gram','ml','piece','clove','package') THEN quantity ELSE NULL END,
      CASE WHEN unit = 'gram' THEN 'gram' WHEN unit = 'ml' THEN 'ml' ELSE NULL END,
      CASE WHEN unit = 'clove' THEN 'zehe' ELSE NULL END
    FROM base_items;

    DROP TABLE base_items;
    ALTER TABLE base_items_new RENAME TO base_items;
  `);
}

function rebuildLegacyTables(): void {
  const needsIngredientRebuild = hasColumn("recipe_ingredients", "unit");
  const needsBaseRebuild = hasColumn("base_items", "unit");
  if (!needsIngredientRebuild && !needsBaseRebuild) return;
  db.pragma("foreign_keys = OFF");
  try {
    const rebuild = db.transaction(() => {
      migrateIngredientTable();
      migrateBaseTable();
    });
    rebuild();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL UNIQUE,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

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

  db.exec(CREATE_RECIPE_INGREDIENTS + CREATE_BASE_ITEMS);
  rebuildLegacyTables();
}
