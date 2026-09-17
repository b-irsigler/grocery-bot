import type { Amount } from "../amounts";

export interface PackageAmount {
  amount: number;
  unit: "gram" | "ml" | "piece";
}

export interface PackageLike {
  unitAmount: number | null;
  unitAmountUnit: "gram" | "ml" | "piece" | null;
}

export interface PackResolution {
  packs: number;
  exact: boolean;
}

function parseNumber(raw: string): number {
  return Number.parseFloat(raw.replace(",", "."));
}

export function parsePackageAmount(name: string): PackageAmount | null {
  const multipack = name.match(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|gr|g|ml|l)\b/i);
  if (multipack) {
    const count = parseNumber(multipack[1] as string);
    const size = parseNumber(multipack[2] as string);
    const rawUnit = (multipack[3] as string).toLowerCase();
    const factor = rawUnit === "kg" || rawUnit === "l" ? 1000 : 1;
    const unit = rawUnit === "kg" || rawUnit === "gr" || rawUnit === "g" ? "gram" : "ml";
    return { amount: count * size * factor, unit };
  }
  const weight = name.match(/(\d+(?:[.,]\d+)?)\s*(kg|gr|g)\b/i);
  if (weight) {
    const size = parseNumber(weight[1] as string);
    const isKg = (weight[2] as string).toLowerCase() === "kg";
    return { amount: isKg ? size * 1000 : size, unit: "gram" };
  }
  const volume = name.match(/(\d+(?:[.,]\d+)?)\s*(l|ml)\b/i);
  if (volume) {
    const size = parseNumber(volume[1] as string);
    const isLiter = (volume[2] as string).toLowerCase() === "l";
    return { amount: isLiter ? size * 1000 : size, unit: "ml" };
  }
  const pieces = name.match(/(\d+)\s*(stk|stück|stueck|st)\b/i);
  if (pieces) {
    return { amount: parseNumber(pieces[1] as string), unit: "piece" };
  }
  return null;
}

// Decides how many product packs satisfy a need. Deterministic where the units
// are comparable; `exact: false` signals the caller to fall back to the LLM.
export function resolvePackages(amount: Amount, product: PackageLike): PackResolution {
  const size = product.unitAmount;
  const sizeUnit = product.unitAmountUnit;
  switch (amount.kind) {
    case "measured":
      if (size !== null && size > 0 && sizeUnit === amount.measure) {
        return { packs: Math.max(1, Math.ceil(amount.value / size)), exact: true };
      }
      return { packs: 1, exact: false };
    case "count":
      if (sizeUnit === "piece" && size !== null && size > 0) {
        return { packs: Math.max(1, Math.ceil(amount.value / size)), exact: true };
      }
      return { packs: Math.max(1, Math.ceil(amount.value)), exact: true };
    case "container":
      return { packs: Math.max(1, Math.ceil(amount.value)), exact: true };
    default:
      return { packs: 1, exact: true };
  }
}
