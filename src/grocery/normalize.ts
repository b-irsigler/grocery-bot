import { parsePackageAmount, type PackageAmount } from "../mapping/quantity";
import type { ProductCandidate } from "./types";

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value.replace(",", "."));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function pickBoolean(record: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string" && /^(true|yes|1|sale|ja)$/i.test(value)) return true;
  }
  return false;
}

function normalizeUnit(raw: string | null): PackageAmount["unit"] | null {
  if (raw === null) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("ml") || lower === "l" || lower.includes("liter")) return "ml";
  if (lower.includes("kg") || lower.includes("gram") || lower === "g" || lower === "gr") {
    return "gram";
  }
  if (lower.includes("st") || lower.includes("piece") || lower.includes("stück")) return "piece";
  return null;
}

export function normalizeProduct(raw: unknown): ProductCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const name = pickString(record, ["name", "title", "productName", "product_name"]);
  const productId = pickString(record, ["id", "productId", "product_id", "slug", "code"]);
  const price = pickNumber(record, ["price", "priceVat", "unitPrice", "salesPrice", "currentPrice"]);
  if (name === null || productId === null || price === null) return null;
  const parsed = parsePackageAmount(name);
  const explicitAmount = pickNumber(record, ["amount", "unitAmount", "packageAmount", "content"]);
  const explicitUnit = normalizeUnit(
    pickString(record, ["unit", "unitAmountUnit", "contentUnit", "measureUnit"]),
  );
  const onDeal =
    pickBoolean(record, ["onSale", "onDeal", "isOnSale", "discounted", "promotion", "deal"]) ||
    pickNumber(record, ["discount", "discountPercent", "savings"]) !== null;
  return {
    productId,
    name,
    price,
    unitAmount: explicitAmount ?? parsed?.amount ?? null,
    unitAmountUnit: explicitUnit ?? parsed?.unit ?? null,
    onDeal,
  };
}

// Picnic `picnic_search` returns { results: [{ id, name, price, unit, image_id? }] }.
// `price` is in cents; `unit` is a package string such as "500 g", "1 l", "6 st".
export function normalizePicnicProduct(raw: unknown): ProductCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const productId = typeof record.id === "string" ? record.id : null;
  const name = typeof record.name === "string" ? record.name : null;
  const rawPrice = typeof record.price === "number" ? record.price : null;
  if (productId === null || name === null || rawPrice === null) return null;
  const unitText = typeof record.unit === "string" ? record.unit : "";
  const parsed = parsePackageAmount(unitText) ?? parsePackageAmount(name);
  return {
    productId,
    name,
    price: rawPrice / 100,
    unitAmount: parsed?.amount ?? null,
    unitAmountUnit: parsed?.unit ?? null,
    onDeal: false,
  };
}
