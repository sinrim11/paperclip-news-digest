/**
 * InvestBreakdown — 매물 투자분석을 3단으로 분해해 보여주는 공용 컴포넌트.
 *   ① 판단 근거(입력 데이터) → ② 추론 과정(단계별 계산 흐름) → ③ 점수 산출(계산식→점수)
 * /listings·/matching 양쪽이 동일 구조로 소비. Server Component(상태 없음).
 *
 * 가독성 원칙(2026-07-05 전면 개편): 본문 최소 13px·행간 leading-relaxed·
 * 수식은 왼쪽 액센트 블록에 개행 허용(break-words)·단계는 제목/내용 줄 분리.
 * 근거 문자열은 RichText/BasisBlock으로 구조화(숫자 자동 강조·절 개행·계산 체인 화살표).
 */
import { RichText, BasisBlock } from './RichText';

export interface BreakdownScore { label: string; score: number; weight: number; formula: string; basis: string }
export interface InvestBreakdownData {
  // ① 판단 근거(입력)
  priceManwon: number;
  jeonseRatioPct: number;
  jeonseEstimated?: boolean;
  tradeCount: number;
  latestTradeDate?: string | null;
  tradeMedian?: number | null;
  elapsedYear?: number | null;
  household?: number | null;
  usableToday: number;
  projected2yr: number;
  loanRatePct?: number;
  // 자금조달
  loan: number; equityIn: number; ltvLoan: number; dsrLoanCap: number; bindingCap: string;
  feasibleToday: boolean; feasible2yr: boolean;
  // 보유(2년)
  monthlyPayment: number; interest2yr: number; acqTaxNet: number; propertyTax2yr: number; holdingCost: number; remainingLoan: number;
  // 수익
  base: { apprPct: number; futureValue: number; gain: number; netProfit: number; roeAnnualPct: number };
  conservativeRoe: number; optimisticRoe: number;
  // 전세전환
  jeonseDeposit: number; loanCleared: boolean; cashReleased: number; interestReductionPct: number; wolseNetMonthly: number;
  // 대안
  breakevenApprPct: number; altVerdict: string;
  // ③ 점수
  scores: BreakdownScore[];
  totalScore: number;
  // 통근(선택 — 좌표 보유 매물만)
  commuteText?: string | null; // 예: "신대방삼거리(7호선) 도보 7분 → 0환승 → 총 ~28분 · 자차 ~15분"
  workLabel?: string | null;
}

const eok = (m: number) => (m / 10000).toFixed(2).replace(/\.?0+$/, '') + '억';
const man = (m: number) => Math.round(m).toLocaleString() + '만';
const scoreColor = (s: number) => (s >= 70 ? 'text-emerald-600' : s >= 50 ? 'text-blue-600' : s >= 35 ? 'text-amber-600' : 'text-red-500');
const barColor = (s: number) => (s >= 70 ? 'bg-emerald-500' : s >= 50 ? 'bg-blue-500' : s >= 35 ? 'bg-amber-500' : 'bg-red-400');

function Bar({ score }: { score: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
      <div className={`h-full ${barColor(score)}`} style={{ width: `${Math.max(3, Math.min(100, score))}%` }} />
    </div>
  );
}

function SectionHead({ n, title, hint }: { n: string; title: string; hint: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <span className="flex h-6 w-6 shrink-0 translate-y-0.5 items-center justify-center rounded-full bg-gray-800 text-xs font-bold text-white">{n}</span>
      <span className="text-[15px] font-bold text-gray-900">{title}</span>
      <span className="text-xs text-gray-500">{hint}</span>
    </div>
  );
}

function Fact({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: 'good' | 'warn' | 'bad' }) {
  const c = tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : tone === 'bad' ? 'text-red-600' : 'text-gray-900';
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{k}</div>
      <div className={`mt-0.5 font-mono text-[15px] font-bold tabular-nums ${c}`}>{v}</div>
      {sub && <div className="mt-1 text-xs leading-snug text-gray-500">{sub}</div>}
    </div>
  );
}

/** 추론 단계: 번호·제목 줄과 계산 내용 줄을 분리 — 한 줄 덩어리 금지 */
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-lg bg-white p-3.5 shadow-sm ring-1 ring-gray-100">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-bold text-gray-600">{n}</span>
        <span className="text-[13px] font-bold text-gray-900">{title}</span>
      </div>
      <div className="mt-1.5 pl-7 text-[13px] leading-relaxed text-gray-700">{children}</div>
    </li>
  );
}

export default function InvestBreakdown({ d }: { d: InvestBreakdownData }) {
  const rate = d.loanRatePct ?? 4.5;
  const feasTone = d.feasibleToday ? 'good' : d.feasible2yr ? 'warn' : 'bad';

  return (
    <div className="space-y-6 text-[13px]">
      {/* 범례 */}
      <div className="rounded-lg bg-gray-800 px-4 py-2.5 text-xs leading-relaxed text-gray-200">
        <b className="text-white">① 판단 근거</b><span className="text-gray-400">(어떤 데이터로)</span>
        <span className="mx-1.5 text-gray-500">→</span>
        <b className="text-white">② 추론 과정</b><span className="text-gray-400">(어떻게 계산해)</span>
        <span className="mx-1.5 text-gray-500">→</span>
        <b className="text-white">③ 점수 산출</b><span className="text-gray-400">(무슨 공식으로 몇 점)</span>
      </div>

      {/* ── ① 판단 근거(입력 데이터) ── */}
      <section>
        <SectionHead n="①" title="판단 근거" hint="계산에 투입한 원천 데이터" />
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Fact k="매매가(호가)" v={eok(d.priceManwon)} sub={d.tradeMedian ? `실거래중간 ${eok(d.tradeMedian)}` : '실거래 표본 없음'} />
          <Fact k="전세가율" v={`${d.jeonseRatioPct}%`} sub={d.jeonseEstimated ? '추정(표본부족·기본 65)' : '실측 전세계약'} />
          <Fact k="실거래(180일)" v={`${d.tradeCount}건`} sub={d.latestTradeDate ? `최근 ${d.latestTradeDate}` : '최근 거래 없음'} />
          <Fact k="지역 상승률 가정" v={`${d.base.apprPct}%/년`} sub="지역 열기(regionHeat) 기반" />
          <Fact k="연식·세대수" v={`${d.elapsedYear != null ? `${d.elapsedYear}년차` : '미상'}`} sub={d.household ? `${d.household.toLocaleString()}세대` : '세대수 미상'} />
          <Fact k="보유 자기자본" v={eok(d.usableToday)} sub={`2년 적립후 ${eok(d.projected2yr)}`} />
          <Fact k="대출 가정" v={`LTV70%·${rate}%`} sub="DSR40%·30년·생애최초" />
          <Fact k="필요 자기자본" v={eok(d.equityIn)} sub={`대출 ${eok(d.loan)} (${d.bindingCap} 구속)`} tone={feasTone} />
        </div>
        {d.commuteText && (
          <div className="mt-2.5 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3.5 py-2.5 text-[13px] leading-relaxed text-indigo-900">
            🚇 <b>통근 — {d.workLabel ?? '출근지'}</b>
            <span className="mt-0.5 block text-indigo-800"><RichText text={d.commuteText ?? ''} /></span>
            <span className="mt-0.5 block text-xs text-indigo-400">지하철 소요는 좌표 기반 근사(배차·급행 미반영)</span>
          </div>
        )}
      </section>

      {/* ── ② 추론 과정(단계별 계산 흐름) ── */}
      <section>
        <SectionHead n="②" title="추론 과정" hint="입력 데이터 → 결론까지 단계별 계산" />
        <ol className="space-y-2.5">
          <Step n={1} title="자금조달">
            대출 = min(LTV {eok(d.ltvLoan)}, DSR한도 {eok(d.dsrLoanCap)}, 정책 6억) = <b>{eok(d.loan)}</b> <span className="text-gray-500">({d.bindingCap} 구속)</span>
            <span className="mt-1 block">
              필요 자기자본 <b className={feasTone === 'good' ? 'text-emerald-700' : feasTone === 'warn' ? 'text-amber-700' : 'text-red-600'}>{eok(d.equityIn)}</b>
              {' — '}{d.feasibleToday ? '오늘 보유자본으로 가능' : d.feasible2yr ? '2년 적립 후 가능' : '2년 적립해도 초과 ⚠️'}
            </span>
          </Step>
          <Step n={2} title="2년 보유비용">
            월 원리금 {man(d.monthlyPayment)} × 24개월 중 이자 <b>{man(d.interest2yr)}</b>
            <span className="mt-1 block">+ 취득세 {man(d.acqTaxNet)} + 재산세 {man(d.propertyTax2yr)} = 보유비용 <b>{man(d.holdingCost)}</b></span>
          </Step>
          <Step n={3} title="자산가치(2년 후)">
            {eok(d.priceManwon)} × (1 + {d.base.apprPct}%)² = 평가액 <b>{eok(d.base.futureValue)}</b>
            <span className="text-gray-500"> → </span>상승분 <b className={d.base.gain >= 0 ? 'text-emerald-700' : 'text-red-600'}>{man(d.base.gain)}</b>
          </Step>
          <Step n={4} title="순익·수익률(ROE)">
            상승 {man(d.base.gain)} − 보유비용 {man(d.holdingCost)} = 순익 <b className={d.base.netProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}>{man(d.base.netProfit)}</b>
            <span className="mt-1 block">÷ 자기자본 {eok(d.equityIn)} → 연 ROE <b>{d.base.roeAnnualPct}%</b> <span className="text-gray-500">(보수 {d.conservativeRoe}% · 낙관 {d.optimisticRoe}%)</span></span>
          </Step>
          <Step n={5} title="전세전환(2년 후)">
            평가액 {eok(d.base.futureValue)} × 전세가율 {d.jeonseRatioPct}% = 보증금 <b>{eok(d.jeonseDeposit)}</b>
            <span className="mt-1 block">
              {d.loanCleared
                ? <>잔존대출 {eok(d.remainingLoan)} <b className="text-emerald-700">전액상환 + 현금 {eok(d.cashReleased)} 회수</b> · 이자부담 <b>−{d.interestReductionPct}%</b></>
                : <>잔존대출 {eok(d.remainingLoan)} 일부상환 · 이자부담 <b>−{d.interestReductionPct}%</b></>}
            </span>
            <span className="mt-1 block">월세전환 시 순현금 <b className={d.wolseNetMonthly >= 0 ? 'text-emerald-700' : 'text-red-600'}>{d.wolseNetMonthly >= 0 ? '+' : ''}{man(d.wolseNetMonthly)}/월</b></span>
          </Step>
          <Step n={6} title="대안 비교·손익분기">
            <RichText text={d.altVerdict} />
            <span className="mt-1 block text-gray-500">손익분기 <b className="font-mono font-semibold text-gray-800">{d.breakevenApprPct}%/년</b> — 이하 상승 시 순손실</span>
          </Step>
        </ol>
      </section>

      {/* ── ③ 점수 산출(계산식 → 점수) ── */}
      <section>
        <SectionHead n="③" title="점수 산출" hint="영역별 계산식(공식)에 근거값 대입 → 점수" />
        <div className="space-y-2.5">
          {d.scores.map((s) => (
            <div key={s.label} className="rounded-lg border border-gray-200 bg-white p-3.5">
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-bold text-gray-900">{s.label}</span>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">가중치 {Math.round(s.weight * 100)}%</span>
                <span className="ml-auto flex items-center gap-2">
                  <span className="hidden w-20 sm:block"><Bar score={s.score} /></span>
                  <span className={`font-mono text-lg font-bold tabular-nums ${scoreColor(s.score)}`}>{s.score}</span>
                  <span className="text-xs text-gray-400">점</span>
                </span>
              </div>
              <div className="mt-2.5 rounded-md border-l-2 border-gray-300 bg-gray-50 px-3 py-2 font-mono text-xs leading-relaxed text-gray-600 [overflow-wrap:anywhere]">
                <span className="mr-1.5 font-sans font-semibold text-gray-400">계산식</span>{s.formula}
              </div>
              <div className="mt-2 flex gap-2 border-l-2 border-blue-200 pl-3 text-[13px] leading-relaxed text-gray-600 [overflow-wrap:anywhere]">
                <span className="shrink-0 pt-px text-xs font-semibold text-blue-400">근거</span>
                <div className="min-w-0 flex-1"><BasisBlock text={s.basis} /></div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2.5 rounded-lg bg-gray-800 px-4 py-3 text-white">
          <span className="text-[13px] text-gray-300">종합 = Σ(영역점수 × 가중치)</span>
          <span className="ml-auto font-mono text-2xl font-bold tabular-nums">{d.totalScore}</span>
          <span className="text-[13px] text-gray-400">/ 100</span>
        </div>
      </section>
    </div>
  );
}
