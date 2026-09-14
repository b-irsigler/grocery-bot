import OpenAI from "openai";
import { config } from "../config";
import type { ChatMessage, LlmClient } from "./types";

export function createLlmClient(): LlmClient {
  const client = new OpenAI({ apiKey: config.llmApiKey, baseURL: config.llmBaseUrl });
  return {
    async complete(
      messages: ChatMessage[],
      options?: { temperature?: number },
    ): Promise<string> {
      const response = await client.chat.completions.create({
        model: config.llmModel,
        messages: messages as OpenAI.ChatCompletionMessageParam[],
        temperature: options?.temperature ?? 0,
      });
      return response.choices[0]?.message?.content ?? "";
    },
  };
}
