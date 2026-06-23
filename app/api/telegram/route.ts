import { NextRequest, NextResponse } from "next/server";
import { chat } from "@/lib/agent";
import { TelegramClient } from "@/lib/telegram";

const telegram = new TelegramClient();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const message = body?.message;
    const chatId: number | undefined = message?.chat?.id;
    const text: string | undefined = message?.text;

    if (chatId && text) {
      const reply = await chat(chatId, text);
      await telegram.sendMessage(chatId, reply);
    }
  } catch (err) {
    console.error("[telegram] error:", err);
  }

  // Always return 200 — non-200 causes Telegram to retry
  return NextResponse.json({ ok: true });
}
