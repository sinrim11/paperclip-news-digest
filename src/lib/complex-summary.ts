/**
 * complex-summary.ts — 단지 비교/리스크용 컴팩트 데이터 어셈블러.
 *   /compare(나란히 비교)와 /complex(리스크 섹션)가 공유. 매칭 규칙은 gen-listings와 동일(lawd+dong+정규화 이름).
 *   ⚠️ 점수는 참고자료 원칙: 모든 수치에 원천(실거래 N건 등)을 함께 담는다.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from './db';
import { LAWD_GU } from './tiers';
import { regionApprPct } from './investment-model';
import { analyzeWithVersus } from './invest-compact';
import { computeCommute, computeAmenity, computeAmenityKakao, lineLabel, type KakaoCtx } from './commute';
import { tradeTrendFlag, DEFAULT_DOWNSIDE } from './downside';
import { radarScore, type RadarResult } from './radar-score';
import type { ResolvedContext } from './profiles';

const normName = (s: string) => s.replace(/\s|아파트|아파트$/g, '');
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const loadJson = <T,>(rel: string): T | null => { try { return JSON.parse(readFileSync(join(process.cwd(), rel), 'utf-8')) as T; } catch { return null; } };

export interface ComplexSummary {
  complexNo: string; name: string; gu: string; dong: string;
  household: number; elapsedYear: number | null; far: number | null;
  minPrice: number | null; maxPrice: number | null; dealArticles: number; sweptAt: string;
  tradeMedian: number | null; tradeCount: number; latestTradeDate: string | null;
  jeonseMedian: number | null; jeonseRatioPct: number | null; jeonseCount: number;
  gapPct: number | null;
  radar: RadarResult;
  rebuild: { label: string; good: boolean } | null;
  commute: { station: string; lines: string; walkMin: number; transfers: number; totalMin: number; driveMin: number; driveReal: boolean; busDependent: boolean } | null;
  amenity: { score: number; counts: Record<string, number> | null } | null;
  invest: { totalScore: number; roeAnnualPct: number; equityIn: number; feasibleToday: boolean; feasible2yr: boolean; breakevenApprPct: number } | null;
  vs: { winner: string; gStar: number; a10: number; b10: number } | null;
  risks: string[]; // ⚠️ 확인해야 할 리스크(자동 추출 — 반대 근거)
  /** 💸 이 집을 사면 — 월 부담 명세(만원, 활성 프로필 기준) */
  monthly: {
    payment: number; // 원리금
    interest: number; // 첫달 이자분
    principal: number; // 원금분(자산화)
    propertyTax: number; // 재산세 월환산
    existingLoan: number; // 기존대출 상환(프로필)
    total: number; // 총 월 부담(관리비 제외 — 현장 확인)
    jeonseInterestSaved: number; // 매수 시 소멸하는 현 전세대출이자
    netIncrease: number; // 현 주거비 대비 순증(total − saved)
    incomeNet: number; // 월 실수령
    burdenPct: number; // total/실수령
  } | null;
  /** 🎯 매수 케이스 — 시스템의 설득 논리 + 자기검증 판정 */
  buyCase: {
    verdict: '추천 가능' | '조건부 추천' | '근거 부족 — 추천 보류';
    strength: number; // 설득력 점수(참고)
    argument: string[]; // 설득 논증(단계별)
    selfCheck: string[]; // 자기검증: 이 논증의 약점
  };
}

/** 데이터 기반 약점·리스크 자동 추출 — "왜 사면 안 될 수도 있는가" */
export function buildRisks(s: Omit<ComplexSummary, 'risks' | 'buyCase' | 'monthly'> & { monthly?: ComplexSummary['monthly'] }): string[] {
  const r: string[] = [];
  if (s.gapPct != null && s.gapPct > 10) r.push(`최저 호가가 실거래보다 ${s.gapPct.toFixed(1)}% 높음 — 거품 가능, 협상 필수`);
  if (s.tradeCount === 0) r.push('180일 내 실거래 없음 — 시세 근거 취약, 호가만 존재');
  else if (s.tradeCount < 3) r.push(`180일 실거래 ${s.tradeCount}건뿐 — 시세 표본 부족·환금성 의문`);
  if (s.jeonseRatioPct != null && s.jeonseRatioPct < 55) r.push(`전세가율 ${s.jeonseRatioPct}% — 실거주 수요 약함, 하락 방어력 낮음`);
  if (s.jeonseCount === 0) r.push('180일 내 전세 계약 없음 — 임대 전환 수요 미확인');
  if (s.household < 300) r.push(`${s.household}세대 소단지 — 환금성·시세 안정성 열위`);
  if (s.elapsedYear != null && s.elapsedYear >= 30 && s.far != null && s.far > 230) r.push(`${s.elapsedYear}년차·용적률 ${Math.round(s.far)}% — 재건축 사업성 낮은데 노후화 진행`);
  if (s.elapsedYear != null && s.elapsedYear >= 25 && s.elapsedYear < 30) r.push(`${s.elapsedYear}년차 — 재건축은 멀고 감가는 진행되는 구간`);
  if (s.commute?.busDependent) r.push('최근접 역 1.2km 초과 — 버스 의존 입지');
  if (s.commute && s.commute.totalMin > 55) r.push(`통근 ~${s.commute.totalMin}분 — 출근 부담 큼(실거주 시)`);
  if (s.invest && !s.invest.feasibleToday && !s.invest.feasible2yr) r.push('현 프로필 기준 2년 적립해도 자기자본 부족');
  if (s.invest && s.invest.roeAnnualPct < 0) r.push(`기본 상승 가정에서 연 ROE ${s.invest.roeAnnualPct}% — 역캐리(상승 확신 필요, 손익분기 ${s.invest.breakevenApprPct}%/년)`);
  return r;
}

const eokTxt = (m: number) => (m / 10000).toFixed(2).replace(/\.?0+$/, '') + '억';
const manTxt = (m: number) => Math.round(m).toLocaleString() + '만';

/** 설득 게이트: 시스템 스스로 설득되지 않는 매물은 '추천 보류' — 근거 강도를 명시적으로 채점 */
export function buildBuyCase(s: Omit<ComplexSummary, 'buyCase' | 'monthly'>): ComplexSummary['buyCase'] {
  const argument: string[] = [];
  const selfCheck: string[] = [];

  // 치명 결격: 시세 근거 자체가 없으면 논증 불가 → 무조건 보류
  if (s.tradeCount === 0) {
    return { verdict: '근거 부족 — 추천 보류', strength: 0, argument: ['최저 호가 ' + (s.minPrice ? eokTxt(s.minPrice) : '-') + '이지만 180일 내 실거래가 없어 이 가격이 싼지 비싼지 판정할 시세 근거가 없음.'], selfCheck: ['실거래 0건 — 호가만으로는 가치 판단 불가. 이 상태로는 시스템이 스스로를 설득할 수 없음.'] };
  }
  if (s.gapPct == null || s.tradeCount < 3) {
    return { verdict: '근거 부족 — 추천 보류', strength: 1, argument: [`실거래 표본 ${s.tradeCount}건 — 개별 거래의 층·향 편차가 시세를 왜곡할 수 있는 수준.`], selfCheck: ['표본 3건 미만 — 중간값의 신뢰구간이 넓어 가격 논증이 성립하지 않음.'] };
  }

  let pts = 0;
  // ① 가격 논증
  if (s.gapPct <= -5) { pts += 3; argument.push(`가격: 최저 호가 ${eokTxt(s.minPrice!)}는 실거래 중간 ${eokTxt(s.tradeMedian!)}(${s.tradeCount}건)보다 ${Math.abs(s.gapPct).toFixed(1)}% 낮음 — 실거래가 검증하는 할인 구간.`); }
  else if (s.gapPct <= 2) { pts += 2; argument.push(`가격: 호가가 실거래(${s.tradeCount}건)와 정합(${s.gapPct >= 0 ? '+' : ''}${s.gapPct}%) — 거품 없이 시세대로 살 수 있음.`); }
  else if (s.gapPct <= 8) { pts += 1; argument.push(`가격: 호가가 실거래보다 +${s.gapPct}% — 협상으로 좁혀야 하는 프리미엄.`); selfCheck.push(`호가 프리미엄 +${s.gapPct}% — 협상 실패 시 가격 논증이 약해짐.`); }
  else { argument.push(`가격: 호가가 실거래 대비 +${s.gapPct}% 높음.`); selfCheck.push(`갭 +${s.gapPct}% — 현재 호가로는 가격 근거가 성립하지 않음(급매 출현 대기 권장).`); }

  // ② 수요 논증(전세·거래)
  if (s.jeonseRatioPct != null && s.jeonseRatioPct >= 70) { pts += 2; argument.push(`수요: 전세가율 ${s.jeonseRatioPct}%(계약 ${s.jeonseCount}건) — 실거주 수요가 가격을 받치고, 2년 후 임대 전환도 용이.`); }
  else if (s.jeonseRatioPct != null && s.jeonseRatioPct >= 60) { pts += 1; argument.push(`수요: 전세가율 ${s.jeonseRatioPct}% — 보통 수준의 실거주 수요.`); }
  else if (s.jeonseRatioPct == null) selfCheck.push('전세 표본 부족 — 임대 수요를 데이터로 확인 못함(중개사 확인 필요).');
  else selfCheck.push(`전세가율 ${s.jeonseRatioPct}% — 임대 수요 근거 약함.`);
  if (s.tradeCount >= 10) { pts += 2; argument.push(`유동성: 180일 ${s.tradeCount}건 거래 + 매물 ${s.dealArticles}건 — 사고팔기 쉬운 시장.`); }
  else if (s.tradeCount >= 5) pts += 1;

  // ③ 수익/상품 논증
  if (s.rebuild?.good) { pts += 2; argument.push(`상품: ${s.elapsedYear}년차·${s.rebuild.label} — 장기 재건축 옵션이 하방을 보강.`); }
  else if (s.elapsedYear != null && s.elapsedYear <= 10) { pts += 1; argument.push(`상품: 준신축 ${s.elapsedYear}년차 — 감가·임대선호 우위.`); }
  if (s.invest) {
    if (s.invest.roeAnnualPct >= 2) { pts += 1; argument.push(`수익: 지역 기본 상승 가정 연 ROE ${s.invest.roeAnnualPct}% · 10년 관점 ${s.vs?.winner === 'APT' ? 'ETF 대비 매수 우위(분기 ' + s.vs.gStar + '%)' : 'ETF와 접전'}.`); }
    else if (s.invest.roeAnnualPct < 0) selfCheck.push(`2년 ROE ${s.invest.roeAnnualPct}% 역캐리 — 단기 수익 논증은 성립하지 않음(장기·재건축 논거에 의존).`);
  }

  // ④ 리스크 상쇄 점검
  if (s.risks.length === 0) pts += 2;
  else if (s.risks.length <= 2) { pts += 1; selfCheck.push(`감지된 리스크 ${s.risks.length}건 — 임장에서 직접 상쇄 확인 필요.`); }
  else selfCheck.push(`리스크 ${s.risks.length}건 — 논증의 약점이 많음.`);

  const verdict = pts >= 7 ? '추천 가능' : pts >= 4 ? '조건부 추천' : '근거 부족 — 추천 보류';
  if (verdict === '근거 부족 — 추천 보류') selfCheck.push('종합: 시스템 스스로 설득되지 않는 수준 — 이 매물은 추천하지 않음.');
  return { verdict, strength: pts, argument, selfCheck };
}

export async function getComplexSummary(complexNo: string, ctx: ResolvedContext | null): Promise<ComplexSummary | null> {
  const c = await prisma.complexCandidate.findUnique({ where: { complexNo } });
  if (!c) return null;

  const guToLawd: Record<string, string> = {};
  for (const [lawd, gu] of Object.entries(LAWD_GU)) if (!guToLawd[gu]) guToLawd[gu] = lawd;
  const lawd = guToLawd[c.gu];
  const since = new Date(Date.now() - 180 * 86_400_000);
  const nm = normName(c.name);
  const [tradesAll, rentsAll] = await Promise.all([
    lawd ? prisma.aptTrade.findMany({ where: { lawdCd: lawd, dong: c.dong, dealDate: { gte: since } }, orderBy: { dealDate: 'desc' } }) : [],
    lawd ? prisma.aptRent.findMany({ where: { lawdCd: lawd, dong: c.dong, dealDate: { gte: since }, monthlyRent: 0 } }) : [],
  ]);
  const match = (n: string) => { const x = normName(n); return x === nm || x.includes(nm) || nm.includes(x); };
  const trades = tradesAll.filter((t) => match(t.aptName));
  const jeonse = rentsAll.filter((r) => match(r.aptName));

  const tradeMedian = trades.length ? median(trades.map((t) => t.dealAmount)) : null;
  const jeonseMedian = jeonse.length >= 2 ? median(jeonse.map((r) => r.deposit)) : null;
  const jeonseRatioPct = jeonseMedian && tradeMedian ? Math.round((jeonseMedian / tradeMedian) * 100) : null;
  const gapPct = tradeMedian && c.minDealPrice ? +(((c.minDealPrice - tradeMedian) / tradeMedian) * 100).toFixed(1) : null;

  const radar = radarScore({ household: c.household, elapsedYear: c.elapsedYear, far: c.far ?? null, dealArticles: c.dealArticles, gapPct, jeonseRatioPct, tradeCount: trades.length });

  const kakaoAll = loadJson<{ workKey: string; complexes: Record<string, KakaoCtx> }>('config/kakao-context.json');
  const workKey = ctx ? `${ctx.work.lat.toFixed(5)},${ctx.work.lng.toFixed(5)}` : '';
  const kc0 = kakaoAll?.complexes?.[complexNo] ?? null;
  const kc = kc0 && kakaoAll && kakaoAll.workKey !== workKey ? { ...kc0, driveMin: null, driveKm: null } : kc0;
  const cm = ctx && c.lat != null && c.lng != null ? computeCommute(c.lat, c.lng, ctx.work, kc) : null;
  const am = c.lat != null && c.lng != null
    ? (kc?.counts ? computeAmenityKakao(kc.counts, kc.subway?.distanceM ?? null, c.lat, c.lng, ctx?.lifestyle) : computeAmenity(c.lat, c.lng, c.household))
    : null;

  const regionHeat = (loadJson<any>('config/market-context.json')?.regionHeat ?? {}) as Record<string, number>;
  const price = c.minDealPrice ?? tradeMedian ?? null;
  let invest: ComplexSummary['invest'] = null;
  let vs: ComplexSummary['vs'] = null;
  let monthly: ComplexSummary['monthly'] = null;
  if (ctx && price) {
    const r = analyzeWithVersus({
      priceManwon: price, jeonseRatioPct: jeonseRatioPct ?? 65, tradeCount: trades.length,
      elapsedYear: c.elapsedYear, household: c.household, apprBasePct: regionApprPct(ctx.model, regionHeat[c.gu]),
      purposeLive: ctx.purposeLive,
      commute: cm ? { score: cm.score, formula: cm.formula, basis: cm.basis } : null,
      amenity: am ? { score: am.score, formula: am.formula, basis: am.basis } : null,
    }, ctx.fin, ctx.params, ctx.model);
    invest = { totalScore: r.a.totalScore, roeAnnualPct: +r.a.base.roeAnnualPct.toFixed(1), equityIn: r.a.equityIn, feasibleToday: r.a.feasibleToday, feasible2yr: r.a.feasible2yr, breakevenApprPct: +r.a.breakevenApprPct.toFixed(1) };
    vs = { winner: r.vs.winner, gStar: r.vs.gStar, a10: r.vs.a10, b10: r.vs.b10 };
    // 💸 월 부담 명세 — "이 집을 사면 매달 얼마 나가나"(만원)
    const interest = (r.a.loan * ctx.model.loanRatePct) / 100 / 12;
    const principal = r.a.monthlyPayment - interest;
    const propertyTax = r.a.propertyTax2yr / 24;
    const existingLoan = (ctx.fin.existingLoanMonthly ?? 0) / 10000;
    const total = r.a.monthlyPayment + propertyTax + existingLoan;
    const saved = (ctx.fin.jeonseLoanInterestMonthly ?? 0) / 10000;
    const incomeNet = (ctx.fin.cashflow?.monthlyIncomeNet ?? 0) / 10000;
    monthly = {
      payment: Math.round(r.a.monthlyPayment), interest: Math.round(interest), principal: Math.round(principal),
      propertyTax: Math.round(propertyTax * 10) / 10, existingLoan: Math.round(existingLoan),
      total: Math.round(total), jeonseInterestSaved: Math.round(saved), netIncrease: Math.round(total - saved),
      incomeNet: Math.round(incomeNet), burdenPct: incomeNet > 0 ? Math.round((total / incomeNet) * 100) : 0,
    };
  }

  const rebuild = c.elapsedYear != null && c.elapsedYear >= 30
    ? (c.far != null ? (c.far <= 180 ? { label: `사업성 양호(용적률 ${Math.round(c.far)}%)`, good: true } : c.far <= 230 ? { label: `관망(용적률 ${Math.round(c.far)}%)`, good: false } : { label: `기대 제한(용적률 ${Math.round(c.far)}%)`, good: false }) : { label: '연한 진입', good: false })
    : null;

  const base: Omit<ComplexSummary, 'risks' | 'buyCase'> = {
    complexNo: c.complexNo, name: c.name, gu: c.gu, dong: c.dong,
    household: c.household, elapsedYear: c.elapsedYear, far: c.far ?? null,
    minPrice: c.minDealPrice, maxPrice: c.maxDealPrice, dealArticles: c.dealArticles, sweptAt: c.sweptAt.toISOString().slice(0, 10),
    tradeMedian, tradeCount: trades.length, latestTradeDate: trades[0]?.dealDate.toISOString().slice(0, 10) ?? null,
    jeonseMedian, jeonseRatioPct, jeonseCount: jeonse.length,
    gapPct, radar, rebuild,
    commute: cm ? { station: cm.origin.name, lines: cm.origin.lines.map(lineLabel).join('·'), walkMin: cm.origin.walkMin, transfers: cm.transfers, totalMin: cm.totalMin, driveMin: cm.driveMin, driveReal: cm.driveReal, busDependent: cm.busDependent } : null,
    amenity: am ? { score: am.score, counts: kc?.counts ?? null } : null,
    invest, vs, monthly,
  };
  const risks = buildRisks(base);
  // 하방 경고 플래그(2-B) — 거래량 추세 급감(비교·리스크 화면에서도 항상 표시)
  const trendFlag = tradeTrendFlag(trades.map((t) => t.dealDate.getTime()), 180, Date.now(), DEFAULT_DOWNSIDE);
  if (trendFlag) risks.push(`🚩 ${trendFlag.label}`);
  const buyCase = buildBuyCase({ ...base, risks });
  return { ...base, risks, buyCase };
}
