export const UNITS = ["piece", "clove", "gram", "ml", "package"] as const;
export type Unit = (typeof UNITS)[number];

const COUNTABLE: ReadonlySet<Unit> = new Set(["piece", "clove", "package"]);

export function isUnit(value: unknown): value is Unit {
  return typeof value === "string" && (UNITS as readonly string[]).includes(value);
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
