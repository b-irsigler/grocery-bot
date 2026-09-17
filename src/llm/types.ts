export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompleteOptions {
  temperature?: number;
  responseFormat?: unknown;
}

export interface LlmClient {
  complete(messages: ChatMessage[], options?: CompleteOptions): Promise<string>;
}
