import "dotenv/config";
import { z } from "zod";

// dotenv turns `KEY=` into "" — treat blank values of optional/defaulted vars as
// unset so the inactive provider's blank credentials don't fail validation.
const emptyToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  ALLOWED_CHAT_IDS: z.string().min(1),
  LLM_API_KEY: z.string().min(1),
  LLM_BASE_URL: z.string().url(),
  LLM_MODEL: z.string().min(1),

  GROCERY_PROVIDER: emptyToUndefined(z.enum(["knuspr", "picnic"]).default("knuspr")),

  KNUSPR_MCP_URL: emptyToUndefined(
    z.string().url().default("https://mcp.knuspr.de/mcp"),
  ),
  KNUSPR_EMAIL: emptyToUndefined(z.string().min(1).optional()),
  KNUSPR_PASSWORD: emptyToUndefined(z.string().min(1).optional()),

  PICNIC_MCP_COMMAND: emptyToUndefined(z.string().min(1).default("npx")),
  PICNIC_MCP_ARGS: emptyToUndefined(
    z.string().min(1).default("-y mcp-picnic@1.15.1"),
  ),
  PICNIC_USERNAME: emptyToUndefined(z.string().min(1).optional()),
  PICNIC_PASSWORD: emptyToUndefined(z.string().min(1).optional()),
  PICNIC_COUNTRY_CODE: emptyToUndefined(z.enum(["DE", "NL"]).default("DE")),

  DB_PATH: emptyToUndefined(z.string().min(1).default("./data/grocery.db")),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
  console.error(`Fehlende oder ungültige Konfiguration: ${problems}`);
  process.exit(1);
}

const data = parsed.data;
const missing: string[] = [];
if (data.GROCERY_PROVIDER === "knuspr") {
  if (!data.KNUSPR_EMAIL) missing.push("KNUSPR_EMAIL");
  if (!data.KNUSPR_PASSWORD) missing.push("KNUSPR_PASSWORD");
}
if (data.GROCERY_PROVIDER === "picnic") {
  if (!data.PICNIC_USERNAME) missing.push("PICNIC_USERNAME");
  if (!data.PICNIC_PASSWORD) missing.push("PICNIC_PASSWORD");
}
if (missing.length > 0) {
  console.error(`Fehlende oder ungültige Konfiguration: ${missing.join(", ")}`);
  process.exit(1);
}

export const config = {
  telegramBotToken: data.TELEGRAM_BOT_TOKEN,
  allowedChatIds: data.ALLOWED_CHAT_IDS.split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0),
  llmApiKey: data.LLM_API_KEY,
  llmBaseUrl: data.LLM_BASE_URL,
  llmModel: data.LLM_MODEL,
  provider: data.GROCERY_PROVIDER,
  shopName: data.GROCERY_PROVIDER === "picnic" ? "Picnic" : "Knuspr",
  knuspr: {
    mcpUrl: data.KNUSPR_MCP_URL,
    email: data.KNUSPR_EMAIL ?? "",
    password: data.KNUSPR_PASSWORD ?? "",
  },
  picnic: {
    command: data.PICNIC_MCP_COMMAND,
    args: data.PICNIC_MCP_ARGS.split(" ")
      .map((arg) => arg.trim())
      .filter((arg) => arg.length > 0),
    username: data.PICNIC_USERNAME ?? "",
    password: data.PICNIC_PASSWORD ?? "",
    countryCode: data.PICNIC_COUNTRY_CODE,
  },
  dbPath: data.DB_PATH,
};
