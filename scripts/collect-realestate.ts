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

// 서울 25구 전체(1-B-ii 확대) + 경기 남부 3(관악산 남측 통근권·2026-07-04 확장). LAWD 코드는 법정동코드 앞 5자리.
const DISTRICTS: Array<{ lawdCd: string; name: string }> = [
  { lawdCd: '11620', name: '관악구' },
  { lawdCd: '11590', name: '동작구' },
  { lawdCd: '11560', name: '영등포구' },
  { lawdCd: '11545', name: '금천구' },
  { lawdCd: '11530', name: '구로구' },
  { lawdCd: '11500', name: '강서구' },
  { lawdCd: '11470', name: '양천구' },
  { lawdCd: '11350', name: '노원구' },
  { lawdCd: '11320', name: '도봉구' },
  { lawdCd: '11260', name: '중랑구' },
  { lawdCd: '11305', name: '강북구' },
  { lawdCd: '11290', name: '성북구' },
  { lawdCd: '11380', name: '은평구' },
  // 서울 잔여 12구 (1-B-ii 확대, 2026-07-08 — API 기반이라 부담 낮음, 즉시 25구 전체)
  { lawdCd: '11110', name: '종로구' },
  { lawdCd: '11140', name: '중구' },
  { lawdCd: '11170', name: '용산구' },
  { lawdCd: '11200', name: '성동구' },
  { lawdCd: '11215', name: '광진구' },
  { lawdCd: '11230', name: '동대문구' },
  { lawdCd: '11410', name: '서대문구' },
  { lawdCd: '11440', name: '마포구' },
  { lawdCd: '11650', name: '서초구' },
  { lawdCd: '11680', name: '강남구' },
  { lawdCd: '11710', name: '송파구' },
  { lawdCd: '11740', name: '강동구' },
  // 경기 남부(통근권 확장) — 만안구=비규제(갭투자 트랙), 동안구·의왕=토허(2년 실거주)
  { lawdCd: '41171', name: '안양시 만안구' },
  { lawdCd: '41173', name: '안양시 동안구' },
  { lawdCd: '41430', name: '의왕시' },
  // 경기 동북(1-B-iii) — 남양주=비규제, GTX-B·왕숙 생활권
  { lawdCd: '41360', name: '남양주시' },
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

  // ── 4. 자율 작업 보고(2026-08-05 지시) — 수집 건수를 매일 텔레그램으로 투명하게 보고 ──
  const kstTime = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(11, 16);
  await sendTelegram(
    [
      `🤖 자동수집 보고 — 부동산 (${kstTime} KST)`,
      `· 국토부 실거래: 매매 +${newTrades}건 · 전월세 +${newRents}건 (서울 25구+경기 4곳, 당월+전월)`,
      `· 청약홈 공고: 신규 ${freshCount}건${freshCount > 0 ? ' (상세 별도 발송됨)' : ''}`,
      `· 네이버 관심단지 매물 스냅샷: ${snaps}개 단지`,
    ].join('\n'),
  );

  console.log(`[collect] ${ts()} done`);
}

main()
  .catch((err) => {
    console.error('[collect] fatal:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
