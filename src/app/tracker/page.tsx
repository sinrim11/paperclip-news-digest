import Link from 'next/link';
import { Category } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  loadPolicyParams,
  loadReaderFinances,
  computeBudget,
  detectTriggers,
  ddayKST,
  monthsBefore,
  formatKRW,
  type ScannableItem,
} from '@/lib/tracker';

export const dynamic = 'force-dynamic';

export const metadata = { title: '매수 트래커 | 뉴스 다이제스트' };

function DdayBadge({ days }: { days: number }) {
  const urgent = days <= 30;
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-sm font-bold ${
        urgent ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
      }`}
    >
      {days >= 0 ? `D-${days}` : `D+${-days}`}
    </span>
  );
}

export default async function TrackerPage() {
  const params = loadPolicyParams();
  const fin = loadReaderFinances();

  // 최근 14일 뉴스에서 트리거·관심지역 스캔
  const since = new Date(Date.now() - 14 * 86_400_000);
  const rows = await prisma.newsItem
    .findMany({
      where: {
        category: { in: [Category.REALESTATE, Category.POLICY, Category.STOCKS] },
        createdAt: { gte: since },
      },
      select: {
        title: true,
        fact: true,
        category: true,
        sourceUrl: true,
        digest: { select: { date: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    })
    .catch(() => []);

  const scannable: ScannableItem[] = rows.map((r) => ({
    title: r.title,
    fact: r.fact,
    category: r.category,
    date: r.digest.date.toISOString().slice(0, 10),
    sourceUrl: r.sourceUrl,
  }));
  const hits = detectTriggers(scannable);
  const localRe = /신대방|보라매|노량진|신길|동작|관악|영등포|서부선|신림/;
  const localNews = scannable
    .filter((i) => i.category === 'REALESTATE' && localRe.test(i.title + ' ' + i.fact))
    .slice(0, 10);

  // ── 실거래·청약·매물 (일 1회 자동 수집: com.news-digest.collect 06:00) ──
  const WATCH_DONGS = ['신대방동', '상도동', '상도1동', '봉천동', '신림동', '신길동', '대방동', '노량진동', '흑석동', '대림동', '문래동6가'];
  const tradesRaw = await prisma.aptTrade
    .findMany({
      where: { dong: { in: WATCH_DONGS } },
      orderBy: { dealDate: 'desc' },
      take: 25,
    })
    .catch(() => []);
  const trades = tradesRaw.filter((t) => t.cdealType !== 'O').slice(0, 12);

  const noticesRaw = await prisma.subscriptionNotice
    .findMany({ where: { region: '서울' }, orderBy: { rceptBegin: 'desc' }, take: 20 })
    .catch(() => []);
  const todayStr = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const upcoming = noticesRaw
    .filter((n) => (n.rceptBegin ?? '') >= todayStr)
    .sort((a, b) => (a.rceptBegin ?? '').localeCompare(b.rceptBegin ?? ''));
  const recentNotices = noticesRaw.filter((n) => (n.rceptBegin ?? '') < todayStr).slice(0, 5);

  const snapshotsRaw = await prisma.listingSnapshot.findMany({ orderBy: { date: 'desc' }, take: 20 }).catch(() => []);
  const seenComplex = new Set<string>();
  const snapshots = snapshotsRaw.filter((s) => {
    if (seenComplex.has(s.complexNo)) return false;
    seenComplex.add(s.complexNo);
    return true;
  });

  const scenarios = params && fin ? computeBudget(params, fin) : [];
  const jeonseExpiry = fin?.jeonseExpiry;
  const noticeDeadline = jeonseExpiry ? monthsBefore(jeonseExpiry, 2) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">🏠 매수 트래커</h1>
          <p className="mt-1 text-sm text-gray-500">
            매일 아침 파이프라인이 갱신 · 정책 기준일 {params?.asOf ?? '—'} ·{' '}
            <Link href="/guide/policy" className="text-blue-600 hover:underline">
              정책 가이드 보기 →
            </Link>
          </p>
        </div>
      </header>

      {/* ── D-day ─────────────────────────────────────────────── */}
      {jeonseExpiry && noticeDeadline && (
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-500">전세 계약 만기</h2>
              <DdayBadge days={ddayKST(jeonseExpiry)} />
            </div>
            <p className="mt-2 text-xl font-bold text-gray-900">{jeonseExpiry}</p>
            <p className="mt-1 text-xs text-gray-500">
              보증보험 {fin?.jeonseInsurance ? '가입 ✓' : '미가입 ⚠️'} · 보증금{' '}
              {fin?.jeonseDeposit ? formatKRW(fin.jeonseDeposit) : '—'}
            </p>
          </div>
          <div className="rounded-lg border bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-500">갱신/이사 결정 데드라인</h2>
              <DdayBadge days={ddayKST(noticeDeadline)} />
            </div>
            <p className="mt-2 text-xl font-bold text-gray-900">{noticeDeadline}</p>
            <p className="mt-1 text-xs text-gray-500">
              계약갱신청구권 통지는 만기 6~2개월 전까지. 이 날짜 전에 갱신 여부를 임대인에게 통지해야 함
            </p>
          </div>
        </section>
      )}

      {/* ── 예산 시뮬레이션 ────────────────────────────────────── */}
      <section className="rounded-lg border bg-white p-5">
        <h2 className="font-semibold text-gray-900">💰 예산 시뮬레이션</h2>
        {!fin || !params ? (
          <p className="mt-3 text-sm text-gray-500">
            config/reader-profile.json의 finances 설정 시 자동 계산됩니다.
          </p>
        ) : (
          <>
            <p className="mt-1 text-xs text-gray-500">
              가용자본 {formatKRW(fin.usableCapital)} · 연소득 {formatKRW(fin.annualIncome)} · DSR{' '}
              {(params.dsr.ratio * 100).toFixed(0)}% · 30년 원리금균등 · 명목금리{' '}
              {params.dsr.assumedBaseRatePct}% 가정
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-500">
                    <th className="py-2 pr-3">시나리오</th>
                    <th className="py-2 pr-3">LTV</th>
                    <th className="py-2 pr-3">스트레스</th>
                    <th className="py-2 pr-3">대출액</th>
                    <th className="py-2 pr-3 font-bold">최대 매수가</th>
                    <th className="py-2">구속 조건</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarios.map((s) => (
                    <tr key={s.label} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium text-gray-900">{s.label}</td>
                      <td className="py-2 pr-3">{(s.ltv * 100).toFixed(0)}%</td>
                      <td className="py-2 pr-3">+{s.stressAddPct}%p</td>
                      <td className="py-2 pr-3">{formatKRW(s.loan)}</td>
                      <td className="py-2 pr-3 text-base font-bold text-blue-700">{formatKRW(s.maxPrice)}</td>
                      <td className="py-2 text-xs text-gray-500">{s.binding}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {fin.capitalBreakdown && (
              <p className="mt-3 text-xs text-gray-500">
                자본 구성:{' '}
                {Object.entries(fin.capitalBreakdown)
                  .map(([k, v]) => `${k} ${formatKRW(v)}`)
                  .join(' · ')}
              </p>
            )}
          </>
        )}
      </section>

      {/* ── 트리거 워치 ────────────────────────────────────────── */}
      <section className="rounded-lg border bg-white p-5">
        <h2 className="font-semibold text-gray-900">🚨 매수 트리거 워치 <span className="text-xs font-normal text-gray-400">(최근 14일 수집 뉴스)</span></h2>
        <p className="mt-1 text-xs text-gray-500">
          규제 완화·해제 / LTV·DSR / 기준금리 / 서부선 / 관심지역 / 청약 제도 / 공급 — 감지 시 아침 Telegram 브리핑에도 자동 포함
        </p>
        {hits.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">감지된 변경점 없음 — 현행 규제 유지 중</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {hits.slice(0, 12).map((h, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 shrink-0 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                  {h.label}
                </span>
                <span className="text-gray-800">
                  {h.sourceUrl ? (
                    <a href={h.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline">
                      {h.title}
                    </a>
                  ) : (
                    h.title
                  )}
                  <span className="ml-1 text-xs text-gray-400">{h.date}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 청약 공고 (자동 수집) ──────────────────────────────── */}
      <section className="rounded-lg border bg-white p-5">
        <h2 className="font-semibold text-gray-900">🏗️ 청약 공고 <span className="text-xs font-normal text-gray-400">(청약홈 API · 서울 · 매일 06:00 수집, 신규 공고는 Telegram 즉시 알림)</span></h2>
        {upcoming.length === 0 && recentNotices.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">수집된 공고 없음</p>
        ) : (
          <div className="mt-3 space-y-2">
            {upcoming.map((n) => (
              <div key={n.id} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 shrink-0 rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
                  접수 D-{ddayKST(n.rceptBegin!)}
                </span>
                <span className="text-gray-800">
                  <b>[{n.noticeType}] {n.houseName}</b>
                  <span className="ml-1 text-xs text-gray-500">
                    {n.rceptBegin}{n.rceptEnd ? `~${n.rceptEnd}` : ''} · {n.address ?? ''}
                  </span>
                </span>
              </div>
            ))}
            {recentNotices.map((n) => (
              <div key={n.id} className="flex items-start gap-2 text-sm opacity-70">
                <span className="mt-0.5 shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">접수됨</span>
                <span className="text-gray-700">
                  [{n.noticeType}] {n.houseName}
                  <span className="ml-1 text-xs text-gray-400">{n.rceptBegin} · {n.address ?? ''}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 관심동네 실거래 (자동 수집) ─────────────────────────── */}
      <section className="rounded-lg border bg-white p-5">
        <h2 className="font-semibold text-gray-900">📈 관심동네 최근 실거래 <span className="text-xs font-normal text-gray-400">(국토부 API · 동작/관악/영등포 · 매일 06:00 수집)</span></h2>
        {trades.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">수집된 실거래 없음</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-gray-500">
                  <th className="py-1.5 pr-3">계약일</th>
                  <th className="py-1.5 pr-3">동</th>
                  <th className="py-1.5 pr-3">단지</th>
                  <th className="py-1.5 pr-3">전용</th>
                  <th className="py-1.5 pr-3">층</th>
                  <th className="py-1.5">금액</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 text-xs text-gray-500">{t.dealDate.toISOString().slice(0, 10)}</td>
                    <td className="py-1.5 pr-3">{t.dong}</td>
                    <td className="py-1.5 pr-3 font-medium text-gray-900">{t.aptName}</td>
                    <td className="py-1.5 pr-3">{t.excluUseAr.toFixed(1)}㎡</td>
                    <td className="py-1.5 pr-3">{t.floor ?? '-'}</td>
                    <td className="py-1.5 font-bold text-blue-700">{formatKRW(t.dealAmount * 10_000)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── 매물 스냅샷 ────────────────────────────────────────── */}
      <section className="rounded-lg border bg-white p-5">
        <h2 className="font-semibold text-gray-900">🏷️ 관심단지 매물 호가 <span className="text-xs font-normal text-gray-400">(네이버 · 하루 1회 스냅샷)</span></h2>
        {snapshots.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            수집 대기 — 네이버 비공식 API가 현재 차단 상태(2026-07-03 확인). 헤드리스 브라우저 방식 전환 예정.
            의사결정은 위 실거래(진실) 기준, 호가는 보조 지표.
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5 text-sm">
            {snapshots.map((s) => (
              <li key={s.id} className="text-gray-800">
                <b>{s.complexName}</b> — 매물 {s.articleCount ?? '?'}건
                {s.minPrice ? ` · 최저 ${formatKRW(s.minPrice * 10_000)}` : ''}
                <span className="ml-1 text-xs text-gray-400">{s.date.toISOString().slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 관심지역 뉴스 ──────────────────────────────────────── */}
      <section className="rounded-lg border bg-white p-5">
        <h2 className="font-semibold text-gray-900">📍 관심지역 뉴스 <span className="text-xs font-normal text-gray-400">(신대방·보라매·노량진·신길·동작·관악·영등포)</span></h2>
        {localNews.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">최근 14일 내 관심지역 기사 없음</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {localNews.map((n, i) => (
              <li key={i} className="text-sm text-gray-800">
                {n.sourceUrl ? (
                  <a href={n.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline">
                    {n.title}
                  </a>
                ) : (
                  n.title
                )}
                <span className="ml-1 text-xs text-gray-400">{n.date}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-gray-400">
        본 페이지는 개인 설정(config/reader-profile.json) 기반 자동 계산이며 금융 자문이 아닙니다. 대출 한도는
        은행 심사 기준으로 확정하세요.
      </p>
    </div>
  );
}
