import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { config } from "../config";
import { extractJsonPayload, findProductArray, textFromResult } from "./mcp";
import { normalizeProduct } from "./normalize";
import type { GroceryClient, ProductCandidate } from "./types";

export const KNUSPR_TOOLS = {
  search: "search_products",
  batchSearch: "batch_search_products",
  addToCart: "add_items_to_cart",
  getCart: "get_cart",
} as const;

export function createKnusprTransport(): Transport {
  return new StreamableHTTPClientTransport(new URL(config.knuspr.mcpUrl), {
    requestInit: {
      headers: {
        "rhl-email": config.knuspr.email,
        "rhl-pass": config.knuspr.password,
      },
    },
  });
}

export async function createKnusprClient(): Promise<GroceryClient> {
  const mcp = new Client({ name: "grocery-bot", version: "1.0.0" });
  await mcp.connect(createKnusprTransport());

  async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await mcp.callTool({ name, arguments: args });
    if ((result as { isError?: boolean }).isError) {
      throw new Error(`Knuspr MCP Fehler bei ${name}.`);
    }
    return extractJsonPayload(textFromResult(result));
  }

  return {
    async searchProducts(keyword: string, limit = 10): Promise<ProductCandidate[]> {
      const payload = await callTool(KNUSPR_TOOLS.search, { keyword, limit });
      return findProductArray(payload)
        .map(normalizeProduct)
        .filter((candidate): candidate is ProductCandidate => candidate !== null);
    },
    async addToCart(productId: string, amount: number): Promise<void> {
      const result = await mcp.callTool({
        name: KNUSPR_TOOLS.addToCart,
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
