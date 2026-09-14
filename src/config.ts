import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  ALLOWED_CHAT_IDS: z.string().min(1),
  LLM_API_KEY: z.string().min(1),
  LLM_BASE_URL: z.string().url(),
  LLM_MODEL: z.string().min(1),
  KNUSPR_MCP_URL: z.string().url().default("https://mcp.knuspr.de/mcp"),
  KNUSPR_EMAIL: z.string().min(1),
  KNUSPR_PASSWORD: z.string().min(1),
  DB_PATH: z.string().min(1).default("./data/grocery.db"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues
    .map((issue) => issue.path.join("."))
    .join(", ");
  console.error(`Fehlende oder ungültige Konfiguration: ${problems}`);
  process.exit(1);
}

export const config = {
  telegramBotToken: parsed.data.TELEGRAM_BOT_TOKEN,
  allowedChatIds: parsed.data.ALLOWED_CHAT_IDS.split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0),
  llmApiKey: parsed.data.LLM_API_KEY,
  llmBaseUrl: parsed.data.LLM_BASE_URL,
  llmModel: parsed.data.LLM_MODEL,
  knusprMcpUrl: parsed.data.KNUSPR_MCP_URL,
  knusprEmail: parsed.data.KNUSPR_EMAIL,
  knusprPassword: parsed.data.KNUSPR_PASSWORD,
  dbPath: parsed.data.DB_PATH,
} as const;
