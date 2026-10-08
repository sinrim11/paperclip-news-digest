/**
 * 일일 매물 추천 엔진 (결정적 규칙 기반).
 *
 * 파이프라인: 국토부 실거래(AptTrade) → 단지 집계 → 스코어링(tier·유동성·예산적합·연식·지역열기)
 *   → 시장 컨텍스트 가점 → 로테이션(14일 쿨다운, 변화 시 재등장) → 상위 N.
 * config/recommendation-rules.json(규칙) + config/market-context.json(일일 갱신 컨텍스트) 소비.
 * 결과는 텔레그램 발송 스키마(scripts/send-recommendations.ts)와 호환.
 */

import type { PrismaClient } from '@prisma/client';
import { normDong } from './trade-key'; // 법정동 표기 정규화(읍+리 → 읍) — 웹 조인과 같은 규칙 공유
import { readFileSync } from 'fs';
import { join } from 'path';
import { tierOf, LAWD_GU } from './tiers';
import { monthlyPaymentPerWon } from './tracker';
import { regulationOf, nonRegulatedGus } from './region-regulation';
import { recoFactorsFor } from './momentum';
import { downsideFlags, supplyRiskFlag, DEFAULT_DOWNSIDE, type DownsideConfig } from './downside';

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
  // 단지 규모·상태(2026-08-29) — ComplexCandidate(네이버 스윕) 조인. 미수집 단지는 null.
  household?: number | null; // 총 세대수 — 투자 가치 판단의 기본 축(소규모 단지 배제)
  far?: number | null; // 용적률 %
  lastTradeDate?: string; // 최근 실거래일 "MM-DD"
  lastTradeManwon?: number; // 최근 실거래가(만원)
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
  signalLowManwon?: number; // 재등장 트리거가 된 신저가(만원) — 발송 로그에 기록해 같은 저가로 반복 재등장 방지
  signalTag?: string; // 재등장 신호 멱등 태그 — "vol:<건수>" | "high:<만원>" (2026-08-11 신호 다양화)
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
  filters: { minExclusiveAreaM2: number; minTrades180d: number; lookbackDays: number; rentMinSamples?: number; minHousehold?: number };
  weights: { tierMultiplier: number; liquidityCap: number; budgetFitComfortable: number; budgetFitStretch: number; freshnessMax: number; regionHeatMax: number; jeonseRatioMax?: number };
  freshnessByAge: Array<{ maxAge: number; score: number }>;
  jeonseRatioByPct?: Array<{ minPct: number; score: number }>;
  diversity?: { maxPerGu: number; maxNonSeoulPerDay?: number; maxPerNonSeoulCity?: number };
  dailyLimit: number;
  downsideFlags?: Partial<DownsideConfig>;
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
  recentTrades: Array<{ price: number; ms: number; ar: number | null }>;
}

/**
 * 평형 밴드(2026-09-09) — 신저가·신고가를 같은 평형 안에서만 비교하기 위한 구간.
 * 경계는 전용 59/84/101/114가 주력인 국내 아파트 시장 구분을 따른다.
 *
 * 왜 필요한가: 종전엔 단지 전체의 min/max와 전체 중간값을 썼다. 평형이 섞인 단지(전체의 39%)
 * 에서는 작은 평형 거래가 늘 급락, 큰 평형 거래가 늘 급등으로 잡힌다. 실제로 9/8~9/9에
 * 국제산장이 "신저가 4.20억 급매"(59.94㎡) 다음날 "신고가 5.90억 추격매수 주의"(84.15㎡)로
 * 상반된 신호를 냈다.
 * 실측(9/9 데이터): 신저가 137→74건(오탐 63건 제거), 신고가 95→113건(큰 평형 최고가에
 * 가려 있던 작은 평형 신호가 살아남), 같은 단지 신저가·신고가 동시 성립 8→3건.
 */
const areaBand = (ar: number | null): string =>
  ar == null ? '면적미상' : ar < 60 ? '~59㎡' : ar < 85 ? '60~84㎡' : ar < 102 ? '85~101㎡' : '102㎡~';

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

/**
 * 거래량 신호 재발동 하한 — 이미 알린 건수보다 "의미 있게" 늘어야 새 신호다.
 * 2026-10-08: 종전 `recVol > alreadyVol`은 +1건에도 재발동해 진접삼부르네상스더퍼스트가
 * vol:4 → vol:5로 6일 새 3회 나갔다. +50%와 +2건 중 큰 쪽을 요구한다(4→6, 6→9, 10→15).
 */
export function volReentryFloor(alreadyVol: number): number {
  if (alreadyVol <= 0) return 0;
  return Math.max(alreadyVol + 2, Math.ceil(alreadyVol * 1.5));
}

export async function buildDailyRecommendations(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<{
  asOf: string;
  /** 호가(네이버 스윕) 수집일. asOf는 '이 추천을 만든 날'이라 호가가 며칠 묵었는지는 알려주지 않는다. */
  quoteAsOf: string | null;
  quoteStaleDays: number | null;
  items: DailyReco[];
  stretchPlus: DailyReco[];
  gapTrack: DailyReco[];
  excluded: Array<{ complexKey: string; name: string; gu: string; dong: string; flags: string[]; tracks: string[] }>;
  note: string;
  scanned: number;
}> {
  const rules = loadJson<Rules>('config/recommendation-rules.json');
  if (!rules) throw new Error('config/recommendation-rules.json 로드 실패');
  const ctx = loadJson<MarketContext>('config/market-context.json');

  const comfortable = ctx?.budgetReality?.comfortableCeilingManwon ?? rules.budgetFallback.comfortableCeilingManwon;
  const stretch = ctx?.budgetReality?.stretchCeilingManwon ?? rules.budgetFallback.stretchCeilingManwon;
  const regionHeat = ctx?.regionHeat ?? {};
  const nowYear = new Date(now.getTime() + 9 * 3_600_000).getUTCFullYear();
  const todayStr = kstDateStr(now);

  // 사용자 피드백(2026-08-11, 텔레그램 버튼) — ban=전 트랙 제외, like=+5 가점
  const fbStore = loadJson<{ feedback?: Record<string, { status?: string }> }>('config/reco-feedback.json');
  const fbBan = new Set<string>();
  const fbLike = new Set<string>();
  for (const [k, v] of Object.entries(fbStore?.feedback ?? {})) {
    if (v?.status === 'ban') fbBan.add(k);
    else if (v?.status === 'like') fbLike.add(k);
  }
  const fbBannedKeys = new Set<string>();

  // 부모님 찬스(2026-08-10) — reader-profile contingencySupport.가족지원(원)을 만원으로 환산.
  // 스트레치+ 상한을 "본인 스트레치 + 부모님 지원"까지 동적 확장해 서울 상위 가격대까지 검토권 편입.
  const parentSupportManwon = Math.round(
    (loadJson<{ finances?: { contingencySupport?: { 가족지원?: number } } }>('config/reader-profile.json')?.finances?.contingencySupport?.가족지원 ?? 0) / 10_000,
  );

  // 스트레치+ 트랙 상한 — 메인(stretch)보다 높으면 실거래 조회 상한을 함께 올린다
  const spCfg = rules.stretchPlus;
  const spDynamicCeiling = spCfg?.enabled ? Math.max(spCfg.ceilingManwon, stretch + parentSupportManwon) : stretch;
  const spCeiling = spCfg?.enabled ? Math.max(stretch, spDynamicCeiling) : stretch;

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
      a.recentTrades.push({ price: r.dealAmount, ms, ar: r.excluUseAr ?? null });
      m.set(key, a);
    }
    return m;
  };
  const aggs = buildAggs(stretch);
  const aggsWide = spCeiling > stretch ? buildAggs(spCeiling) : aggs;

  // 1a) 단지 제원(세대수·용적률) 조인(2026-08-29) — 국토부 실거래엔 없는 정보라
  //     네이버 스윕 결과(ComplexCandidate)에서 gu|dong|정규화 단지명으로 매칭.
  //     미수집 단지는 null → 세대수 게이트는 "아는 경우에만" 적용(신규 편입 지역 전멸 방지).
  const candidates = await prisma.complexCandidate.findMany({ select: { gu: true, dong: true, name: true, household: true, far: true, sweptAt: true } });
  // 호가 신선도 — 스윕이 조용히 0단지로 끝나도 추천은 계속 나오므로(2026-08-20~30 11일간 실제로 그랬다)
  // 며칠 묵은 호가인지를 산출물에 박아 소비처가 표시할 수 있게 한다.
  const latestSwept = candidates.reduce<Date | null>((m, c) => (!m || c.sweptAt > m ? c.sweptAt : m), null);
  const quoteAsOf = latestSwept ? latestSwept.toISOString().slice(0, 10) : null;
  const quoteStaleDays = latestSwept
    ? Math.floor((now.getTime() - latestSwept.getTime()) / 86_400_000)
    : null;
  const specByKey = new Map<string, { household: number; far: number | null }>();
  for (const c of candidates) specByKey.set(`${c.gu}|${normDong(c.dong)}|${normName(c.name)}`, { household: c.household, far: c.far ?? null });
  // 별칭 — 국토부와 네이버가 같은 단지를 다르게 부른다('초원부영' vs '초원7단지부영').
  // 정규화로는 못 잡고 유사도 추론은 오매칭이 나므로 관측된 것만 매핑한다(config/complex-aliases.json).
  // 이 맵은 spec 조인 전용이며 complexKey(쿨다운 키)는 실거래 원본 이름을 그대로 쓴다.
  const aliasCfg = loadJson<{ aliases?: Record<string, string> }>('config/complex-aliases.json');
  const aliases = aliasCfg?.aliases ?? {};
  const specOf = (a: ComplexAgg) => {
    const direct = specByKey.get(`${a.gu}|${normDong(a.dong)}|${normName(a.name)}`);
    if (direct) return direct;
    const alias = aliases[`${a.gu}|${a.dong}|${a.name}`] ?? aliases[`${a.gu}|${normDong(a.dong)}|${a.name}`];
    return alias ? specByKey.get(`${a.gu}|${normDong(a.dong)}|${normName(alias)}`) ?? null : null;
  };
  /** 최근 실거래 1건(날짜·가격) — "언제 얼마에 팔렸나"는 호가 신뢰도 판단의 기준점. */
  const lastTradeOf = (a: ComplexAgg): { lastTradeDate?: string; lastTradeManwon?: number } => {
    const last = a.recentTrades.reduce<{ price: number; ms: number } | null>((m, t) => (!m || t.ms > m.ms ? t : m), null);
    return last ? { lastTradeDate: kstDateStr(new Date(last.ms)).slice(5), lastTradeManwon: last.price } : {};
  };
  const minHousehold = rules.filters.minHousehold ?? 0;
  let smallSkipped = 0;

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
    select: { complexKey: true, medianManwon: true, sentDate: true, scenario: true, signalLowManwon: true, signalTag: true },
    orderBy: { sentDate: 'desc' },
  });
  const lastSentByKey = new Map<string, { medianManwon: number; sentDate: string; signalLowManwon: number | null }>();
  const lastSentStretch = new Map<string, { medianManwon: number; sentDate: string }>();
  // 쿨다운 내 이미 알린 신호 수준 — 같은 수준의 신호(같은 저가·같은 거래량·같은 신고가)로 매일 재발동하는 것을 차단
  const notifiedLowByKey = new Map<string, number>();
  // 저가·고가 멱등은 밴드 단위(2026-09-09) — 키 `${complexKey}|${band}`.
  // 단지 단위로 두면 큰 평형 가격이 항상 커서 작은 평형 신호가 영구히 묻힌다.
  const notifiedVolByKey = new Map<string, number>(); // "vol:<건수>" — 거래량은 단지 단위 신호라 밴드 무관
  const notifiedHighByKey = new Map<string, number>(); // "high:<밴드>:<만원>" (구 형식 "high:<만원>" 호환)
  const spCooldownSince = kstDateStr(new Date(now.getTime() - spCooldownDays * 86_400_000));
  for (const s of recentSent) {
    if (s.scenario === '스트레치+') {
      if (s.sentDate >= spCooldownSince && !lastSentStretch.has(s.complexKey)) lastSentStretch.set(s.complexKey, s);
      // 2026-10-08: 쿨다운은 트랙 무관 단지 단위(사용자 결정). 종전엔 스트레치+ 발송이 메인·갭 쿨다운에
      // 안 보여, 트랙만 바꿔 새 신호 없이 재발송됐다(비산파크뷰 9/25 메인 → 10/08 스트레치+ 등 4일 연속).
      if (s.sentDate >= cooldownSince && !lastSentByKey.has(s.complexKey)) lastSentByKey.set(s.complexKey, s);
    } else if (s.sentDate >= cooldownSince) {
      if (!lastSentByKey.has(s.complexKey)) lastSentByKey.set(s.complexKey, s);
      if (s.signalLowManwon != null) {
        // signalLowManwon은 숫자 컬럼이라 밴드를 못 담는다 → 밴드는 signalTag("low:<밴드>:<만원>")에서 읽고
        // 옛 기록(태그 없음)은 '(전체)'로 넣어 하위호환을 지킨다.
        const lb = s.signalTag?.startsWith('low:') ? s.signalTag.slice(4, s.signalTag.lastIndexOf(':')) : '(전체)';
        for (const k of [`${s.complexKey}|${lb}`, `${s.complexKey}|*`]) {
          // `|*`는 밴드 무관 최저가(2026-09-12). 9/9 밴드 전환 때 옛 기록은 '(전체)' 밴드로만
          // 들어가 새 밴드 키와 매칭되지 않았고, 그 결과 안양씨엘포레자이가 9/8·9/12에 같은
          // 6.4억으로 두 번 나갔다 — 이 프로젝트가 처음 고쳤던 반복 전송의 재발이다.
          // 밴드가 달라도 "이 단지에서 이미 알린 저가"보다 낮아야 새 신호로 본다.
          const prev = notifiedLowByKey.get(k);
          if (prev == null || s.signalLowManwon < prev) notifiedLowByKey.set(k, s.signalLowManwon);
        }
      }
      if (s.signalTag?.startsWith('vol:')) {
        const v = Number(s.signalTag.slice(4));
        if (Number.isFinite(v) && v > (notifiedVolByKey.get(s.complexKey) ?? 0)) notifiedVolByKey.set(s.complexKey, v);
      } else if (s.signalTag?.startsWith('high:')) {
        const rest = s.signalTag.slice(5);
        const i = rest.lastIndexOf(':');
        const bandPart = i >= 0 ? rest.slice(0, i) : '(전체)'; // 밴드 없는 옛 태그
        const v = Number(i >= 0 ? rest.slice(i + 1) : rest);
        for (const k of [`${s.complexKey}|${bandPart}`, `${s.complexKey}|*`]) {
          if (Number.isFinite(v) && v > (notifiedHighByKey.get(k) ?? 0)) notifiedHighByKey.set(k, v);
        }
      }
    }
  }

  // 3) 스코어링 — 규제 미검증 지역은 게이트에서 제외(가드레일 1: 규제 확인 안 된 지역 추천 금지)
  const newSignalWindowMs = rules.newSignal.recentTradeWindowDays * 86_400_000;
  const scored: DailyReco[] = [];
  const skippedUnverifiedGu = new Set<string>();
  // 하방 경고 플래그(2-B) — excludeThreshold개 이상이면 제외+로그, 1개는 유의점
  const dsCfg: DownsideConfig = { ...DEFAULT_DOWNSIDE, ...(rules.downsideFlags ?? {}) };
  // 트랙(메인·스트레치+·갭)별 판정에서 같은 단지가 중복 기록되지 않도록 key 기준 dedup(2026-08-05)
  const excludedByKey = new Map<string, { name: string; gu: string; dong: string; flags: string[] }>();
  // 트랙별 제외 사유를 따로 남긴다(2026-09-05). 메인은 aggs(≤stretch), 스트레치+/갭트랙은
  // aggsWide(≤spCeiling)로 서로 다른 거래 표본을 쓰기 때문에 같은 단지의 하방 플래그 판정이
  // 갈릴 수 있다 — 실제로 도봉 창동 동아청솔이 메인 med 8.0억(플래그 2: 거래량 급감·전세가율
  // 50%)과 스트레치+ med 8.5억(플래그 1: 전세가율 47%)으로 갈려 제외 목록과 추천에 동시
  // 등장했다. 표본이 다르니 판정이 다른 건 설계상 자연스럽지만, 트랙 표시 없이 합쳐 보여주면
  // 모순으로 읽힌다.
  const excludedTracks = new Map<string, Set<string>>();
  const recordExcluded = (key: string, e: { name: string; gu: string; dong: string; flags: string[] }, track: string) => {
    if (!excludedByKey.has(key)) excludedByKey.set(key, e);
    (excludedTracks.get(key) ?? excludedTracks.set(key, new Set()).get(key)!).add(track);
  };
  const flagsOf = (a: ComplexAgg, jeonseRatioPct: number | null, jeonseSamples: number) => {
    const flags = downsideFlags(
      { tradeMs: a.recentTrades.map((t) => t.ms), lookbackDays: rules.filters.lookbackDays, nowMs: now.getTime(), jeonseRatioPct, jeonseSamples },
      dsCfg,
    );
    const supply = supplyRiskFlag(a.gu); // 외부 지표(미분양·입주물량, 월간) — high 지역만 1플래그
    if (supply) flags.push(supply);
    return flags;
  };
  for (const a of aggs.values()) {
    if (a.prices.length < rules.filters.minTrades180d) continue;
    if (fbBan.has(a.key)) { fbBannedKeys.add(a.key); continue; } // 사용자 제외 피드백
    const spec = specOf(a);
    if (spec && spec.household < minHousehold) { smallSkipped++; continue; } // 소규모 단지 — 투자 가치 게이트
    const reg = regulationOf(a.gu);
    if (reg.status === 'unverified') {
      skippedUnverifiedGu.add(a.gu);
      continue;
    }
    a.prices.sort((x, y) => x - y);
    const med = median(a.prices);
    if (med > stretch) continue;

    // 로테이션: 쿨다운 내면 스킵, 단 새 신호 발생 시 재등장(2026-08-11 신호 3종으로 확장).
    // 각 신호는 "이미 알린 수준"(notified* 맵)을 넘어설 때만 발동 — 같은 신호로 매일 재발송 방지.
    //  ① 신저가: 직전 발송 중간 대비 -threshold% 저가 거래 (급매·바닥 신호)
    //  ② 거래량 급증: 신고확정 집계(30일 지연 보정) 기준 직전 W일 대비 2배+ (매수세 유입)
    //  ③ 신고가: 직전 발송 중간 대비 +threshold% 고가 거래 (상승 모멘텀)
    const last = lastSentByKey.get(a.key);
    let isNew = true;
    let signalNote: string | undefined;
    let signalLowManwon: number | undefined;
    let signalTag: string | undefined;
    if (last) {
      isNew = false;
      if (!rules.rotation.reentryOnNewSignal) continue;
      const nowMs = now.getTime();
      const wMs = newSignalWindowMs;
      const wDays = rules.newSignal.recentTradeWindowDays;
      // ① 신저가 — 같은 평형 밴드 안에서만 비교(2026-09-09).
      //    종전엔 단지 전체 최저가를 '직전 발송 중간값'과 견줬는데, 평형이 섞이면 작은 평형
      //    거래가 늘 급락으로 잡힌다(실측 137건 중 63건이 이 오탐).
      const recentByBand = new Map<string, Array<{ price: number; ms: number; ar: number | null }>>();
      const olderByBand = new Map<string, Array<{ price: number; ms: number; ar: number | null }>>();
      for (const t of a.recentTrades) {
        const b = areaBand(t.ar);
        const m = nowMs - t.ms <= wMs ? recentByBand : olderByBand;
        (m.get(b) ?? m.set(b, []).get(b)!).push(t);
      }
      let recentLow = Infinity;
      let dropPct = 0;
      let lowBand = '';
      for (const [b, rs] of recentByBand) {
        const os = olderByBand.get(b);
        if (!os || os.length < 3) continue; // 그 평형의 과거 표본이 얇으면 판정하지 않는다
        const baseline = median([...os.map((t) => t.price)].sort((x, y) => x - y));
        const lo = Math.min(...rs.map((t) => t.price));
        const d = ((baseline - lo) / baseline) * 100;
        // 밴드별 기록과 단지 전체 기록을 모두 넘어야 새 신호다
        const already = Math.min(
          notifiedLowByKey.get(`${a.key}|${b}`) ?? Infinity,
          notifiedLowByKey.get(`${a.key}|*`) ?? Infinity,
        );
        if (d > dropPct && lo < already) { dropPct = d; recentLow = lo; lowBand = b; }
      }
      const alreadyLow = lowBand
        ? Math.min(notifiedLowByKey.get(`${a.key}|${lowBand}`) ?? Infinity, notifiedLowByKey.get(`${a.key}|*`) ?? Infinity)
        : undefined;
      // ② 거래량 급증 — 최근 30일은 신고 미완이라 확정 구간(30일 이전)끼리 비교
      const lagMs = 30 * 86_400_000;
      const recVol = a.recentTrades.filter((t) => t.ms > nowMs - lagMs - wMs && t.ms <= nowMs - lagMs).length;
      const priorVol = a.recentTrades.filter((t) => t.ms > nowMs - lagMs - 2 * wMs && t.ms <= nowMs - lagMs - wMs).length;
      const alreadyVol = notifiedVolByKey.get(a.key) ?? 0;
      // ③ 신고가 — 단지 "자신의 이전 최고가"(window 밖 거래)를 실제로 넘어야 함.
      //    발송 중간값과 비교하면 큰 평형 거래가 항상 '상승'으로 오탐(+71% 같은 허수)된다.
      //    밴드별로 '그 평형의 이전 최고가'와 비교한다. 단지 전체 최고가와 견주면 작은 평형은
      //    영원히 신고가가 될 수 없어 신호가 묻힌다(실측 95→113건으로 회복).
      let prevMax = Infinity;
      let recentHigh = 0;
      let risePct = 0;
      let highBand = '';
      for (const [b, rs] of recentByBand) {
        const os = olderByBand.get(b);
        if (!os || os.length < 3) continue;
        const pm = Math.max(...os.map((t) => t.price));
        const rh = Math.max(...rs.map((t) => t.price));
        const r = ((rh - pm) / pm) * 100;
        const already = Math.max(notifiedHighByKey.get(`${a.key}|${b}`) ?? 0, notifiedHighByKey.get(`${a.key}|*`) ?? 0);
        if (rh > pm && r > risePct && rh > already) { prevMax = pm; recentHigh = rh; risePct = r; highBand = b; }
      }
      const alreadyHigh = highBand
        ? Math.max(notifiedHighByKey.get(`${a.key}|${highBand}`) ?? 0, notifiedHighByKey.get(`${a.key}|*`) ?? 0)
        : 0;

      if (recentLow !== Infinity && dropPct >= rules.newSignal.priceDropPct && (alreadyLow == null || recentLow < alreadyLow)) {
        signalNote = `🔻 신저가 ${eok(recentLow)} · 전용 ${lowBand}(같은 평형 중간 대비 ${dropPct.toFixed(1)}%↓) — 급매 신호`;
        signalLowManwon = recentLow;
        signalTag = `low:${lowBand}:${recentLow}`;
      } else if (recVol >= 4 && recVol >= 2 * Math.max(1, priorVol) && recVol >= volReentryFloor(alreadyVol)) {
        signalNote = `📈 거래량 급증 — 신고확정 기준 직전 ${wDays}일 ${priorVol}건 → 최근 ${wDays}일 ${recVol}건 (매수세 유입)`;
        signalTag = `vol:${recVol}`;
      } else if (prevMax !== Infinity && recentHigh > prevMax && risePct >= 1 && recentHigh > alreadyHigh) {
        signalNote = `📈 신고가 경신 ${eok(recentHigh)} · 전용 ${highBand}(같은 평형 직전 최고 ${eok(prevMax)} 대비 +${risePct.toFixed(1)}%) — 상승 모멘텀·추격매수 주의`;
        signalTag = `high:${highBand}:${recentHigh}`;
      } else {
        continue; // 쿨다운 — 새 신호 없음
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

    // 하방 경고 플래그(2-B) — 임계 이상이면 제외+사유 기록, 1개면 유의점으로 통과
    const dFlags = flagsOf(a, jeonseArr && jeonseArr.length >= rentMinSamples ? jeonseRatioPct : null, jeonseArr?.length ?? 0);
    if (dFlags.length >= dsCfg.excludeThreshold) {
      recordExcluded(a.key, { name: a.name, gu: a.gu, dong: a.dong, flags: dFlags.map((f) => f.label) }, '메인');
      continue;
    }

    const fbPts = fbLike.has(a.key) ? 5 : 0; // 관심 피드백 가점
    const score = Math.round((tierPts + liq + budgetPts + fresh.score + heat + jeonsePts + fbPts) * 10) / 10;

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
    if (fbPts) reasons.push('❤️ 관심 표시 단지 — 사용자 피드백 가점 +5');
    if (signalNote) reasons.push(signalNote); // 아이콘은 신호 생성부에서 유형별(🔻급매·📈모멘텀) 부여

    const cautions: string[] = [];
    if (!inComfortable) cautions.push(`오늘 자기자본권(${eok(comfortable)}) 초과 — 2년 적립 또는 마통 해지로 도달`);
    if (a.buildYear != null && nowYear - a.buildYear >= 33) cautions.push('노후 단지 — 재건축 기대가 호가 선반영/분담금 리스크 확인');
    if (jeonseRatioPct >= 100) cautions.push(`전세가율 ${jeonseRatioPct}% — 매매≈전세, 역전세/깡통 위험 점검(임대전환 시 보증금 상환 여력 확인)`);
    for (const f of dFlags) cautions.push(`🚩 하방 신호(${dFlags.length}/${dsCfg.excludeThreshold}): ${f.label}`);

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
      household: spec?.household ?? null,
      far: spec?.far ?? null,
      ...lastTradeOf(a),
      reasons,
      cautions,
      score,
      isNew,
      signalNote,
      signalLowManwon,
      signalTag,
      regulationLabel: reg.label,
      regulationSources: reg.sourceUrls,
    });
  }

  // 4) 다양성 캡(구별 최대 N + 비서울 합산 최대 N — 2026-08-10 남양주 편중 완화) 적용하며 상위 선별
  const facts = loadJson<ComplexFact[]>('config/complex-facts.json') ?? [];
  const isSeoulKey = (complexKey: string) => complexKey.startsWith('11'); // lawdCd 11* = 서울
  const maxNonSeoul = rules.diversity?.maxNonSeoulPerDay ?? 99;
  const maxPerCity = rules.diversity?.maxPerNonSeoulCity ?? 99; // 경기 특정 시(남양주) 독점 방지
  scored.sort((a, b) => b.score - a.score);
  const picked: DailyReco[] = [];
  const perGu: Record<string, number> = {};
  let nonSeoulPicked = 0;
  const cap = rules.diversity?.maxPerGu ?? 99;
  for (const r of scored) {
    if (picked.length >= rules.dailyLimit) break;
    if ((perGu[r.gu] ?? 0) >= cap) continue;
    if (!isSeoulKey(r.complexKey)) {
      if (nonSeoulPicked >= maxNonSeoul) continue;
      if ((perGu[r.gu] ?? 0) >= maxPerCity) continue;
      nonSeoulPicked++;
    }
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
      if (fbBan.has(a.key)) { fbBannedKeys.add(a.key); continue; } // 사용자 제외 피드백
      const spCand = specOf(a);
      if (spCand && spCand.household < minHousehold) { smallSkipped++; continue; }
      const reg = regulationOf(a.gu);
      if (reg.status === 'unverified') {
        skippedUnverifiedGu.add(a.gu);
        continue;
      }
      if (mainKeys.has(a.key)) continue; // 메인 추천과 중복 제외
      if (lastSentStretch.has(a.key) || lastSentByKey.has(a.key)) continue; // 쿨다운 — 스트레치+ 자체 + 메인·갭 발송 이력(트랙 무관)
      a.prices.sort((x, y) => x - y);
      const med = median(a.prices);
      if (med <= comfortable || med > spDynamicCeiling) continue;

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
      // 하방 경고 플래그(2-B) — 스트레치+에도 동일 적용
      const dFlags = flagsOf(a, jArr && jArr.length >= rentMinSamples ? jeonseRatioPct : null, jArr?.length ?? 0);
      if (dFlags.length >= dsCfg.excludeThreshold) {
        recordExcluded(a.key, { name: a.name, gu: a.gu, dong: a.dong, flags: dFlags.map((f) => f.label) }, '스트레치+');
        continue;
      }
      const score = Math.round((tier * rules.weights.tierMultiplier + liq + fresh.score + heat + jeonsePts + (fbLike.has(a.key) ? 5 : 0)) * 10) / 10;

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
      if (med > stretch && parentSupportManwon > 0)
        reasons.push(`👨‍👩‍👦 부모님 찬스 구간 — 본인 상한(${eok(stretch)}) 초과분 ${eok(med - stretch)}은 가족 지원(최대 ${eok(parentSupportManwon)}) 전제 · 증여세/차용증 정리 필요`);
      if (tier >= 15) reasons.push(`투자 우선지역(${a.dong}) · 교통·개발호재`);
      if (fresh.label) reasons.push(fresh.label);
      if (jeonseRatioPct >= 65) reasons.push(`전세가율 ${jeonseRatioPct}% — 임대전환 유리`);

      const cautions: string[] = [
        `현 스트레치 상한(${eok(stretch)}) ${med > stretch ? '초과' : '이내'} — 실행 전 대출 한도(LTV·DSR·정책한도) 재확인 필수`,
      ];
      if (monthsToReach != null && monthsToReach > 24) cautions.push(`월 적립 기준 도달까지 약 ${monthsToReach}개월(2년 초과) — 적립 상향 또는 대출 여력 재점검 필요`);
      if (monthsToReach == null) cautions.push('월 매수펀드 적립액 미설정 — 조달 개월 판정 불가(/settings에서 입력)');
      if (a.buildYear != null && nowYear - a.buildYear >= 33) cautions.push('노후 단지 — 재건축 기대가 호가 선반영/분담금 리스크 확인');
      for (const f of dFlags) cautions.push(`🚩 하방 신호(${dFlags.length}/${dsCfg.excludeThreshold}): ${f.label}`);
      // 메인 트랙(예산 내 거래만)에서 하방 플래그로 걸린 단지면 알린다 — 스트레치+는 고가 거래까지
      // 포함한 넓은 표본을 보므로 같은 플래그가 희석돼 통과할 수 있다(동아청솔: 메인 med 8.0억
      // 플래그 2 → 스트레치+ med 8.5억 플래그 1). 통과 자체가 틀린 건 아니지만, 예산 가격대에서
      // 거래가 말랐다는 사실은 매수자가 알아야 한다.
      if (excludedTracks.get(a.key)?.has('메인')) {
        cautions.push(`🚩 예산 내 가격대(≤${eok(stretch)}) 거래만 보면 제외 대상 — ${(excludedByKey.get(a.key)?.flags ?? []).join(' · ')}`);
      }

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
        household: spCand?.household ?? null,
        far: spCand?.far ?? null,
        ...lastTradeOf(a),
        scenario: '스트레치+',
        budgetLabel: med > stretch ? `부모님 찬스 (≤${eok(spDynamicCeiling)}) 👨‍👩‍👦` : `스트레치+ (≤${eok(spDynamicCeiling)}) ➕`,
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
    let spNonSeoul = 0;
    const spMaxNonSeoul = rules.diversity?.maxNonSeoulPerDay ?? 99;
    for (const r of spScored) {
      if (stretchPlus.length >= spCfg.limit) break;
      if ((spPerGu[r.gu] ?? 0) >= spCap) continue;
      if (!r.complexKey.startsWith('11')) {
        if (spNonSeoul >= spMaxNonSeoul) continue;
        if ((spPerGu[r.gu] ?? 0) >= (rules.diversity?.maxPerNonSeoulCity ?? 99)) continue;
        spNonSeoul++;
      }
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
      if (fbBan.has(a.key)) { fbBannedKeys.add(a.key); continue; } // 사용자 제외 피드백
      const gapCand = specOf(a);
      if (gapCand && gapCand.household < minHousehold) { smallSkipped++; continue; }
      if (pickedKeys.has(a.key)) continue; // 메인 추천과 중복 제외
      if (lastSentByKey.has(a.key)) continue; // 쿨다운(2026-08-05 추가) — 갭 트랙도 14일 로테이션 적용, 같은 단지 매일 반복 방지
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
      // 하방 경고 플래그(2-B) — 갭 트랙에도 동일 적용(전세가율 필터로 weak-jeonse는 사실상 미발동, 거래 급감 감지용)
      const gFlags = flagsOf(a, ratioPct, jArr.length);
      if (gFlags.length >= dsCfg.excludeThreshold) {
        recordExcluded(a.key, { name: a.name, gu: a.gu, dong: a.dong, flags: gFlags.map((f) => f.label) }, '갭트랙');
        continue;
      }
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
      const regNote = regulationOf(a.gu).note;
      const cautions: string[] = [
        '무대출 갭 전제 — 주담대 받으면 6개월 전입의무로 임대 불가. 신규 세입자 전세대출은 조건부 금지 → 기존 세입자 승계 권장',
        ...(regNote ? [`⚠️ ${regNote}`] : []),
        ...gFlags.map((f) => `🚩 하방 신호(${gFlags.length}/${dsCfg.excludeThreshold}): ${f.label}`),
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
        household: gapCand?.household ?? null,
        far: gapCand?.far ?? null,
        ...lastTradeOf(a),
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

  // complexKey를 함께 싣는다(2026-09-09) — 이름만으로 추천 목록과 대조하면 동명 단지가
  // 오탐을 낸다. 9/9에 '벽산'(구로 고척·노원 하계 제외 / 금천 시흥 추천)이 교집합으로
  // 잡혔는데 셋 다 다른 단지였다.
  const excluded = [...excludedByKey.entries()].map(([key, e]) => ({
    complexKey: key,
    ...e,
    tracks: [...(excludedTracks.get(key) ?? [])],
  }));
  const gateNote = skippedUnverifiedGu.size
    ? ` · ⛔ 규제 미검증 지역 제외: ${[...skippedUnverifiedGu].join(', ')}(config/region-regulation.json 검증 후 편입)`
    : '';
  const flagNote = excluded.length ? ` · 🚩 하방 플래그 제외 ${excluded.length}건` : '';
  const fbNote = fbBannedKeys.size ? ` · 🚫 사용자 제외 ${fbBannedKeys.size}개 단지` : '';
  const smallNote = smallSkipped ? ` · 🏢 ${minHousehold}세대 미만 제외 ${smallSkipped}건` : '';
  const note = items.length
    ? `${items.length}건 추천 (신규 ${items.filter((x) => x.isNew).length} · 재등장 ${items.filter((x) => !x.isNew).length})${stretchPlus.length ? ` · 스트레치+ ${stretchPlus.length}건` : ''}${gapTrack.length ? ` · 갭투자 트랙 ${gapTrack.length}건` : ''}${gateNote}${flagNote}${fbNote}${smallNote}`
    : `오늘은 규칙을 통과한 신규 후보가 없습니다(최근 14일 추천분 쿨다운). 시장 변화 시 재등장합니다.${gateNote}${flagNote}${fbNote}${smallNote}`;

  return { asOf: todayStr, quoteAsOf, quoteStaleDays, items, stretchPlus, gapTrack, excluded, note, scanned: aggs.size };
}
