/**
 * scripts/send-recommendations.ts — config/recommendations.json을 텔레그램으로 발송(수동/큐레이션용).
 * 자동 일일 파이프라인은 scripts/daily-recommend.ts(엔진→발송→로그) 사용.
 *
 * 실행: npx tsx scripts/send-recommendations.ts [--dry] [--limit N]
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { sendTelegram } from '../src/lib/telegram';
import { header, formatReco, type RecoView } from '../src/lib/reco-format';

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const limIdx = args.indexOf('--limit');
  const limit = Math.min(5, limIdx >= 0 ? Number(args[limIdx + 1]) || 5 : 5);

  const cfg = JSON.parse(readFileSync(join(process.cwd(), 'config', 'recommendations.json'), 'utf-8')) as { asOf: string; items: RecoView[] };
  const items = cfg.items.slice(0, limit);
  const messages = [header(items.length, cfg.asOf), ...items.map(formatReco)];

  if (dry) {
    for (const m of messages) {
      console.log('\n────────── MESSAGE ──────────');
      console.log(m);
    }
    console.log(`\n[dry] 총 ${messages.length}개 메시지(헤더1 + 매물${items.length}). 실제 전송하려면 --dry 없이 실행.`);
    return;
  }

  let sent = 0;
  for (const m of messages) {
    if (await sendTelegram(m)) sent++;
    else console.error('[send-reco] 전송 실패 — 토큰/CHAT_ID 확인');
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(`[send-reco] ${sent}/${messages.length} 메시지 전송 완료`);
}

main().catch((e) => {
  console.error('[send-reco] fatal:', e);
  process.exitCode = 1;
});
