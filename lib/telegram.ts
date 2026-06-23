export class TelegramClient {
  private readonly apiBase: string;

  constructor(token?: string) {
    const t = token ?? process.env.TELEGRAM_BOT_TOKEN;
    if (!t) throw new Error("Telegram bot token is not set");
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
}
