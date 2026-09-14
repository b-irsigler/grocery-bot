import type { Context, NextFunction } from "grammy";
import { config } from "../config";

export async function requireAllowedChat(ctx: Context, next: NextFunction): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined || !config.allowedChatIds.includes(String(chatId))) {
    return;
  }
  await next();
}
