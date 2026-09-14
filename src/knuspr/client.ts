import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { config } from "../config";
import { parsePackageAmount, type PackageAmount } from "../mapping/quantity";

export const TOOLS = {
  search: "search_products",
  batchSearch: "batch_search_products",
  addToCart: "add_items_to_cart",
  getCart: "get_cart",
} as const;

export interface ProductCandidate {
  productId: string;
  name: string;
  price: number;
  unitAmount: number | null;
  unitAmountUnit: PackageAmount["unit"] | null;
  onDeal: boolean;
}

export interface KnusprClient {
  searchProducts(keyword: string, limit?: number): Promise<ProductCandidate[]>;
  addToCart(productId: string, amount: number): Promise<void>;
  close(): Promise<void>;
}

function textFromResult(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type?: string; text?: string } =>
        typeof part === "object" && part !== null,
    )
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
}

function extractJsonPayload(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // keep trying
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // keep trying
    }
  }
  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    try {
      return JSON.parse(trimmed.slice(arrayStart, arrayEnd + 1));
    } catch {
      // keep trying
    }
  }
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    try {
      return JSON.parse(trimmed.slice(objectStart, objectEnd + 1));
    } catch {
      // give up
    }
  }
  return null;
}

function findProductArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["products", "results", "items", "data", "hits"]) {
      if (Array.isArray(record[key])) {
        return record[key] as unknown[];
      }
    }
  }
  return [];
}

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
  if (lower.includes("kg") || lower.includes("gram") || lower === "g") return "gram";
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

export async function createKnusprClient(): Promise<KnusprClient> {
  const transport = new StreamableHTTPClientTransport(new URL(config.knusprMcpUrl), {
    requestInit: {
      headers: {
        "rhl-email": config.knusprEmail,
        "rhl-pass": config.knusprPassword,
      },
    },
  });
  const mcp = new Client({ name: "grocery-bot", version: "1.0.0" });
  await mcp.connect(transport);

  async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await mcp.callTool({ name, arguments: args });
    if ((result as { isError?: boolean }).isError) {
      throw new Error(`Knuspr MCP Fehler bei ${name}.`);
    }
    return extractJsonPayload(textFromResult(result));
  }

  return {
    async searchProducts(keyword: string, limit = 10): Promise<ProductCandidate[]> {
      const payload = await callTool(TOOLS.search, { keyword, limit });
      return findProductArray(payload)
        .map(normalizeProduct)
        .filter((candidate): candidate is ProductCandidate => candidate !== null);
    },
    async addToCart(productId: string, amount: number): Promise<void> {
      const result = await mcp.callTool({
        name: TOOLS.addToCart,
        arguments: { items: [{ productId, quantity: amount }] },
      });
      if ((result as { isError?: boolean }).isError) {
        throw new Error("Knuspr MCP Fehler beim Hinzufügen zum Warenkorb.");
      }
    },
    async close(): Promise<void> {
      await mcp.close();
    },
  };
}
