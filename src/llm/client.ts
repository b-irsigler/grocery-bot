import OpenAI from "openai";
import { config } from "../config";
import type { ChatMessage, CompleteOptions, LlmClient } from "./types";

export function createLlmClient(): LlmClient {
  const client = new OpenAI({ apiKey: config.llmApiKey, baseURL: config.llmBaseUrl });
  return {
    async complete(messages: ChatMessage[], options?: CompleteOptions): Promise<string> {
      const response = await client.chat.completions.create({
        model: config.llmModel,
        messages: messages as OpenAI.ChatCompletionMessageParam[],
        temperature: options?.temperature ?? 0,
        response_format: options?.responseFormat as
          | OpenAI.ChatCompletionCreateParams["response_format"]
          | undefined,
      });
      return response.choices[0]?.message?.content ?? "";
    },
  };
}
