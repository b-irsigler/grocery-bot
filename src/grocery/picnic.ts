import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { config } from "../config";
import { extractJsonPayload, findProductArray, textFromResult } from "./mcp";
import { normalizePicnicProduct } from "./normalize";
import type { GroceryClient, ProductCandidate } from "./types";

export const PICNIC_TOOLS = {
  search: "picnic_search",
  addToCart: "picnic_add_to_cart",
} as const;

export function createPicnicTransport(): Transport {
  return new StdioClientTransport({
    command: config.picnic.command,
    args: config.picnic.args,
    env: {
      ...getDefaultEnvironment(),
      PICNIC_USERNAME: config.picnic.username,
      PICNIC_PASSWORD: config.picnic.password,
      PICNIC_COUNTRY_CODE: config.picnic.countryCode,
    },
    stderr: "inherit",
  });
}

export async function createPicnicClient(): Promise<GroceryClient> {
  const mcp = new Client({ name: "grocery-bot", version: "1.0.0" });
  // 120 s: a cold `npx` download of mcp-picnic can exceed the SDK's 60 s default.
  await mcp.connect(createPicnicTransport(), { timeout: 120_000 });

  async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await mcp.callTool({ name, arguments: args });
    if ((result as { isError?: boolean }).isError) {
      throw new Error(`Picnic MCP Fehler bei ${name}.`);
    }
    return extractJsonPayload(textFromResult(result));
  }

  return {
    async searchProducts(keyword: string, limit = 10): Promise<ProductCandidate[]> {
      const payload = await callTool(PICNIC_TOOLS.search, { query: keyword, limit });
      return findProductArray(payload)
        .map(normalizePicnicProduct)
        .filter((candidate): candidate is ProductCandidate => candidate !== null);
    },
    async addToCart(productId: string, amount: number): Promise<void> {
      await callTool(PICNIC_TOOLS.addToCart, { productId, count: amount });
    },
    async close(): Promise<void> {
      await mcp.close();
    },
  };
}
