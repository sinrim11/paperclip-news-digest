/**
 * 일일 매물 추천 엔진 (결정적 규칙 기반).
 *
 * 파이프라인: 국토부 실거래(AptTrade) → 단지 집계 → 스코어링(tier·유동성·예산적합·연식·지역열기)
 *   → 시장 컨텍스트 가점 → 로테이션(14일 쿨다운, 변화 시 재등장) → 상위 N.
 * config/recommendation-rules.json(규칙) + config/market-context.json(일일 갱신 컨텍스트) 소비.
 * 결과는 텔레그램 발송 스키마(scripts/send-recommendations.ts)와 호환.
 */

import type { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';
import { tierOf, LAWD_GU } from './tiers';
import { monthlyPaymentPerWon } from './tracker';
import { regulationOf, nonRegulatedGus } from './region-regulation';
import { recoFactorsFor } from './momentum';

export interface DailyReco {
  rank: number;
  complexKey: string;
  name: string;
  gu: string;
  dong: string;
  buildYear?: number | null;
  areaText: string;
  medianManwon: number;
  priceRangeText: string;
  tradeCount: number;
  scenario: string; // 로그/분류용: "현행" | "빠듯"
  budgetLabel: string; // 텔레그램 표시용
  station: string;
  catalyst?: string;
  school?: string;
  amenities?: string;
  living?: string;
  reasons: string[];
  cautions: string[];
  complexNo?: string;
  score: number;
  isNew: boolean; // 처음 추천 or 변화 재등장
  signalNote?: string; // 재등장 사유
  // 갭투자 트랙(비규제 지역 전용)
  jeonseManwon?: number; // 전세 중간값
  gapManwon?: number; // 갭 = 매매 − 전세
  jeonseRatioPct?: number; // 전세가율
  gapCoverable?: boolean; // 갭 ≤ 자기자본
  nonRegulated?: boolean; // 비규제(토허 아님) → 갭투자 가능
  // 스트레치+ 트랙(comfortable 초과 ~ 스윕 상한)
  overComfortManwon?: number; // 오늘 자기자본권 대비 초과분(만원) — "+X 더 보태면"
  monthlyPayAddManwon?: number; // 초과분 전액 대출 가정 월 상환 증가분(만원/월)
  monthsToReach?: number | null; // 월 적립 기준 도달 개월(적립액 미설정 시 null)
  // 지역 규제 상태(config/region-regulation.json) — UI·추천 사유 명시(가드레일 1)
  regulationLabel?: string;
  regulationSources?: string[];
  // 근거 URL 모음(호재 등 인터넷 수집 데이터 — 가드레일 2)
  sources?: string[];
}

interface Rules {
  filters: { minExclusiveAreaM2: number; minTrades180d: number; lookbackDays: number; rentMinSamples?: number };
  weights: { tierMultiplier: number; liquidityCap: number; budgetFitComfortable: number; budgetFitStretch: number; freshnessMax: number; regionHeatMax: number; jeonseRatioMax?: number };
  freshnessByAge: Array<{ maxAge: number; score: number }>;
  jeonseRatioByPct?: Array<{ minPct: number; score: number }>;
  diversity?: { maxPerGu: number };
  dailyLimit: number;
  stretchPlus?: { enabled?: boolean; limit: number; ceilingManwon: number; maxPerGu?: number; cooldownDays?: number };
  gapTrack?: { enabled?: boolean; limit: number; minJeonseRatioPct: number; maxGapManwon: number; minTrades: number };
  rotation: { cooldownDays: number; reentryOnNewSignal: boolean };
  newSignal: { priceDropPct: number; recentTradeWindowDays: number };
  budgetFallback: { comfortableCeilingManwon: number; stretchCeilingManwon: number };
}

/** 단지 정성 팩트 KB(config/complex-facts.json) — 웹리서치가 채우는 역세권·학군·호재. aptName 부분일치+구로 매칭. */
interface ComplexFact {
  match: { gu: string; dong?: string; nameIncludes: string };
  station?: string;
  catalyst?: string;
  school?: string;
  amenities?: string;
  living?: string;
  reasons?: string[];
  cautions?: string[];
  complexNo?: string;
}

function matchFact(facts: ComplexFact[], gu: string, dong: string, name: string): ComplexFact | undefined {
  return facts.find((f) => f.match.gu === gu && (!f.match.dong || f.match.dong === dong) && name.includes(f.match.nameIncludes));
}

interface MarketContext {
  budgetReality?: { comfortableCeilingManwon?: number; stretchCeilingManwon?: number };
  regionHeat?: Record<string, number>;
}

function loadJson<T>(rel: string): T | null {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), rel), 'utf-8')) as T;
  } catch {
    return null;
  }
}

const median = (sorted: number[]) => sorted[Math.floor(sorted.length / 2)];
const eok = (manwon: number) => (manwon / 10000).toFixed(2).replace(/\.?0+$/, '') + '억';
const kstDateStr = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);

interface ComplexAgg {
  key: string;
  lawdCd: string;
  name: string;
  gu: string;
  dong: string;
  prices: number[];
  areas: number[];
  buildYear: number | null;
  latestTradeMs: number;
  recentTrades: Array<{ price: number; ms: number }>;
}

/** 전세 조인용 단지명 정규화 — 공백·'아파트' 접미 제거 (매매/전세 표기 흔들림 흡수). */
const normName = (s: string) => s.replace(/\s|아파트/g, '');

/** 전세가율(전세중간/매매중간) 가점 — 2년 실거주 후 임대전환 용이성·재투자 갭 신호. */
function jeonseRatioScore(rules: Rules, ratioPct: number): number {
  const bands = rules.jeonseRatioByPct ?? [];
  const cap = rules.weights.jeonseRatioMax ?? 0;
  for (const b of bands) if (ratioPct >= b.minPct) return Math.min(cap, b.score);
  return 0;
}

/** 유동성(최근 거래건수) 곡선 — 환금성은 핵심 객관 신호라 초유동성 단지를 크게 보상. cap로 상한. */
function liquidityScore(count: number, cap: number): number {
  let s: number;
  if (count >= 40) s = 16;
  else if (count >= 25) s = 13;
  else if (count >= 15) s = 11;
  else if (count >= 10) s = 9;
  else if (count >= 6) s = 6;
  else s = 4; // 3~5건
  return Math.min(cap, s);
}

function freshnessScore(rules: Rules, buildYear: number | null, nowYear: number): { score: number; label: string | null } {
  if (buildYear == null) return { score: 2, label: null };
  const age = nowYear - buildYear;
  for (const band of rules.freshnessByAge) {
    if (age <= band.maxAge) {
      const label =
        age <= 5 ? `신축(${age}년차) — 감가방어·환금성 우수(투자 프리미엄)`
        : age <= 15 ? `준신축(${age}년차) — 시세방어·임대선호`
        : age >= 30 ? `재건축 연한(${age}년차)`
        : null;
      return { score: band.score, label };
    }
  }
  return { score: 1, label: null };
}

export async function buildDailyRecommendations(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<{ asOf: string; items: DailyReco[]; stretchPlus: DailyReco[]; gapTrack: DailyReco[]; note: string; scanned: number }> {
  const rules = loadJson<Rules>('config/recommendation-rules.json');
  if (!rules) throw new Error('config/recommendation-rules.json 로드 실패');
  const ctx = loadJson<MarketContext>('config/market-context.json');

  const comfortable = ctx?.budgetReality?.comfortableCeilingManwon ?? rules.budgetFallback.comfortableCeilingManwon;
  const stretch = ctx?.budgetReality?.stretchCeilingManwon ?? rules.budgetFallback.stretchCeilingManwon;
  const regionHeat = ctx?.regionHeat ?? {};
  const nowYear = new Date(now.getTime() + 9 * 3_600_000).getUTCFullYear();
  const todayStr = kstDateStr(now);

  // 스트레치+ 트랙 상한 — 메인(stretch)보다 높으면 실거래 조회 상한을 함께 올린다
  const spCfg = rules.stretchPlus;
  const spCeiling = spCfg?.enabled ? Math.max(stretch, spCfg.ceilingManwon) : stretch;

  // 1) 실거래 집계
  const since = new Date(now.getTime() - rules.filters.lookbackDays * 86_400_000);
  const rows = await prisma.aptTrade.findMany({
    where: { dealDate: { gte: since }, excluUseAr: { gte: rules.filters.minExclusiveAreaM2 }, dealAmount: { lte: spCeiling } },
    select: { lawdCd: true, dong: true, aptName: true, dealAmount: true, excluUseAr: true, buildYear: true, dealDate: true },
  });

  // 메인 트랙 집계(≤stretch — 기존과 동일 산식 유지)와 스트레치+ 집계(≤spCeiling)를 분리 —
  // 조회 상한 상향이 메인 트랙 중간값·범위를 오염시키지 않도록(무중단 원칙).
  const buildAggs = (capManwon: number) => {
    const m = new Map<string, ComplexAgg>();
    for (const r of rows) {
      if (r.dealAmount > capManwon) continue;
      const gu = LAWD_GU[r.lawdCd] ?? r.lawdCd;
      const key = `${r.lawdCd}|${r.dong}|${r.aptName}`;
      const a = m.get(key) ?? { key, lawdCd: r.lawdCd, name: r.aptName, gu, dong: r.dong, prices: [], areas: [], buildYear: r.buildYear ?? null, latestTradeMs: 0, recentTrades: [] };
      a.prices.push(r.dealAmount);
      if (r.excluUseAr) a.areas.push(r.excluUseAr);
      a.buildYear = r.buildYear ?? a.buildYear;
      const ms = r.dealDate.getTime();
      if (ms > a.latestTradeMs) a.latestTradeMs = ms;
      a.recentTrades.push({ price: r.dealAmount, ms });
      m.set(key, a);
    }
    return m;
  };
  const aggs = buildAggs(stretch);
  const aggsWide = spCeiling > stretch ? buildAggs(spCeiling) : aggs;

  // 1b) 전세(월세0) 집계 — 전세가율 계산용. 매매와 동일 lookback·전용면적.
  const rentRows = await prisma.aptRent.findMany({
    where: { dealDate: { gte: since }, excluUseAr: { gte: rules.filters.minExclusiveAreaM2 }, monthlyRent: 0 },
    select: { lawdCd: true, dong: true, aptName: true, deposit: true },
  });
  const jeonseMap = new Map<string, number[]>();
  for (const r of rentRows) {
    const jk = `${r.lawdCd}|${r.dong}|${normName(r.aptName)}`;
    const arr = jeonseMap.get(jk) ?? [];
    arr.push(r.deposit);
    jeonseMap.set(jk, arr);
  }
  const rentMinSamples = rules.filters.rentMinSamples ?? 2;

  // 2) 로테이션 로그 (쿨다운 내 발송 이력) — 스트레치+ 발송은 별도 쿨다운(메인 로테이션 오염 금지)
  const spCooldownDays = spCfg?.cooldownDays ?? rules.rotation.cooldownDays;
  const maxCooldownDays = Math.max(rules.rotation.cooldownDays, spCooldownDays);
  const cooldownSince = kstDateStr(new Date(now.getTime() - rules.rotation.cooldownDays * 86_400_000));
  const recentSent = await prisma.sentRecommendation.findMany({
    where: { sentDate: { gte: kstDateStr(new Date(now.getTime() - maxCooldownDays * 86_400_000)) } },
    select: { complexKey: true, medianManwon: true, sentDate: true, scenario: true },
    orderBy: { sentDate: 'desc' },
  });
  const lastSentByKey = new Map<string, { medianManwon: number; sentDate: string }>();
  const lastSentStretch = new Map<string, { medianManwon: number; sentDate: string }>();
  const spCooldownSince = kstDateStr(new Date(now.getTime() - spCooldownDays * 86_400_000));
  for (const s of recentSent) {
    if (s.scenario === '스트레치+') {
      if (s.sentDate >= spCooldownSince && !lastSentStretch.has(s.complexKey)) lastSentStretch.set(s.complexKey, s);
    } else if (s.sentDate >= cooldownSince && !lastSentByKey.has(s.complexKey)) {
      lastSentByKey.set(s.complexKey, s);
    }
  }

  // 3) 스코어링 — 규제 미검증 지역은 게이트에서 제외(가드레일 1: 규제 확인 안 된 지역 추천 금지)
  const newSignalWindowMs = rules.newSignal.recentTradeWindowDays * 86_400_000;
  const scored: DailyReco[] = [];
  const skippedUnverifiedGu = new Set<string>();
  for (const a of aggs.values()) {
    if (a.prices.length < rules.filters.minTrades180d) continue;
    const reg = regulationOf(a.gu);
    if (reg.status === 'unverified') {
      skippedUnverifiedGu.add(a.gu);
      continue;
    }
    a.prices.sort((x, y) => x - y);
    const med = median(a.prices);
    if (med > stretch) continue;

    // 로테이션: 쿨다운 내면 스킵, 단 신저가(직전 발송 중간값 대비 하락) 발생 시 재등장
    const last = lastSentByKey.get(a.key);
    let isNew = true;
    let signalNote: string | undefined;
    if (last) {
      isNew = false;
      const recentLow = Math.min(...a.recentTrades.filter((t) => now.getTime() - t.ms <= newSignalWindowMs).map((t) => t.price), Infinity);
      const dropPct = ((last.medianManwon - recentLow) / last.medianManwon) * 100;
      if (rules.rotation.reentryOnNewSignal && recentLow !== Infinity && dropPct >= rules.newSignal.priceDropPct) {
        signalNote = `${last.sentDate} 이후 신저가 ${eok(recentLow)}(직전 중간 대비 ${dropPct.toFixed(1)}%↓)`;
      } else {
        continue; // 쿨다운 — 제외
      }
    }

    // 점수 축
    const tier = tierOf(a.dong);
    const tierPts = tier * rules.weights.tierMultiplier;
    const liq = liquidityScore(a.prices.length, rules.weights.liquidityCap);
    const inComfortable = med <= comfortable;
    const budgetPts = inComfortable ? rules.weights.budgetFitComfortable : rules.weights.budgetFitStretch;
    const fresh = freshnessScore(rules, a.buildYear, nowYear);
    const heat = Math.min(rules.weights.regionHeatMax, (regionHeat[a.gu] ?? 0));

    // 전세가율(임대전환 용이·재투자 갭) — 전세 표본 rentMinSamples건 이상일 때만 반영
    const jeonseArr = jeonseMap.get(`${a.lawdCd}|${a.dong}|${normName(a.name)}`);
    let jeonseRatioPct = 0;
    let jeonsePts = 0;
    if (jeonseArr && jeonseArr.length >= rentMinSamples) {
      jeonseArr.sort((x, y) => x - y);
      const jeonseMed = median(jeonseArr);
      jeonseRatioPct = Math.round((jeonseMed / med) * 100);
      jeonsePts = jeonseRatioScore(rules, jeonseRatioPct);
    }

    const score = Math.round((tierPts + liq + budgetPts + fresh.score + heat + jeonsePts) * 10) / 10;

    const minA = a.areas.length ? Math.round(Math.min(...a.areas)) : 0;
    const maxA = a.areas.length ? Math.round(Math.max(...a.areas)) : 0;

    // 근거 생성
    const overOwn = med - comfortable; // 오늘 자기자본권 초과분(만원)
    const reasons: string[] = [];
    reasons.push(inComfortable ? `실거래 중간 ${eok(med)} — 오늘 자기자본권(≤${eok(comfortable)}) 내 매수 가능` : `실거래 중간 ${eok(med)} — 2년 적립 시 자기자본권(오늘 대비 +${eok(overOwn)}, 월 적립으로 도달)`);
    reasons.push(`최근 ${a.prices.length}건 실거래(전용 ${minA}~${maxA}㎡) — 환금성 검증`);
    if (tier >= 15) reasons.push(`투자 우선지역(${a.dong}) · 교통·개발호재`);
    if (fresh.label) reasons.push(fresh.label);
    if (jeonseRatioPct >= 65) reasons.push(`전세가율 ${jeonseRatioPct}% — 2년 실거주 후 임대전환 유리(전세수요 강·재투자 갭 작음)`);
    if ((regionHeat[a.gu] ?? 0) >= 4) reasons.push(`${a.gu} 2026 상반기 상승 모멘텀 상위 권역`);
    if (signalNote) reasons.push(`🔻 ${signalNote}`);

    const cautions: string[] = [];
    if (!inComfortable) cautions.push(`오늘 자기자본권(${eok(comfortable)}) 초과 — 2년 적립 또는 마통 해지로 도달`);
    if (a.buildYear != null && nowYear - a.buildYear >= 33) cautions.push('노후 단지 — 재건축 기대가 호가 선반영/분담금 리스크 확인');
    if (jeonseRatioPct >= 100) cautions.push(`전세가율 ${jeonseRatioPct}% — 매매≈전세, 역전세/깡통 위험 점검(임대전환 시 보증금 상환 여력 확인)`);

    scored.push({
      rank: 0,
      complexKey: a.key,
      name: a.name,
      gu: a.gu,
      dong: a.dong,
      buildYear: a.buildYear,
      areaText: `전용 ${minA}~${maxA}㎡`,
      medianManwon: med,
      priceRangeText: `${eok(a.prices[0])}~${eok(a.prices[a.prices.length - 1])}`,
      tradeCount: a.prices.length,
      scenario: inComfortable ? '자기자본' : '2년적립',
      budgetLabel: inComfortable ? `자기자본권(≤${eok(comfortable)}) ✅` : `2년 적립 자기자본권(≤${eok(stretch)}) 🔓`,
      station: '역세권 정보 확인 필요',
      reasons,
      cautions,
      score,
      isNew,
      signalNote,
      regulationLabel: reg.label,
      regulationSources: reg.sourceUrls,
    });
  }

  // 4) 다양성 캡(구별 최대 N) 적용하며 상위 선별
  const facts = loadJson<ComplexFact[]>('config/complex-facts.json') ?? [];
  scored.sort((a, b) => b.score - a.score);
  const picked: DailyReco[] = [];
  const perGu: Record<string, number> = {};
  const cap = rules.diversity?.maxPerGu ?? 99;
  for (const r of scored) {
    if (picked.length >= rules.dailyLimit) break;
    if ((perGu[r.gu] ?? 0) >= cap) continue;
    perGu[r.gu] = (perGu[r.gu] ?? 0) + 1;
    picked.push(r);
  }

  // 지역 호재 조인(2-A) — 확정·진행만 사유 표기(구상은 반영 금지), 근거 URL 동반(가드레일 2)
  const applyMomentum = (r: DailyReco) => {
    const mf = recoFactorsFor(r.gu, r.dong)[0];
    if (!mf) return;
    r.reasons.push(`🚧 [${mf.certainty}] ${mf.title} — ${mf.expected}`);
    if (mf.sourceUrls.length) r.sources = [...(r.sources ?? []), mf.sourceUrls[0]];
  };

  // 5) 정성 팩트(역세권·학군·호재) 조인
  const items = picked.map((r, i) => {
    const f = matchFact(facts, r.gu, r.dong, r.name);
    if (f) {
      if (f.station) r.station = f.station;
      if (f.catalyst) r.catalyst = f.catalyst;
      if (f.school) r.school = f.school;
      if (f.amenities) r.amenities = f.amenities;
      if (f.living) r.living = f.living;
      if (f.complexNo) r.complexNo = f.complexNo;
      if (f.reasons?.length) r.reasons.push(...f.reasons);
      if (f.cautions?.length) r.cautions.push(...f.cautions);
    }
    applyMomentum(r);
    return { ...r, rank: i + 1 };
  });

  // 5b) 스트레치+ 트랙 — comfortable 초과 ~ 스윕 상한. 메인과 분리된 섹션(점수·로테이션 무접촉).
  const stretchPlus: DailyReco[] = [];
  if (spCfg?.enabled) {
    const im = loadJson<{ loanRatePct?: number; loanTermYears?: number }>('config/investment-model.json');
    const loanRate = im?.loanRatePct ?? 4.5;
    const loanTerm = im?.loanTermYears ?? 30;
    const savingWon = loadJson<{ finances?: { cashflow?: { monthlyHomeSaving?: number } } }>('config/reader-profile.json')?.finances?.cashflow?.monthlyHomeSaving ?? 0;
    const plusFmt = (manwon: number) => (manwon >= 10000 ? `+${eok(manwon)}` : `+${(manwon / 1000).toFixed(1).replace(/\.0$/, '')}천만 원`);
    const mainKeys = new Set(items.map((r) => r.complexKey));
    const spScored: DailyReco[] = [];
    for (const a of aggsWide.values()) {
      if (a.prices.length < rules.filters.minTrades180d) continue;
      const reg = regulationOf(a.gu);
      if (reg.status === 'unverified') {
        skippedUnverifiedGu.add(a.gu);
        continue;
      }
      if (mainKeys.has(a.key)) continue; // 메인 추천과 중복 제외
      if (lastSentStretch.has(a.key)) continue; // 스트레치+ 자체 쿨다운
      a.prices.sort((x, y) => x - y);
      const med = median(a.prices);
      if (med <= comfortable || med > spCfg.ceilingManwon) continue;

      const tier = tierOf(a.dong);
      const liq = liquidityScore(a.prices.length, rules.weights.liquidityCap);
      const fresh = freshnessScore(rules, a.buildYear, nowYear);
      const heat = Math.min(rules.weights.regionHeatMax, (regionHeat[a.gu] ?? 0));
      const jArr = jeonseMap.get(`${a.lawdCd}|${a.dong}|${normName(a.name)}`);
      let jeonseRatioPct = 0;
      let jeonsePts = 0;
      if (jArr && jArr.length >= rentMinSamples) {
        jArr.sort((x, y) => x - y);
        jeonseRatioPct = Math.round((median(jArr) / med) * 100);
        jeonsePts = jeonseRatioScore(rules, jeonseRatioPct);
      }
      const score = Math.round((tier * rules.weights.tierMultiplier + liq + fresh.score + heat + jeonsePts) * 10) / 10;

      const overComfort = med - comfortable;
      const monthlyPayAdd = Math.round(overComfort * monthlyPaymentPerWon(loanRate, loanTerm));
      const monthsToReach = savingWon > 0 ? Math.ceil((overComfort * 10_000) / savingWon) : null;
      const minA = a.areas.length ? Math.round(Math.min(...a.areas)) : 0;
      const maxA = a.areas.length ? Math.round(Math.max(...a.areas)) : 0;

      const reasons: string[] = [
        `실거래 중간 ${eok(med)} — 오늘 자기자본권(≤${eok(comfortable)})보다 ${plusFmt(overComfort)} 더 보태면 사정권`,
        `월 상환 증가분 약 +${monthlyPayAdd}만/월 (증분 전액 대출 가정 — 금리 ${loanRate}%·${loanTerm}년 원리금균등)`,
        `최근 ${a.prices.length}건 실거래(전용 ${minA}~${maxA}㎡) — 환금성 검증`,
      ];
      if (monthsToReach != null && monthsToReach <= 24) reasons.push(`월 매수펀드 적립 유지 시 약 ${monthsToReach}개월 뒤 자기자본 도달 — 2년 플랜 내 조달 가능`);
      if (tier >= 15) reasons.push(`투자 우선지역(${a.dong}) · 교통·개발호재`);
      if (fresh.label) reasons.push(fresh.label);
      if (jeonseRatioPct >= 65) reasons.push(`전세가율 ${jeonseRatioPct}% — 임대전환 유리`);

      const cautions: string[] = [
        `현 스트레치 상한(${eok(stretch)}) ${med > stretch ? '초과' : '이내'} — 실행 전 대출 한도(LTV·DSR·정책한도) 재확인 필수`,
      ];
      if (monthsToReach != null && monthsToReach > 24) cautions.push(`월 적립 기준 도달까지 약 ${monthsToReach}개월(2년 초과) — 적립 상향 또는 대출 여력 재점검 필요`);
      if (monthsToReach == null) cautions.push('월 매수펀드 적립액 미설정 — 조달 개월 판정 불가(/settings에서 입력)');
      if (a.buildYear != null && nowYear - a.buildYear >= 33) cautions.push('노후 단지 — 재건축 기대가 호가 선반영/분담금 리스크 확인');

      spScored.push({
        rank: 0,
        complexKey: a.key,
        name: a.name,
        gu: a.gu,
        dong: a.dong,
        buildYear: a.buildYear,
        areaText: `전용 ${minA}~${maxA}㎡`,
        medianManwon: med,
        priceRangeText: `${eok(a.prices[0])}~${eok(a.prices[a.prices.length - 1])}`,
        tradeCount: a.prices.length,
        scenario: '스트레치+',
        budgetLabel: `스트레치+ (≤${eok(spCfg.ceilingManwon)}) ➕`,
        station: '역세권 정보 확인 필요',
        reasons,
        cautions,
        score,
        isNew: true,
        overComfortManwon: overComfort,
        monthlyPayAddManwon: monthlyPayAdd,
        monthsToReach,
        regulationLabel: reg.label,
        regulationSources: reg.sourceUrls,
      });
    }
    spScored.sort((a, b) => b.score - a.score);
    const spPerGu: Record<string, number> = {};
    const spCap = spCfg.maxPerGu ?? 99;
    for (const r of spScored) {
      if (stretchPlus.length >= spCfg.limit) break;
      if ((spPerGu[r.gu] ?? 0) >= spCap) continue;
      spPerGu[r.gu] = (spPerGu[r.gu] ?? 0) + 1;
      const f = matchFact(facts, r.gu, r.dong, r.name);
      if (f) {
        if (f.station) r.station = f.station;
        if (f.catalyst) r.catalyst = f.catalyst;
        if (f.school) r.school = f.school;
        if (f.amenities) r.amenities = f.amenities;
        if (f.living) r.living = f.living;
        if (f.complexNo) r.complexNo = f.complexNo;
      }
      applyMomentum(r);
      stretchPlus.push({ ...r, rank: stretchPlus.length + 1 });
    }
  }

  // 6) 갭투자 트랙 — 비규제 지역(region-regulation 테이블 non-regulated) 전용. 전세 승계·무대출 갭 매수 → 즉시임대 가능.
  const gapCfg = rules.gapTrack;
  const gapTrack: DailyReco[] = [];
  const nonRegGus = nonRegulatedGus();
  if (gapCfg?.enabled && nonRegGus.size > 0) {
    const usableManwon = Math.round(
      (loadJson<{ finances?: { usableCapital?: number } }>('config/reader-profile.json')?.finances?.usableCapital ?? 200_000_000) / 10_000,
    );
    const pickedKeys = new Set([...items, ...stretchPlus].map((r) => r.complexKey));
    const gapScored: DailyReco[] = [];
    for (const a of aggs.values()) {
      if (!nonRegGus.has(a.gu)) continue;
      if (a.prices.length < gapCfg.minTrades) continue;
      if (pickedKeys.has(a.key)) continue; // 메인 추천과 중복 제외
      a.prices.sort((x, y) => x - y);
      const med = median(a.prices);
      if (med > stretch) continue;
      const jArr = jeonseMap.get(`${a.lawdCd}|${a.dong}|${normName(a.name)}`);
      if (!jArr || jArr.length < rentMinSamples) continue;
      jArr.sort((x, y) => x - y);
      const jeonseMed = median(jArr);
      const gap = med - jeonseMed;
      if (gap <= 0) continue;
      const ratioPct = Math.round((jeonseMed / med) * 100);
      if (ratioPct < gapCfg.minJeonseRatioPct || gap > gapCfg.maxGapManwon) continue;
      const coverable = gap <= usableManwon;
      const fresh = freshnessScore(rules, a.buildYear, nowYear);
      const minA = a.areas.length ? Math.round(Math.min(...a.areas)) : 0;
      const maxA = a.areas.length ? Math.round(Math.max(...a.areas)) : 0;
      const reasons: string[] = [
        '🔓 비규제(토허 아님) — 전세 끼고 무대출 매수 시 즉시임대 가능(2년 실거주·6개월 전입의무 회피)',
        `전세가율 ${ratioPct}% — 전세수요 강·갭 소액${coverable ? '(자기자본 커버 가능)' : ''}`,
        `최근 ${a.prices.length}건 실거래(전용 ${minA}~${maxA}㎡) — 환금성 검증`,
      ];
      if (fresh.label) reasons.push(fresh.label);
      const cautions: string[] = [
        '무대출 갭 전제 — 주담대 받으면 6개월 전입의무로 임대 불가. 신규 세입자 전세대출은 조건부 금지 → 기존 세입자 승계 권장',
        '⚠️ 만안구는 국토부 모니터링 대상 — 가격 급등 시 규제지정→갭 봉쇄 리스크. 매수 직전 규제 현황 재확인',
      ];
      gapScored.push({
        rank: 0,
        complexKey: a.key,
        name: a.name,
        gu: a.gu,
        dong: a.dong,
        buildYear: a.buildYear,
        areaText: `전용 ${minA}~${maxA}㎡`,
        medianManwon: med,
        priceRangeText: `${eok(a.prices[0])}~${eok(a.prices[a.prices.length - 1])}`,
        tradeCount: a.prices.length,
        scenario: '갭투자',
        budgetLabel: coverable ? '갭 자기자본 내 🔓' : '갭 자기자본 초과분 필요',
        station: '역세권 정보 확인 필요',
        reasons,
        cautions,
        score: ratioPct,
        isNew: true,
        jeonseManwon: jeonseMed,
        gapManwon: gap,
        jeonseRatioPct: ratioPct,
        gapCoverable: coverable,
        nonRegulated: true,
        regulationLabel: regulationOf(a.gu).label,
        regulationSources: regulationOf(a.gu).sourceUrls,
      });
    }
    // 전세가율 높은순(갭 작은순) → 갭 작은순 보조
    gapScored.sort((a, b) => (b.jeonseRatioPct ?? 0) - (a.jeonseRatioPct ?? 0) || (a.gapManwon ?? 0) - (b.gapManwon ?? 0));
    gapScored.slice(0, gapCfg.limit).forEach((r, i) => {
      const f = matchFact(facts, r.gu, r.dong, r.name);
      if (f) {
        if (f.station) r.station = f.station;
        if (f.catalyst) r.catalyst = f.catalyst;
        if (f.complexNo) r.complexNo = f.complexNo;
        if (f.reasons?.length) r.reasons.push(...f.reasons);
      }
      applyMomentum(r);
      gapTrack.push({ ...r, rank: i + 1 });
    });
  }

  const gateNote = skippedUnverifiedGu.size
    ? ` · ⛔ 규제 미검증 지역 제외: ${[...skippedUnverifiedGu].join(', ')}(config/region-regulation.json 검증 후 편입)`
    : '';
  const note = items.length
    ? `${items.length}건 추천 (신규 ${items.filter((x) => x.isNew).length} · 재등장 ${items.filter((x) => !x.isNew).length})${stretchPlus.length ? ` · 스트레치+ ${stretchPlus.length}건` : ''}${gapTrack.length ? ` · 갭투자 트랙 ${gapTrack.length}건` : ''}${gateNote}`
    : `오늘은 규칙을 통과한 신규 후보가 없습니다(최근 14일 추천분 쿨다운). 시장 변화 시 재등장합니다.${gateNote}`;

  return { asOf: todayStr, items, stretchPlus, gapTrack, note, scanned: aggs.size };
}
