export class TelegramClient {
  private readonly apiBase: string;

  constructor() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
    this.apiBase = `https://api.telegram.org/bot${token}`;
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
    const metaRes = await fetch(`${this.apiBase}/getFile?file_id=${fileId}`)
    if (!metaRes.ok) throw new Error(`getFile failed: ${metaRes.status}`)
    const meta = await metaRes.json()
    const filePath: string = meta.result?.file_path
    if (!filePath) throw new Error('No file_path in getFile response')
    const token = process.env.ARCHITECT_BOT_TOKEN ?? process.env.TELEGRAM_BOT_TOKEN
    const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`)
    if (!fileRes.ok) throw new Error(`File download failed: ${fileRes.status}`)
    return Buffer.from(await fileRes.arrayBuffer())
  }
}
