/**
 * scripts/daily-recommend.ts — 일일 매물 추천 자동 파이프라인 (launchd 08:30).
 *
 * 규칙 엔진(recommend-engine)으로 오늘의 후보 산출 → 텔레그램 발송 → 로테이션 로그 기록.
 * 변화 없으면(쿨다운) '신규 없음' 알림. 06:00 실거래 수집 + 07:00 시장리서치(market-context) 이후 실행.
 *
 * 실행: npx tsx scripts/daily-recommend.ts [--dry]
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { buildDailyRecommendations } from '../src/lib/recommend-engine';
import { sendTelegram } from '../src/lib/telegram';
import { header, formatReco, emptyMessage, gapHeader, formatGapReco, stretchHeader, formatStretchReco } from '../src/lib/reco-format';

const prisma = new PrismaClient();

async function main() {
  const dry = process.argv.includes('--dry');
  const { asOf, items, stretchPlus, gapTrack, note } = await buildDailyRecommendations(prisma);
  console.log(`[daily-reco] ${asOf} — ${note}`);

  const messages = items.length ? [header(items.length, asOf), ...items.map(formatReco)] : [emptyMessage(asOf)];
  // 스트레치+ 트랙(조금 더 보태면 사정권) — 메인 하단 별도 섹션
  if (stretchPlus.length) messages.push(stretchHeader(stretchPlus.length, asOf), ...stretchPlus.map(formatStretchReco));
  // 갭투자 트랙(비규제) — 별도 섹션으로 이어서 발송
  if (gapTrack.length) messages.push(gapHeader(gapTrack.length, asOf), ...gapTrack.map(formatGapReco));

  if (dry) {
    for (const m of messages) console.log('\n────────── MESSAGE ──────────\n' + m);
    console.log(`\n[dry] ${messages.length}개 메시지 (dry — 저장/발송/로그 없음)`);
    return;
  }

  // 산출물 저장(웹/검수용)
  writeFileSync(join(process.cwd(), 'config', 'recommendations.json'), JSON.stringify({ _comment: 'daily-recommend 자동 생성', asOf, items, stretchPlus, gapTrack }, null, 2));

  // 발송
  let sent = 0;
  for (const m of messages) {
    if (await sendTelegram(m)) sent++;
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(`[daily-reco] ${sent}/${messages.length} 메시지 전송`);

  // 로테이션 로그(발송된 매물 — 메인+스트레치+·갭트랙 모두 쿨다운. 스트레치+는 scenario로 구분되어 엔진에서 트랙별 쿨다운 분리)
  const logged = [...items, ...stretchPlus, ...gapTrack];
  if (logged.length) {
    for (const r of logged) {
      await prisma.sentRecommendation.create({
        data: {
          complexKey: r.complexKey,
          name: r.name,
          gu: r.gu,
          dong: r.dong,
          medianManwon: r.medianManwon,
          score: r.score,
          scenario: r.scenario,
          rank: r.rank,
          reasons: r.reasons,
          sentDate: asOf,
        },
      });
    }
    console.log(`[daily-reco] 로테이션 로그 ${logged.length}건 기록 (메인 ${items.length} · 스트레치+ ${stretchPlus.length} · 갭 ${gapTrack.length})`);
  }
}

main()
  .catch((e) => {
    console.error('[daily-reco] fatal:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
