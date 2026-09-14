import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { config } from "../src/config";
import { createGroceryTransport } from "../src/grocery";

async function main(): Promise<void> {
  const transport = createGroceryTransport();
  const client = new Client({ name: "grocery-bot-check", version: "1.0.0" });
  await client.connect(transport, { timeout: 120_000 });
  console.log(`Provider: ${config.provider}`);
  const tools = await client.listTools();
  console.log(JSON.stringify(tools, null, 2));
  await client.close();
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
