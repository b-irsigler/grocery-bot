import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { config } from "../src/config";

async function main(): Promise<void> {
  const transport = new StreamableHTTPClientTransport(new URL(config.knusprMcpUrl), {
    requestInit: {
      headers: {
        "rhl-email": config.knusprEmail,
        "rhl-pass": config.knusprPassword,
      },
    },
  });
  const client = new Client({ name: "grocery-bot-check", version: "1.0.0" });
  await client.connect(transport);
  const tools = await client.listTools();
  console.log(JSON.stringify(tools, null, 2));
  await client.close();
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
