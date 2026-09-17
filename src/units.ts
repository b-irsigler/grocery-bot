export const UNITS = ["piece", "clove", "gram", "ml", "package"] as const;
export type Unit = (typeof UNITS)[number];

const COUNTABLE: ReadonlySet<Unit> = new Set(["piece", "clove", "package"]);

const UNIT_ALIASES: Readonly<Record<string, Unit>> = {
  g: "gram",
  gr: "gram",
  gramm: "gram",
  grams: "gram",
  ml: "ml",
  milliliter: "ml",
  millilitre: "ml",
  l: "ml",
  liter: "ml",
  litre: "ml",
  el: "ml",
  essloeffel: "ml",
  esslöffel: "ml",
  tablespoon: "ml",
  tl: "ml",
  teeloeffel: "ml",
  teelöffel: "ml",
  teaspoon: "ml",
  stueck: "piece",
  stück: "piece",
  stk: "piece",
  st: "piece",
  stck: "piece",
  x: "piece",
  scheibe: "piece",
  scheiben: "piece",
  zehe: "clove",
  zehen: "clove",
  knoblauchzehe: "clove",
  packung: "package",
  packungen: "package",
  pkg: "package",
  paket: "package",
  pack: "package",
  packerl: "package",
  dose: "package",
  glas: "package",
  beutel: "package",
  tuete: "package",
  tüte: "package",
  bund: "package",
  flasche: "package",
};

export function isUnit(value: unknown): value is Unit {
  return typeof value === "string" && (UNITS as readonly string[]).includes(value);
}

export function normalizeUnit(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const key = value.trim().toLowerCase();
  if (isUnit(key)) {
    return key;
  }
  return UNIT_ALIASES[key] ?? value;
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
