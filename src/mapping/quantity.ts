import { isCountable, type Unit } from "../units";

export interface PackageAmount {
  amount: number;
  unit: "gram" | "ml" | "piece";
}

export interface PackageLike {
  unitAmount: number | null;
  unitAmountUnit: "gram" | "ml" | "piece" | null;
}

function parseNumber(raw: string): number {
  return Number.parseFloat(raw.replace(",", "."));
}

export function parsePackageAmount(name: string): PackageAmount | null {
  const multipack = name.match(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i);
  if (multipack) {
    const count = parseNumber(multipack[1] as string);
    const size = parseNumber(multipack[2] as string);
    const rawUnit = (multipack[3] as string).toLowerCase();
    const factor = rawUnit === "kg" || rawUnit === "l" ? 1000 : 1;
    const unit = rawUnit === "kg" || rawUnit === "g" ? "gram" : "ml";
    return { amount: count * size * factor, unit };
  }
  const weight = name.match(/(\d+(?:[.,]\d+)?)\s*(kg|g)\b/i);
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

export function roundUpToPackages(
  need: { quantity: number; unit: Unit },
  product: PackageLike,
): number {
  if (isCountable(need.unit)) {
    return Math.max(1, Math.ceil(need.quantity));
  }
  if (product.unitAmount === null || product.unitAmountUnit === null || product.unitAmount <= 0) {
    return Math.max(1, Math.ceil(need.quantity));
  }
  const compatible =
    (need.unit === "gram" && product.unitAmountUnit === "gram") ||
    (need.unit === "ml" && product.unitAmountUnit === "ml");
  if (!compatible) {
    return Math.max(1, Math.ceil(need.quantity));
  }
  return Math.max(1, Math.ceil(need.quantity / product.unitAmount));
}
