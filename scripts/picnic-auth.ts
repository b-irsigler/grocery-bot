import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { config } from "../src/config";
import { createGroceryTransport } from "../src/grocery";
import { textFromResult } from "../src/grocery/mcp";

const GENERATE_TOOL = "picnic_generate_2fa_code";
const VERIFY_TOOL = "picnic_verify_2fa_code";

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<void> {
  const result = await client.callTool({ name, arguments: args });
  if ((result as { isError?: boolean }).isError) {
    throw new Error(`${name} fehlgeschlagen: ${textFromResult(result)}`);
  }
}

async function main(): Promise<void> {
  if (config.provider !== "picnic") {
    console.error("Dieses Skript ist nur für GROCERY_PROVIDER=picnic gedacht.");
    process.exit(1);
  }

  // Accounts using an authenticator app can pass --manual to skip SMS generation.
  const manual = process.argv.includes("--manual");
  const client = new Client({ name: "grocery-bot-auth", version: "1.0.0" });

  try {
    await client.connect(createGroceryTransport(), { timeout: 120_000 });

    if (!manual) {
      await callTool(client, GENERATE_TOOL, { channel: "SMS" });
      console.log("2FA-Code per SMS angefordert.");
    }

    const rl = createInterface({ input, output });
    let code: string;
    try {
      code = await Promise.race([
        rl.question("2FA-Code eingeben: "),
        new Promise<never>((_, reject) => {
          rl.once("close", () =>
            reject(new Error("Eingabe abgebrochen (kein Code eingegeben).")),
          );
        }),
      ]);
    } finally {
      rl.close();
    }
    code = code.trim();
    if (code.length === 0) {
      throw new Error("Kein Code eingegeben.");
    }

    await callTool(client, VERIFY_TOOL, { code });
    console.log("2FA erfolgreich verifiziert. Sitzung gespeichert.");
    console.log("Die Bot-Sitzung kann Picnic jetzt ohne erneute 2FA verwenden.");
  } finally {
    await client.close().catch(() => undefined);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
