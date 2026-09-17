const NULLISH = new Set(["", "null", "none", "n/a", "na", "keine", "-"]);

export function nullify(value: unknown): unknown {
  if (typeof value === "string" && NULLISH.has(value.trim().toLowerCase())) {
    return null;
  }
  return value;
}
