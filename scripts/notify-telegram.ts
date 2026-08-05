/**
 * scripts/notify-telegram.ts — 셸 스크립트용 텔레그램 알림 CLI.
 * 자율 작업(수집·분석·리서치)의 실행 결과를 그때그때 사용자에게 보고하는 용도(2026-08-05 지시).
 *
 * 사용: npx tsx scripts/notify-telegram.ts "메시지 본문"
 * env(TELEGRAM_BOT_TOKEN/CHAT_ID) 미설정 시 조용히 종료 — 파이프라인을 죽이지 않는다.
 */

import { sendTelegram } from '../src/lib/telegram';

const msg = process.argv.slice(2).join(' ').trim();
if (!msg) {
  console.error('usage: npx tsx scripts/notify-telegram.ts "message"');
  process.exit(1);
}

sendTelegram(msg).then((ok) => {
  console.log(ok ? '[notify] 전송 완료' : '[notify] 전송 생략/실패');
});
