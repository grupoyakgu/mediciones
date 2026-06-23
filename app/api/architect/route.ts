import { NextRequest, NextResponse } from "next/server";
import { chatArchitect } from "@/lib/architect-agent";
import { TelegramClient } from "@/lib/telegram";

const telegram = new TelegramClient(process.env.ARCHITECT_BOT_TOKEN);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const message = body?.message;
    const chatId: number | undefined = message?.chat?.id;
    const text: string | undefined = message?.text;

    if (chatId && text) {
      const reply = await chatArchitect(chatId, text);
      await telegram.sendMessage(chatId, reply);
    }
  } catch (err) {
    console.error("[architect] error:", err);
  }

  return NextResponse.json({ ok: true });
}
