export type Measure = "gram" | "ml";

export type Amount =
  | { kind: "measured"; value: number; measure: Measure }
  | { kind: "count"; value: number; item: string | null }
  | { kind: "container"; value: number }
  | { kind: "unquantified" };

export interface AmountColumns {
  kind: Amount["kind"];
  value: number | null;
  measure: Measure | null;
  item: string | null;
}

export const AMOUNT_KINDS = ["measured", "count", "container", "unquantified"] as const;
export const MEASURES = ["gram", "ml"] as const;

const ITEM_ALIASES: Readonly<Record<string, string>> = {
  zehe: "zehe",
  zehen: "zehe",
  knoblauchzehe: "zehe",
  knoblauchzehen: "zehe",
  clove: "zehe",
  cloves: "zehe",
  stueck: "stueck",
  stück: "stueck",
  stk: "stueck",
  st: "stueck",
  stck: "stueck",
  stuecke: "stueck",
  stücke: "stueck",
  piece: "stueck",
  pieces: "stueck",
  scheibe: "scheibe",
  scheiben: "scheibe",
  slice: "scheibe",
  slices: "scheibe",
  bund: "bund",
  buende: "bund",
  bünde: "bund",
  bunch: "bund",
  bunches: "bund",
  dose: "dose",
  dosen: "dose",
  can: "dose",
  cans: "dose",
  glas: "glas",
  glaeser: "glas",
  gläser: "glas",
  jar: "glas",
  jars: "glas",
  beutel: "beutel",
  bag: "beutel",
  bags: "beutel",
  flasche: "flasche",
  flaschen: "flasche",
  bottle: "flasche",
  bottles: "flasche",
  packung: "packung",
  packungen: "packung",
  package: "packung",
  pkg: "packung",
  paket: "packung",
  prise: "prise",
  prisen: "prise",
  pinch: "prise",
  pinches: "prise",
  handvoll: "handvoll",
};

export function normalizeItem(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  if (key.length === 0) return null;
  return ITEM_ALIASES[key] ?? key;
}

export function isMeasure(value: unknown): value is Measure {
  return typeof value === "string" && (MEASURES as readonly string[]).includes(value);
}

export function isAmountKind(value: unknown): value is Amount["kind"] {
  return typeof value === "string" && (AMOUNT_KINDS as readonly string[]).includes(value);
}

export function normalizeAmount(amount: Amount): Amount {
  switch (amount.kind) {
    case "measured":
      if (!Number.isFinite(amount.value) || amount.value <= 0 || !isMeasure(amount.measure)) {
        return { kind: "unquantified" };
      }
      return { kind: "measured", value: amount.value, measure: amount.measure };
    case "count":
      if (!Number.isFinite(amount.value) || amount.value <= 0) {
        return { kind: "unquantified" };
      }
      return { kind: "count", value: amount.value, item: normalizeItem(amount.item) };
    case "container":
      if (!Number.isFinite(amount.value) || amount.value <= 0) {
        return { kind: "unquantified" };
      }
      return { kind: "container", value: amount.value };
    default:
      return { kind: "unquantified" };
  }
}

export function buildAmount(
  kind: unknown,
  value: number | null | undefined,
  measure: string | null | undefined,
  item: string | null | undefined,
): Amount {
  if (kind === "measured" && typeof value === "number" && isMeasure(measure)) {
    return normalizeAmount({ kind: "measured", value, measure });
  }
  if (kind === "count" && typeof value === "number") {
    return normalizeAmount({ kind: "count", value, item: normalizeItem(item) });
  }
  if (kind === "container" && typeof value === "number") {
    return normalizeAmount({ kind: "container", value });
  }
  return { kind: "unquantified" };
}

export function amountToColumns(amount: Amount): AmountColumns {
  switch (amount.kind) {
    case "measured":
      return { kind: "measured", value: amount.value, measure: amount.measure, item: null };
    case "count":
      return { kind: "count", value: amount.value, measure: null, item: amount.item };
    case "container":
      return { kind: "container", value: amount.value, measure: null, item: null };
    default:
      return { kind: "unquantified", value: null, measure: null, item: null };
  }
}

export function amountFromColumns(
  kind: unknown,
  value: number | null,
  measure: string | null,
  item: string | null,
): Amount {
  return buildAmount(kind, value, measure, item);
}

export function amountKey(amount: Amount): string {
  switch (amount.kind) {
    case "measured":
      return `measured:${amount.measure}`;
    case "count":
      return `count:${amount.item ?? ""}`;
    case "container":
      return "container";
    default:
      return "unquantified";
  }
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

export function describeAmount(amount: Amount): string {
  switch (amount.kind) {
    case "measured":
      return `${formatNumber(amount.value)} ${amount.measure === "gram" ? "g" : "ml"}`;
    case "count":
      return `${formatNumber(amount.value)} ${amount.item ? amount.item : "Stück"}`;
    case "container":
      return `${formatNumber(amount.value)} × Packung`;
    default:
      return "etwas";
  }
}
