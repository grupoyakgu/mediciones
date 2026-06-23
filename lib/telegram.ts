export class TelegramClient {
  private readonly apiBase: string;
  private readonly token: string;

  constructor(token?: string) {
    const t = token ?? process.env.TELEGRAM_BOT_TOKEN;
    if (!t) throw new Error("Telegram bot token is not set");
    this.token = t;
    this.apiBase = `https://api.telegram.org/bot${t}`;
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    const MAX = 4000;
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += MAX) {
      chunks.push(text.slice(i, i + MAX));
    }
    for (const chunk of chunks) {
      const res = await fetch(`${this.apiBase}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: chunk }),
      });
      if (!res.ok) {
        const error = await res.text();
        throw new Error(`Telegram sendMessage failed (${res.status}): ${error}`);
      }
    }
  }

  async downloadFile(fileId: string): Promise<Buffer> {
    const metaRes = await fetch(`${this.apiBase}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const meta = await metaRes.json();
    const filePath: string = meta.result.file_path;
    const fileRes = await fetch(`https://api.telegram.org/file/bot${this.token}/${filePath}`);
    return Buffer.from(await fileRes.arrayBuffer());
  }
}
