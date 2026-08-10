/**
 * scripts/telegram-feedback-bot.ts — 추천 피드백 상시 수신 봇 (2026-08-11).
 *
 * getUpdates 롱폴링으로 [👍 관심 / 🚫 제외] 버튼 콜백을 받아 config/reco-feedback.json에
 * 기록하고, 버튼을 "반영됨(탭하면 취소)" 상태로 교체한다. 추천 엔진(08:30)이 다음 날부터 반영.
 * 실행: launchd com.news-digest.feedback-bot (KeepAlive — scripts/telegram-feedback-bot.sh)
 * 주의: 같은 봇 토큰으로 getUpdates를 쓰는 프로세스는 이것 하나여야 한다(409 Conflict).
 */

import { loadFeedback, saveFeedback, type FeedbackStatus } from '../src/lib/reco-feedback';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
if (!TOKEN || !CHAT_ID) {
  console.error('[feedback-bot] TELEGRAM env 미설정 — 종료');
  process.exit(1);
}
const API = `https://api.telegram.org/bot${TOKEN}`;

async function tg(method: string, payload: Record<string, unknown>, timeoutMs = 15_000): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return (await res.json()) as Record<string, unknown>;
}

interface CallbackQuery {
  id: string;
  data?: string;
  message?: { message_id: number; chat: { id: number } };
}

async function handleCallback(cb: CallbackQuery): Promise<void> {
  const [tag, hash, action] = (cb.data ?? '').split('|');
  if (tag !== 'fb' || !hash || !action) return;
  const store = loadFeedback();
  const entry = store.keymap[hash];
  if (!entry) {
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: '만료된 버튼 — 최신 추천에서 다시 시도하세요' });
    return;
  }
  let ack: string;
  let keyboard: Array<Array<{ text: string; callback_data: string }>>;
  if (action === 'clear') {
    delete store.feedback[entry.complexKey];
    ack = `↩️ ${entry.name} — 피드백 취소됨`;
    keyboard = [[
      { text: '👍 관심', callback_data: `fb|${hash}|like` },
      { text: '🚫 제외', callback_data: `fb|${hash}|ban` },
    ]];
  } else if (action === 'like' || action === 'ban') {
    store.feedback[entry.complexKey] = { status: action as FeedbackStatus, name: entry.name, at: new Date().toISOString().slice(0, 10) };
    ack = action === 'like' ? `❤️ ${entry.name} — 관심 반영(추천 가점, 내일부터)` : `🚫 ${entry.name} — 향후 추천에서 제외`;
    keyboard = [[{ text: action === 'like' ? '❤️ 관심 반영됨 (탭하면 취소)' : '🚫 제외 반영됨 (탭하면 취소)', callback_data: `fb|${hash}|clear` }]];
  } else {
    return;
  }
  saveFeedback(store);
  await tg('answerCallbackQuery', { callback_query_id: cb.id, text: ack });
  if (cb.message) {
    await tg('editMessageReplyMarkup', {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      reply_markup: { inline_keyboard: keyboard },
    }).catch(() => {});
  }
  console.log(`[feedback-bot] ${ack}`);
}

async function main() {
  console.log('[feedback-bot] 시작 — 콜백 롱폴링');
  for (;;) {
    try {
      const store = loadFeedback();
      const res = (await tg('getUpdates', { offset: store._offset ?? 0, timeout: 50, allowed_updates: ['callback_query'] }, 60_000)) as {
        ok?: boolean; result?: Array<{ update_id: number; callback_query?: CallbackQuery }>; description?: string;
      };
      if (!res.ok) {
        console.error('[feedback-bot] getUpdates 오류:', res.description);
        await new Promise((r) => setTimeout(r, 30_000));
        continue;
      }
      for (const u of res.result ?? []) {
        if (u.callback_query) await handleCallback(u.callback_query).catch((e) => console.error('[feedback-bot] 처리 오류:', e));
        const s = loadFeedback();
        s._offset = u.update_id + 1;
        saveFeedback(s);
      }
    } catch (e) {
      console.error('[feedback-bot] 루프 오류(30초 후 재시도):', e instanceof Error ? e.message.slice(0, 120) : e);
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
}

main();
