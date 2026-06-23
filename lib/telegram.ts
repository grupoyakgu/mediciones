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
    const res = await fetch(`${this.apiBase}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Telegram sendMessage failed (${res.status}): ${error}`);
    }
  }

  async downloadFile(fileId: string): Promise<Buffer> {
    const metaRes = await fetch(`${this.apiBase}/getFile?file_id=${encodeURIComponent(fileId)}`);
    if (!metaRes.ok) throw new Error(`getFile failed (${metaRes.status})`);
    const meta = await metaRes.json();
    const filePath: string = meta.result.file_path;
    const fileRes = await fetch(`https://api.telegram.org/file/bot${this.token}/${filePath}`);
    if (!fileRes.ok) throw new Error(`file download failed (${fileRes.status})`);
    return Buffer.from(await fileRes.arrayBuffer());
  }
}
