import ProfileBadge from '@/components/ProfileBadge';
import Link from 'next/link';
import { Category } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  loadPolicyParams,
  loadReaderFinances,
  computeBudget,
  computeAccumulation,
  computeFutureBudget,
  existingDebtMonthly,
  loadFinancePlan,
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
      className={`font-mono text-2xl font-bold tabular-nums tracking-tight ${
        urgent ? 'text-red-600' : 'text-blue-700'
      }`}
    >
      {days >= 0 ? `D-${days}` : `D+${-days}`}
    </span>
  );
}

function StatusBadge({ status }: { status: '가능' | '조건부' | '배제' }) {
  const cls =
    status === '가능'
      ? 'bg-green-100 text-green-700'
      : status === '조건부'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-gray-200 text-gray-500';
  return <span className={`mt-0.5 shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${cls}`}>{status}</span>;
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

  // ── 2년 매수 준비 재무 플랜 ──
  const accum = fin ? computeAccumulation(fin) : null;
  const futureScenarios = params && fin && accum ? computeFutureBudget(params, fin, accum.projectedCapital) : [];
  const futureFirstTime = futureScenarios[1]; // 생애최초 우대 시나리오
  const plan = loadFinancePlan();
  const cf = fin?.cashflow;
  // 마이너스통장 등 기존 신용부채의 DSR 잠식 — 매수 전 해지 시 회복분 계산
  const debtDragMonthly = params && fin ? existingDebtMonthly(fin, params) : 0;
  const creditLineLimit = fin?.existingDebt?.creditLineLimit ?? 0;
  const futureNoDebt = params && fin && accum ? computeFutureBudget(params, { ...fin, existingDebt: undefined }, accum.projectedCapital) : [];
  const budgetRecovery = (futureNoDebt[1]?.maxPrice ?? 0) - (futureFirstTime?.maxPrice ?? 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <ProfileBadge mode="ownerOnly" />
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">🏠 매수 트래커</h1>
          <p className="mt-1 text-xs text-gray-500">
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
            <h2 className="text-xs font-semibold text-gray-500">전세 계약 만기</h2>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <DdayBadge days={ddayKST(jeonseExpiry)} />
              <span className="text-sm font-medium text-gray-700">{jeonseExpiry}</span>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              보증보험 {fin?.jeonseInsurance ? '가입 ✓' : '미가입 ⚠️'} · 보증금{' '}
              {fin?.jeonseDeposit ? formatKRW(fin.jeonseDeposit) : '—'}
            </p>
          </div>
          <div className="rounded-lg border bg-white p-5">
            <h2 className="text-xs font-semibold text-gray-500">갱신/이사 결정 데드라인</h2>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <DdayBadge days={ddayKST(noticeDeadline)} />
              <span className="text-sm font-medium text-gray-700">{noticeDeadline}</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-gray-500">
              계약갱신청구권 통지는 만기 6~2개월 전까지 — 이 날짜 전에 갱신 여부를 임대인에게 통지해야 함
            </p>
          </div>
        </section>
      )}

      {/* ── 예산 시뮬레이션 ────────────────────────────────────── */}
      <section className="rounded-lg border bg-white p-5">
        <h2 className="text-lg font-bold text-gray-900">💰 예산 시뮬레이션</h2>
        {!fin || !params ? (
          <p className="mt-3 text-sm text-gray-500">
            config/reader-profile.json의 finances 설정 시 자동 계산됩니다.
          </p>
        ) : (
          <>
            {scenarios[1] && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-gray-500">지금 최대 매수가 · {scenarios[1].label}</p>
                <p className="mt-0.5 font-mono text-2xl font-bold tabular-nums tracking-tight text-blue-700">
                  {formatKRW(scenarios[1].maxPrice)}
                </p>
              </div>
            )}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-500">
                    <th className="py-2 pr-3 font-semibold">시나리오</th>
                    <th className="py-2 pr-3 text-right font-semibold">최대 매수가</th>
                    <th className="py-2 pr-3 text-right font-semibold">대출액</th>
                    <th className="py-2 pr-3 text-right font-semibold">LTV</th>
                    <th className="py-2 pr-3 text-right font-semibold">스트레스</th>
                    <th className="py-2 font-semibold">구속 조건</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarios.map((s) => (
                    <tr key={s.label} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium text-gray-900">{s.label}</td>
                      <td className="py-2 pr-3 text-right font-mono text-base font-bold tabular-nums text-blue-700">
                        {formatKRW(s.maxPrice)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-gray-700">{formatKRW(s.loan)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums text-gray-500">
                        {(s.ltv * 100).toFixed(0)}%
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums text-gray-500">
                        +{s.stressAddPct}%p
                      </td>
                      <td className="py-2 text-xs text-gray-500">{s.binding}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="mt-3 text-xs text-gray-500">
              <summary className="cursor-pointer font-medium hover:text-gray-700">계산 근거</summary>
              <dl className="mt-2 space-y-1">
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0">가용자본</dt>
                  <dd className="font-mono tabular-nums text-gray-700">{formatKRW(fin.usableCapital)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0">연소득</dt>
                  <dd className="font-mono tabular-nums text-gray-700">{formatKRW(fin.annualIncome)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0">DSR</dt>
                  <dd className="font-mono tabular-nums text-gray-700">{(params.dsr.ratio * 100).toFixed(0)}%</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0">상환 가정</dt>
                  <dd className="text-gray-700">30년 원리금균등 · 명목금리 {params.dsr.assumedBaseRatePct}%</dd>
                </div>
              </dl>
              {fin.capitalBreakdown && (
                <div className="mt-2">
                  <p>자본 구성</p>
                  <ul className="mt-1 space-y-0.5">
                    {Object.entries(fin.capitalBreakdown).map(([k, v]) => (
                      <li key={k} className="flex gap-2">
                        <span className="w-24 shrink-0">{k}</span>
                        <span className="font-mono tabular-nums text-gray-700">{formatKRW(v)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </details>
          </>
        )}
      </section>

      {/* ── 2년 매수 준비 재무 플랜 ─────────────────────────────── */}
      {fin && (
        <section className="space-y-4 rounded-lg border-2 border-blue-200 bg-blue-50/40 p-5">
          <div>
            <h2 className="text-lg font-bold text-gray-900">📋 2년 매수 준비 재무 플랜</h2>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">
              전세 갱신(2026-10) 기점 24개월 매수 기초 다지기 · {plan?.asOf ?? '2026-07-04'} 기준
              <span className="block">전략: 투자 우선 → 2년 실거주 후 임대전환</span>
            </p>
          </div>

          {/* 현금흐름 */}
          {cf && (
            <div className="rounded-lg border bg-white p-4">
              <h3 className="text-sm font-semibold text-gray-800">💵 월 현금흐름</h3>
              <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2">
                <div>
                  <div className="text-xs text-gray-500">매수펀드 적립</div>
                  <div className="font-mono text-xl font-bold tabular-nums text-blue-700">
                    {formatKRW(cf.monthlyHomeSaving ?? 0)}
                    <span className="ml-0.5 text-xs font-medium text-gray-500">/월</span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">실수령</div>
                  <div className="font-mono text-sm font-semibold tabular-nums text-gray-900">
                    {formatKRW(cf.monthlyIncomeNet ?? 0)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">소비지출</div>
                  <div className="font-mono text-sm tabular-nums text-gray-700">−{formatKRW(cf.monthlyExpense ?? 0)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">연금(노후)</div>
                  <div className="font-mono text-sm tabular-nums text-gray-700">−{formatKRW(cf.monthlyPension ?? 0)}</div>
                </div>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-gray-500">
                매수펀드 = ISA {formatKRW(cf.monthlyISA ?? 0)} + 주식 {formatKRW(cf.monthlyStock ?? 0)} · 저축률 약{' '}
                {Math.round((((cf.monthlyHomeSaving ?? 0) + (cf.monthlyPension ?? 0)) / (cf.monthlyIncomeNet || 1)) * 100)}%(연금 포함)
              </p>
            </div>
          )}

          {/* 적립 궤적 → 매수력 */}
          {accum && (
            <div className="rounded-lg border bg-white p-4">
              <h3 className="text-sm font-semibold text-gray-800">📈 {accum.months}개월 자기자본 적립 → 매수력</h3>
              {futureFirstTime && (
                <div className="mt-2">
                  <p className="text-xs font-semibold text-green-700">2년 후 매수 상한 · 생애최초 · 자기자본만</p>
                  <p className="mt-0.5 font-mono text-2xl font-bold tabular-nums tracking-tight text-green-700">
                    {formatKRW(futureFirstTime.maxPrice)}
                  </p>
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="rounded bg-gray-100 px-3 py-2">
                  <div className="text-xs text-gray-500">현재 자기자본</div>
                  <div className="font-mono text-sm font-bold tabular-nums text-gray-900">{formatKRW(accum.currentCapital)}</div>
                </div>
                <div className="text-xs text-gray-500">＋ {formatKRW(accum.monthlySave)}/월 × {accum.months} ＝</div>
                <div className="rounded bg-blue-100 px-3 py-2">
                  <div className="text-xs text-blue-600">2년 후 자기자본(투영)</div>
                  <div className="font-mono text-sm font-bold tabular-nums text-blue-800">{formatKRW(accum.projectedCapital)}</div>
                </div>
              </div>
              <details className="mt-2 text-xs text-gray-500">
                <summary className="cursor-pointer font-medium hover:text-gray-700">계산 근거</summary>
                <p className="mt-1 leading-relaxed">
                  투영 = 현 자기자본(전세보증금 회수 포함) + 매수펀드 적립. 투자수익 미반영(보수적). 미래 예산은 현 규제·금리 파라미터({params?.asOf ?? '—'}) · 스트레스 DSR 적용.
                  {accum.familySupport ? ` 가족지원 ${formatKRW(accum.familySupport)}(최후수단)은 미포함 — 자기자본만으로 상한 도달 가능.` : ''}
                </p>
              </details>
            </div>
          )}

          {/* 마이너스통장 DSR 잠식 경고 (최우선 조치) */}
          {creditLineLimit > 0 && budgetRecovery > 0 && (
            <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
              <h3 className="text-sm font-bold text-amber-900">
                ⚠️ 마이너스통장 {formatKRW(creditLineLimit)} — DSR 잠식 (최우선 조치)
              </h3>
              <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-1">
                <div>
                  <p className="text-xs text-gray-500">해지 시 상한</p>
                  <p className="font-mono text-xl font-bold tabular-nums text-green-700">
                    {formatKRW(futureNoDebt[1]?.maxPrice ?? 0)}
                  </p>
                </div>
                <p className="pb-0.5 font-mono text-sm font-semibold tabular-nums text-green-700">
                  +{formatKRW(budgetRecovery)} 회복
                </p>
                <p className="pb-0.5 text-xs text-gray-500">
                  유지 시{' '}
                  <span className="font-mono font-semibold tabular-nums text-gray-700">
                    {formatKRW(futureFirstTime?.maxPrice ?? 0)}
                  </span>
                </p>
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-gray-800">
                마통은 <b>미사용이어도 한도 전액이 DSR에 잡혀</b>(월 약 {formatKRW(Math.round(debtDragMonthly))} 부담) 주담대 한도를
                갉아먹습니다. 신용대출·할부·카드론도 신규 금지(전액 DSR 산입).
              </p>
              <details className="mt-1 text-xs text-gray-500">
                <summary className="cursor-pointer font-medium hover:text-gray-700">자세히</summary>
                <p className="mt-1 leading-relaxed">
                  {fin?.existingDebt?.creditLineUsed === 0
                    ? '미사용(잔액 0) → 해지 비용 0·순자산 영향 없음, 즉시 회복. 계약금은 주식·ISA·청약 등 자기 유동자산으로 커버.'
                    : '→ 매수 6~12개월 전 마통 해지 권장.'}
                </p>
              </details>
            </div>
          )}

          {/* 정부지원 */}
          <div className="rounded-lg border bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-800">🏛️ 정부지원·사업 활용</h3>
            {plan?.govSupport?.length ? (
              <ul className="mt-3 space-y-3">
                {plan.govSupport.map((g, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <StatusBadge status={g.status} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">
                        {g.name}
                        {g.source && (
                          <a href={g.source} target="_blank" rel="noreferrer" className="ml-1.5 text-xs font-normal text-blue-600 hover:underline">
                            근거↗
                          </a>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{g.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-gray-400">자문 콘텐츠(config/finance-plan.json) 준비 중</p>
            )}
          </div>

          {/* 절세 */}
          <div className="rounded-lg border bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-800">🧾 절세 방안</h3>
            {plan?.taxSaving?.length ? (
              <ul className="mt-3 space-y-3">
                {plan.taxSaving.map((t, i) => (
                  <li key={i}>
                    <p className="text-sm font-semibold text-gray-900">
                      {t.name}
                      {t.source && (
                        <a href={t.source} target="_blank" rel="noreferrer" className="ml-1.5 text-xs font-normal text-blue-600 hover:underline">
                          근거↗
                        </a>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{t.detail}</p>
                    {t.action && <p className="mt-0.5 text-xs font-medium text-blue-700">→ {t.action}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-gray-400">준비 중</p>
            )}
          </div>

          {/* 운용 방향 */}
          <div className="rounded-lg border bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-800">🧭 재무관리·운용 방향</h3>
            {plan?.management?.length ? (
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-gray-700">
                {plan.management.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-gray-400">준비 중</p>
            )}
          </div>

          {/* 실행 캘린더 */}
          {plan?.calendar?.length ? (
            <div className="rounded-lg border bg-white p-4">
              <h3 className="text-sm font-semibold text-gray-800">🗓️ 실행 캘린더</h3>
              <ul className="mt-2 space-y-2">
                {plan.calendar.map((c, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 rounded bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">{c.when}</span>
                    <span className="text-[13px] leading-relaxed text-gray-800">{c.action}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      )}

      {/* ── 트리거 워치 ────────────────────────────────────────── */}
      <section className="rounded-lg border bg-white p-5">
        <h2 className="text-lg font-bold text-gray-900">🚨 매수 트리거 워치</h2>
        <p className="mt-1 text-xs text-gray-500">최근 14일 수집 뉴스 스캔 · 감지 시 아침 Telegram 브리핑에 자동 포함</p>
        <details className="mt-1 text-xs text-gray-500">
          <summary className="cursor-pointer font-medium hover:text-gray-700">감지 조건</summary>
          <p className="mt-1 leading-relaxed">
            규제 완화·해제 / LTV·DSR / 기준금리 / 서부선 / 관심지역 / 청약 제도 / 공급
          </p>
        </details>
        {hits.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">감지된 변경점 없음 — 현행 규제 유지 중</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {hits.slice(0, 12).map((h, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                  {h.label}
                </span>
                <span className="text-sm leading-relaxed text-gray-800">
                  {h.sourceUrl ? (
                    <a href={h.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline">
                      {h.title}
                    </a>
                  ) : (
                    h.title
                  )}
                  <span className="ml-1.5 text-xs text-gray-500">{h.date}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 청약 공고 (자동 수집) ──────────────────────────────── */}
      <section className="rounded-lg border bg-white p-5">
        <h2 className="text-lg font-bold text-gray-900">🏗️ 청약 공고</h2>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">
          청약홈 API · 서울 · 매일 06:00 수집 — 신규 공고는 Telegram 즉시 알림
        </p>
        {upcoming.length === 0 && recentNotices.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">수집된 공고 없음</p>
        ) : (
          <div className="mt-3 space-y-2.5">
            {upcoming.map((n) => (
              <div key={n.id} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
                  접수 D-{ddayKST(n.rceptBegin!)}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">
                    [{n.noticeType}] {n.houseName}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {n.rceptBegin}{n.rceptEnd ? `~${n.rceptEnd}` : ''} · {n.address ?? ''}
                  </p>
                </div>
              </div>
            ))}
            {recentNotices.map((n) => (
              <div key={n.id} className="flex items-start gap-2 opacity-70">
                <span className="mt-0.5 shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">접수됨</span>
                <div className="min-w-0">
                  <p className="text-sm text-gray-700">
                    [{n.noticeType}] {n.houseName}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">{n.rceptBegin} · {n.address ?? ''}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 관심동네 실거래 (자동 수집) ─────────────────────────── */}
      <section className="rounded-lg border bg-white p-5">
        <h2 className="text-lg font-bold text-gray-900">📈 관심동네 최근 실거래</h2>
        <p className="mt-1 text-xs text-gray-500">국토부 API · 동작/관악/영등포 · 매일 06:00 수집</p>
        {trades.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">수집된 실거래 없음</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-gray-500">
                  <th className="py-2 pr-3 font-semibold">계약일</th>
                  <th className="py-2 pr-3 font-semibold">동</th>
                  <th className="py-2 pr-3 font-semibold">단지</th>
                  <th className="py-2 pr-3 text-right font-semibold">전용</th>
                  <th className="py-2 pr-3 text-right font-semibold">층</th>
                  <th className="py-2 text-right font-semibold">금액</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs tabular-nums text-gray-500">{t.dealDate.toISOString().slice(0, 10)}</td>
                    <td className="py-2 pr-3 text-gray-700">{t.dong}</td>
                    <td className="py-2 pr-3 font-medium text-gray-900">{t.aptName}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-gray-700">{t.excluUseAr.toFixed(1)}㎡</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-gray-700">{t.floor ?? '-'}</td>
                    <td className="py-2 text-right font-mono font-bold tabular-nums text-blue-700">{formatKRW(t.dealAmount * 10_000)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── 매물 스냅샷 ────────────────────────────────────────── */}
      <section className="rounded-lg border bg-white p-5">
        <h2 className="text-lg font-bold text-gray-900">🏷️ 관심단지 매물 호가</h2>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">
          네이버 · 하루 1회 스냅샷 · 호가는 보조 지표 — 의사결정은 위 실거래(진실) 기준
        </p>
        {snapshots.length === 0 ? (
          <p className="mt-3 text-sm leading-relaxed text-gray-500">
            수집 대기 — 네이버 비공식 API가 현재 차단 상태(2026-07-03 확인) · 헤드리스 브라우저 방식 전환 예정
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {snapshots.map((s) => (
              <li key={s.id} className="text-gray-800">
                <span className="font-semibold text-gray-900">{s.complexName}</span> — 매물{' '}
                <span className="font-mono tabular-nums">{s.articleCount ?? '?'}</span>건
                {s.minPrice ? (
                  <>
                    {' '}· 최저 <span className="font-mono font-semibold tabular-nums text-blue-700">{formatKRW(s.minPrice * 10_000)}</span>
                  </>
                ) : null}
                <span className="ml-1.5 text-xs text-gray-500">{s.date.toISOString().slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 관심지역 뉴스 ──────────────────────────────────────── */}
      <section className="rounded-lg border bg-white p-5">
        <h2 className="text-lg font-bold text-gray-900">📍 관심지역 뉴스</h2>
        <p className="mt-1 text-xs text-gray-500">신대방 · 보라매 · 노량진 · 신길 · 동작 · 관악 · 영등포 — 최근 14일</p>
        {localNews.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">최근 14일 내 관심지역 기사 없음</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {localNews.map((n, i) => (
              <li key={i} className="text-sm leading-relaxed text-gray-800">
                {n.sourceUrl ? (
                  <a href={n.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline">
                    {n.title}
                  </a>
                ) : (
                  n.title
                )}
                <span className="ml-1.5 text-xs text-gray-500">{n.date}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs leading-relaxed text-gray-400">
        본 페이지는 개인 설정(config/reader-profile.json) 기반 자동 계산이며 금융 자문이 아닙니다. 대출 한도는
        은행 심사 기준으로 확정하세요.
      </p>
    </div>
  );
}
