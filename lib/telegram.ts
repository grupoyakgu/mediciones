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
}
