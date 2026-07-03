/**
 * scripts/collect-realestate.ts — 부동산 데이터 일일 수집 러너
 * (launchd com.news-digest.collect, 매일 06:00 — 06:30 브리핑 전에 데이터 준비)
 *
 * 1. 국토부 실거래 매매+전월세: 동작·관악·영등포, 당월+전월
 * 2. 청약홈 분양·무순위 공고(서울) → 신규 공고 Telegram 즉시 알림
 * 3. 네이버 매물 스냅샷 (관심 단지, 차단 시 무시)
 *
 * 실행: scripts/collect-realestate.sh (env 로드 포함)
 */

import { PrismaClient } from '@prisma/client';
import { collectAptTrades, collectAptRents } from '../src/lib/collectors/molit';
import { collectSubscriptionNotices } from '../src/lib/collectors/applyhome';
import { collectListingSnapshots } from '../src/lib/collectors/naver-land';
import { sendTelegram } from '../src/lib/telegram';

const prisma = new PrismaClient();

const DISTRICTS: Array<{ lawdCd: string; name: string }> = [
  { lawdCd: '11590', name: '동작구' },
  { lawdCd: '11620', name: '관악구' },
  { lawdCd: '11560', name: '영등포구' },
];

function recentMonths(n: number): string[] {
  const kst = new Date(Date.now() + 9 * 3_600_000);
  const months: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - i, 1));
    months.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

async function main() {
  const ts = () => new Date().toISOString().slice(0, 19);
  console.log(`[collect] ${ts()} start`);

  // ── 1. 실거래 (당월 + 전월 — 신고 지연 30일 커버) ──────────────────────────
  let newTrades = 0;
  let newRents = 0;
  for (const d of DISTRICTS) {
    for (const ym of recentMonths(2)) {
      try {
        newTrades += await collectAptTrades(prisma, d.lawdCd, ym);
      } catch (err) {
        console.error(`[collect] trades ${d.name} ${ym}:`, err);
      }
      try {
        newRents += await collectAptRents(prisma, d.lawdCd, ym);
      } catch (err) {
        console.error(`[collect] rents ${d.name} ${ym}:`, err);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  console.log(`[collect] 실거래: 매매 +${newTrades} · 전월세 +${newRents}`);

  // ── 2. 청약 공고 — 신규 발견 시 Telegram 즉시 알림 ─────────────────────────
  let freshCount = 0;
  try {
    const fresh = await collectSubscriptionNotices(prisma, '서울', 60);
    freshCount = fresh.length;
    if (fresh.length > 0) {
      const lines = fresh.slice(0, 6).map((n) => {
        const period = n.rceptBegin ? ` · 접수 ${n.rceptBegin}${n.rceptEnd ? `~${n.rceptEnd}` : ''}` : '';
        return `· [${n.noticeType}] ${n.houseName}${period}\n  ${n.address ?? ''}`;
      });
      await sendTelegram(
        `🏗️ 신규 청약 공고 감지 (서울 ${fresh.length}건)\n${lines.join('\n')}\n\n📊 ${process.env.PUBLIC_DASHBOARD_URL ?? 'http://localhost:3200'}/tracker`,
      );
      for (const n of fresh) {
        await prisma.subscriptionNotice.update({ where: { id: n.id }, data: { notifiedAt: new Date() } });
      }
    }
  } catch (err) {
    console.error('[collect] applyhome:', err);
  }
  console.log(`[collect] 청약 공고: 신규 ${freshCount}건`);

  // ── 3. 네이버 매물 스냅샷 (비치명 — 차단 시 skip) ──────────────────────────
  let snaps = 0;
  try {
    snaps = await collectListingSnapshots(prisma);
  } catch (err) {
    console.error('[collect] naver:', err);
  }
  console.log(`[collect] 매물 스냅샷: ${snaps}건`);

  console.log(`[collect] ${ts()} done`);
}

main()
  .catch((err) => {
    console.error('[collect] fatal:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
