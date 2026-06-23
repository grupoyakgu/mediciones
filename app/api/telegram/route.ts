import { NextRequest, NextResponse } from "next/server";
import { chat } from "@/lib/agent";
import { TelegramClient } from "@/lib/telegram";

const telegram = new TelegramClient();
const BOT_USERNAME = "@yakgu_bot";

function isMentioned(text: string, entities: Array<{ type: string; offset: number; length: number }> = []): boolean {
  return entities.some(
    (e) => e.type === "mention" && text.slice(e.offset, e.offset + e.length).toLowerCase() === BOT_USERNAME.toLowerCase()
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const message = body?.message;
    const chatId: number | undefined = message?.chat?.id;
    const text: string | undefined = message?.text;
    const chatType: string | undefined = message?.chat?.type;
    const entities = message?.entities ?? [];

    if (chatId && text) {
      const isPrivate = chatType === "private";
      const isGroup = chatType === "group" || chatType === "supergroup";

      // In groups only respond when mentioned; in private always respond
      if (isPrivate || (isGroup && isMentioned(text, entities))) {
        const reply = await chat(chatId, text);
        await telegram.sendMessage(chatId, reply);
      }
    }
  } catch (err) {
    console.error("[yakgu_bot] error:", err);
  }

  return NextResponse.json({ ok: true });
}
