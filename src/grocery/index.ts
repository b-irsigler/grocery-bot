import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { config } from "../config";
import { createKnusprClient, createKnusprTransport } from "./knuspr";
import { createPicnicClient, createPicnicTransport } from "./picnic";
import type { GroceryClient } from "./types";

export type { GroceryClient, ProductCandidate } from "./types";

export function createGroceryTransport(): Transport {
  return config.provider === "picnic" ? createPicnicTransport() : createKnusprTransport();
}

export async function createGroceryClient(): Promise<GroceryClient> {
  return config.provider === "picnic" ? createPicnicClient() : createKnusprClient();
}
