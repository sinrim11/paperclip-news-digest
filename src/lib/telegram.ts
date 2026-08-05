/**
 * Telegram notification helper.
 * Sends a message via TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID; silently skips if unset.
 * Never hardcode credentials here — the previous bot token leaked via git history
 * and must stay env-only.
 *
 * 2026-08-05: node:https + family:4 강제 + 재시도 2회로 강화.
 * 이 맥은 IPv6 라우트가 없어(EHOSTUNREACH) fetch(undici)가 간헐적으로 ETIMEDOUT —
 * 일일 자율 보고의 전달 신뢰성이 걸려 있어 IPv4 고정이 필요하다.
 */

import { request } from 'node:https';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function postJson(url: string, body: unknown, timeoutMs: number): Promise<{ status: number; json: { ok?: boolean } | null }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = request(
      url,
      {
        method: 'POST',
        family: 4, // IPv6 라우트 부재 환경 — IPv4 강제
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json: { ok?: boolean } | null = null;
          try { json = JSON.parse(data); } catch { json = null; }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    req.end(payload);
  });
}

export async function sendTelegram(text: string): Promise<boolean> {
  if (!BOT_TOKEN || !CHAT_ID) return false;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const body = { chat_id: CHAT_ID, text, disable_web_page_preview: true };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { status, json } = await postJson(url, body, 10_000);
      if (json?.ok) return true;
      console.error('[telegram] sendMessage failed:', status, JSON.stringify(json)?.slice(0, 200));
      if (status >= 400 && status < 500 && status !== 429) return false; // 재시도 무의미(잘못된 요청)
    } catch (err) {
      console.error(`[telegram] attempt ${attempt}/3 failed:`, err instanceof Error ? err.message : err);
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  return false;
}
