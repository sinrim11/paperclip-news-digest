/**
 * Telegram notification helper.
 * Sends a message via TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID; silently skips if unset.
 * Never hardcode credentials here — the previous bot token leaked via git history
 * and must stay env-only.
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export async function sendTelegram(text: string): Promise<boolean> {
  if (!BOT_TOKEN || !CHAT_ID) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => null) as { ok?: boolean } | null;
    if (!data?.ok) {
      console.error('[telegram] sendMessage failed:', res.status, JSON.stringify(data)?.slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.error('[telegram] Failed to send notification:', err);
    return false;
  }
}
