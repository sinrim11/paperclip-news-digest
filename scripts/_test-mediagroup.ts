// sendCardnewsToTelegram 액션과 동일 경로 검증 — fetch + FormData sendMediaGroup
import { readFileSync } from 'fs';
import { join } from 'path';
async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('env 없음');
  const date = process.argv[2] ?? '2026-08-10';
  const idx = JSON.parse(readFileSync(join(process.cwd(), 'output', 'cardnews', 'index.json'), 'utf-8'));
  const set = idx.find((s: { dir?: string; date: string }) => (s.dir ?? s.date) === date);
  if (!set) throw new Error('세트 없음');
  const form = new FormData();
  const media = set.files.map((f: string, i: number) => ({
    type: 'photo', media: `attach://f${i}`,
    ...(i === 0 ? { caption: `🏠 매수 레이더 카드뉴스 · ${date} (개편판 — 비교표·평단가·추이·호재·전망 추가)` } : {}),
  }));
  form.set('chat_id', chatId);
  form.set('media', JSON.stringify(media));
  for (let i = 0; i < set.files.length; i++) {
    const buf = readFileSync(join(process.cwd(), 'output', 'cardnews', date, set.files[i]));
    form.set(`f${i}`, new Blob([new Uint8Array(buf)], { type: 'image/png' }), set.files[i]);
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMediaGroup`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
  const j = await res.json();
  console.log('sendMediaGroup ok:', j.ok, j.ok ? `(${j.result?.length}장)` : JSON.stringify(j).slice(0, 200));
}
main();
