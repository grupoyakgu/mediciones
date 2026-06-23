import { NextRequest, NextResponse } from "next/server";
import { chatArchitect } from "@/lib/architect-agent";
import { TelegramClient } from "@/lib/telegram";
import { parseFile, isSupportedFile } from "@/lib/file-parser";

const telegram = new TelegramClient(process.env.ARCHITECT_BOT_TOKEN);
const BOT_USERNAME = "@GYArchitect_bot";

function isMentioned(
  text: string,
  entities: Array<{ type: string; offset: number; length: number }> = []
): boolean {
  return entities.some(
    (e) =>
      e.type === "mention" &&
      text.slice(e.offset, e.offset + e.length).toLowerCase() === BOT_USERNAME.toLowerCase()
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = body?.message;
    const chatId: number | undefined = message?.chat?.id;
    const chatType: string | undefined = message?.chat?.type;

    if (!chatId) return NextResponse.json({ ok: true });

    const isPrivate = chatType === "private";
    const isGroup = chatType === "group" || chatType === "supergroup";

    let userMessage: string | undefined;

    if (message?.document) {
      const doc = message.document;
      const caption: string = message.caption ?? "";
      const captionEntities = message.caption_entities ?? [];
      const mentioned = isPrivate || (isGroup && isMentioned(caption, captionEntities));

      if (mentioned && isSupportedFile(doc.mime_type ?? "", doc.file_name ?? "")) {
        try {
          const buffer = await telegram.downloadFile(doc.file_id);
          const content = await parseFile(buffer, doc.mime_type ?? "", doc.file_name ?? "");
          userMessage = `[Archivo recibido: ${doc.file_name}]\n${caption ? `Nota: ${caption}\n` : ""}\n${content}`;
        } catch {
          await telegram.sendMessage(chatId, `❌ No se pudo leer el archivo ${doc.file_name}. Formatos soportados: PDF, CSV, XLSX, XLS.`);
          return NextResponse.json({ ok: true });
        }
      }
    } else if (message?.text) {
      const entities = message.entities ?? [];
      if (isPrivate || (isGroup && isMentioned(message.text, entities))) {
        userMessage = message.text;
      }
    }

    if (userMessage) {
      const reply = await chatArchitect(chatId, userMessage);
      await telegram.sendMessage(chatId, reply);
    }
  } catch (err) {
    console.error("[GYArchitect_bot] error:", err);
  }

  return NextResponse.json({ ok: true });
}
