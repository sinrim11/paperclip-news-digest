/**
 * gen-cardnews.ts — 인스타그램 공유용 카드뉴스 생성기 (공유용 객관 기준).
 *
 * ★기준 설계(2026-07-05 교정): 웹 /recommend의 점수는 소유자 개인 기준(예산·통근권 Tier)이 섞여 있어
 *   공유 콘텐츠로 부적합 → 카드뉴스는 **별도의 공개 프레임 + 객관 지표만** 사용:
 *   - 프레임: "서울 6억 이하 · 300세대 이상" (특정 개인 예산이 아닌 공개 가격대 컷 — 카드에 명시)
 *   - 레이더 지수(100): 실거래갭 40 · 유동성 30(세대15+매물15) · 연식 15 · 전세가율 15 — 전부 공개 데이터
 *   - 카드는 점수보다 수치 우선: 실거래 중간(N건)·호가 갭%·전세 중간/전세가율·180일 거래량·세대/연식
 * 규격: 1080×1350(4:5) ×2배율, 9장(표지→TOP5→산정기준→정책→아웃트로).
 * ⚠️ 개인 재무 수치·개인 예산/통근 기준 절대 미포함.
 * 출력: output/cardnews/<YYYY-MM-DD>/*.png + index.json(caption 포함, /cardnews 소비)
 * 실행: npx tsx scripts/gen-cardnews.ts
 */
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { radarScore } from '../src/lib/radar-score';
import { allFactors, momentumAsOf, recoFactorsFor, type MomentumFactor } from '../src/lib/momentum';
import { LAWD_GU } from '../src/lib/tiers';
import { monthlyPaymentPerWon } from '../src/lib/tracker';

/**
 * 자금 계획(공개 프레임, 2026-08-11) — 첫 내집마련자의 1번 질문 "현금 얼마·월 얼마?"에 답한다.
 * 특정 개인이 아닌 생애최초 무주택 일반 가정: LTV 70%·수도권 한도 6억·금리 4.5%·30년 원리금균등.
 */
const FUND = { ltv: 0.7, capManwon: 60000, ratePct: 4.5, termYears: 30 };
function fundingOf(priceManwon: number): { loan: number; cash: number; monthly: number } {
  const loan = Math.min(Math.floor(priceManwon * FUND.ltv), FUND.capManwon);
  return { loan, cash: priceManwon - loan, monthly: Math.round(loan * monthlyPaymentPerWon(FUND.ratePct, FUND.termYears)) };
}

/** 실거래·전세 조인은 지역(lawdCd) 스코프 필수 — 단지명만으로 조인하면 타 지역 동명 단지(현대6차 등)가 섞인다(2026-08-10 교정). */
const GU_TO_LAWD: Record<string, string> = Object.fromEntries(Object.entries(LAWD_GU).map(([cd, gu]) => [gu, cd]));
const normName = (s: string) => s.replace(/\s|아파트/g, '');

const W = 1080, H = 1350;
const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

/**
 * 시리즈(3-A·G2-3): --series=price6(기본)|price8|price9|briefing
 *  - 금액대 큐레이션은 겹침 없는 창(window)으로 분리: 6억 이하 / 6~8억 / 8~9억
 *    → 시리즈 간 동일 단지 중복 원천 차단(마케팅용 다양성). 요일 로테이션은 gen-cardnews.sh.
 *  - 추가로 최근 COOLDOWN_DAYS일 내 어떤 시리즈든 등장한 단지는 제외(반복 노출 방지, G2-3).
 *  - briefing: 호재·정책 브리핑(momentum-factors 확정/진행 + 정책 카드, 전 항목 출처 표기)
 *  - price12(9~12억, 부모님 찬스 구간): 2026-08-11 신설 — 스윕 상한 12억 상향과 세트.
 *    그룹 로테이션상 전 지역 매물 반영까지 3~4일 소요(초기엔 풀이 작을 수 있음).
 */
type Series = 'price6' | 'price8' | 'price9' | 'price12' | 'briefing';
const series: Series = (process.argv.find((a) => a.startsWith('--series='))?.slice('--series='.length) as Series) ?? 'price6';
if (!['price6', 'price8', 'price9', 'price12', 'briefing'].includes(series)) throw new Error(`알 수 없는 시리즈: ${series}`);
const DIR_SUFFIX: Record<Series, string> = { price6: '', price8: '-p8', price9: '-p9', price12: '-p12', briefing: '-brief' };
const setDir = today + DIR_SUFFIX[series];
const OUT_DIR = join(process.cwd(), 'output', 'cardnews', setDir);

/** 공개 프레임 — 개인 예산이 아닌 카드 명시용 가격대 창 [min, max) (만원) */
const PRICE_WINDOW: Record<Exclude<Series, 'briefing'>, { min: number; max: number; label: string }> = {
  price6: { min: 0, max: 60000, label: '6억 이하' },
  price8: { min: 60000, max: 80000, label: '6~8억' },
  price9: { min: 80000, max: 92000, label: '8~9억' },
  price12: { min: 92000, max: 120000, label: '9~12억' },
};
const WINDOW = series === 'briefing' ? PRICE_WINDOW.price6 : PRICE_WINDOW[series];
const CAP_LABEL = WINDOW.label;
const MIN_HOUSEHOLD = 300;
/** 반복 노출 방지 쿨다운 — 최근 N일 내 카드뉴스(전 시리즈)에 등장한 단지 제외 */
const COOLDOWN_DAYS = 14;

/* ── 공유용 객관 지표·레이더 지수 ── */
interface SharePick {
  name: string; gu: string; dong: string; complexNo: string;
  household: number; elapsedYear: number | null;
  far: number | null; // 용적률 % — 재건축 사업성(낮을수록 유리)
  minPrice: number; dealArticles: number;
  tradeMedian: number | null; tradeCount: number;
  jeonseMedian: number | null; jeonseRatioPct: number | null;
  gapPct: number | null; // (호가-실거래)/실거래
  pyeongManwon: number | null; // 실거래 평단가(만원/3.3㎡) 중간값 — 지역·평형 간 가격 비교 축
  trendPct: number | null; // 120일 전반 vs 후반 실거래 중간값 변화율 — 가격 방향
  score: number; parts: { gap: number; liq: number; fresh: number; jeonse: number };
  facts: string[]; // 수치 기반 객관 서술
  listings: Array<{ price: number; exclusiveArea: number | null; floor: string | null }>;
  factor?: { certainty: string; title: string; expected: string; srcDomain: string } | null; // 지역 호재(확정·진행만, momentum-factors — 정부·공식 발표 근거)
  topPct?: number; // 같은 가격대 통과 단지 중 상위 % (1~100) — 절대점수보다 직관적인 비교 맥락
  poolSize?: number; // 백분위 모수(통과 단지 수)
}

/**
 * 지표별 등급(2026-08-10 직관화) — "N/40점" 같은 가중치 점수는 체계를 모르면 해석 불가.
 * 매수자의 4가지 실제 질문(싸게 나왔나·팔리나·건물 가치·전세 수요)에 등급+근거 수치로 답한다.
 */
function gradeOf(part: number, max: number): { label: string; color: string; bg: string } {
  const r = part / max;
  if (r >= 0.9) return { label: '매우 좋음', color: '#15803D', bg: '#F0FDF4' };
  if (r >= 0.65) return { label: '좋음', color: '#0F766E', bg: '#F0FDFA' };
  if (r >= 0.4) return { label: '보통', color: '#B45309', bg: '#FFFBEB' };
  return { label: '약함', color: '#DC2626', bg: '#FEF2F2' };
}

/** 정책 동향·전망 카드 데이터 — 일일 시장리서치(market-context.json, 출처 URL 동반). 개인 예산(budgetReality)은 공유 콘텐츠라 미사용. */
interface MarketCtx {
  asOf?: string;
  regime?: string;
  rate?: { base?: number; direction?: string; note?: string };
  policy?: { note?: string };
  cautions?: string[];
  sources?: Array<{ title: string; url: string }>;
}
function loadMarketCtx(): MarketCtx | null {
  try { return JSON.parse(readFileSync(join(process.cwd(), 'config', 'market-context.json'), 'utf-8')) as MarketCtx; } catch { return null; }
}
const domainOf = (u: string) => u.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');

/* ── 스타일 ── */
const baseCss = `
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:${W}px; height:${H}px; font-family:'Apple SD Gothic Neo','Pretendard',-apple-system,sans-serif; -webkit-font-smoothing:antialiased; }
  .card { width:${W}px; height:${H}px; display:flex; flex-direction:column; background:#fff; color:#0F172A; padding:72px 76px 60px; position:relative; overflow:hidden; }
  .dark { background:#0F172A; color:#fff; }
  .brand { display:flex; align-items:center; justify-content:space-between; font-size:28px; font-weight:700; color:#64748B; }
  .dark .brand { color:#94A3B8; }
  .pageno { font-variant-numeric:tabular-nums; font-weight:600; }
  .num { font-variant-numeric:tabular-nums; letter-spacing:-0.02em; }
  .foot { margin-top:auto; font-size:22px; color:#94A3B8; line-height:1.5; }
  .chip { display:inline-block; border-radius:14px; padding:10px 22px; font-weight:700; }
  .stat { background:#F8FAFC; border-radius:18px; padding:26px 30px; }
  .stat .k { font-size:25px; color:#94A3B8; font-weight:700; }
  .stat .v { font-size:44px; font-weight:800; margin-top:8px; }
  .stat .s { font-size:23px; color:#94A3B8; margin-top:6px; }
`;

const brandBar = (page: number, total: number) =>
  `<div class="brand"><span>🏠 뉴스 다이제스트 · 매수 레이더</span><span class="pageno">${today.replaceAll('-', '.')} · ${page}/${total}</span></div>`;

const eok = (m: number) => (m / 10000).toFixed(m % 10000 === 0 ? 0 : 2).replace(/\.?0+$/, '') + '억';

function coverHtml(scanned: number, passed: number, total: number, guCount: number): string {
  return `<style>${baseCss}</style><div class="card dark">
    ${brandBar(1, total)}
    <div style="margin-top:150px">
      <div style="font-size:38px;font-weight:700;color:#60A5FA;letter-spacing:0.06em">DATA RADAR</div>
      <div style="font-size:96px;font-weight:800;line-height:1.18;margin-top:26px">수도권 <span style="color:#60A5FA">${CAP_LABEL}</span><br/>아파트 레이더 TOP 5</div>
      <div style="font-size:34px;color:#CBD5E1;margin-top:42px;line-height:1.65">${guCount}개 구·시 <b style="color:#fff">${scanned.toLocaleString()}곳 스캔</b> → ${passed.toLocaleString()}곳 통과, 공개 데이터로만 채점<br/><b style="color:#60A5FA">💳 필요 현금·월 상환까지 계산해뒀습니다</b></div>
    </div>
    <div style="margin-top:auto;display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:27px;color:#64748B">국토교통부 실거래가 × 네이버부동산 호가 · 특정인 예산 기준 아님</div>
      <div style="font-size:34px;color:#60A5FA;font-weight:700">→</div>
    </div>
  </div>`;
}

/** 4대 질문 평결 그리드(2026-08-10) — 지표별 등급 + 근거 수치 한 줄. 점수 막대의 직관성 문제 해결. */
function verdictGridHtml(p: SharePick): string {
  const tiles: Array<{ icon: string; q: string; part: number; max: number; evidence: string }> = [
    {
      icon: '💰', q: '싸게 나왔나', part: p.parts.gap, max: 40,
      evidence: p.gapPct == null ? '120일 실거래 표본 없음'
        : p.gapPct <= 0 ? `호가가 실거래보다 <b>${Math.abs(p.gapPct).toFixed(1)}% 낮음</b> — 급매 가능성`
        : `호가가 실거래보다 <b>${p.gapPct.toFixed(1)}% 높음</b>${p.gapPct > 10 ? ' — 거품 주의' : ''}`,
    },
    {
      icon: '🔄', q: '팔고 싶을 때 팔리나', part: p.parts.liq, max: 30,
      evidence: `<b>${p.household.toLocaleString()}세대</b> · 매물 <b>${p.dealArticles}건</b> · 120일 거래 ${p.tradeCount}건`,
    },
    {
      icon: '🏗️', q: '건물 가치는', part: p.parts.fresh, max: 15,
      evidence: p.elapsedYear == null ? '연식 정보 없음'
        : p.elapsedYear >= 30 ? `<b>${p.elapsedYear}년차</b>${p.far != null ? ` · 용적률 ${Math.round(p.far)}%${p.far <= 180 ? ' — 재건축 사업성 양호' : ' — 재건축 기대 제한적'}` : ' — 재건축 연한'}`
        : p.elapsedYear <= 10 ? `<b>준신축 ${p.elapsedYear}년차</b> — 감가 방어·임대 선호`
        : `<b>${p.elapsedYear}년차</b>${p.far != null ? ` · 용적률 ${Math.round(p.far)}%` : ''}`,
    },
    {
      icon: '🔑', q: '전세가 받쳐주나', part: p.parts.jeonse, max: 15,
      evidence: p.jeonseRatioPct == null ? '전세 표본 부족(2건 미만)'
        : `전세가율 <b>${p.jeonseRatioPct}%</b>${p.jeonseRatioPct >= 70 ? ' — 실거주 수요 탄탄' : p.jeonseRatioPct < 55 ? ' — 하락 방어력 낮음' : ''}`,
    },
  ];
  const cells = tiles.map((t) => {
    const g = gradeOf(t.part, t.max);
    return `<div style="flex:1 1 42%;background:${g.bg};border-radius:18px;padding:24px 28px;min-width:0">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <span style="font-size:26px;font-weight:700;color:#475569">${t.icon} ${t.q}</span>
        <span style="font-size:26px;font-weight:800;color:${g.color};white-space:nowrap">${g.label}</span>
      </div>
      <div style="font-size:25px;color:#334155;margin-top:10px;line-height:1.45">${t.evidence}</div>
    </div>`;
  }).join('');
  return `<div style="display:flex;flex-wrap:wrap;gap:18px">${cells}</div>`;
}

/** TOP5 한눈 비교표(2026-08-10) — "어느 단지를 볼지" 선택을 위한 정량 비교 한 장 */
function compareHtml(top: SharePick[], page: number, total: number): string {
  const trendCell = (t: number | null) =>
    t == null ? '<span style="color:#CBD5E1">—</span>'
    : `<span class="num" style="color:${t <= -1 ? '#16A34A' : t >= 1 ? '#DC2626' : '#64748B'};font-weight:800">${t > 0 ? '▲' : t < 0 ? '▼' : ''}${Math.abs(t).toFixed(1)}%</span>`;
  const gapCell = (g: number | null) =>
    g == null ? '<span style="color:#CBD5E1">—</span>'
    : `<span class="num" style="color:${g <= 2 ? '#16A34A' : g > 10 ? '#DC2626' : '#B45309'};font-weight:700">${g >= 0 ? '+' : ''}${g.toFixed(1)}%</span>`;
  const rows = top.map((p, i) => `
    <div style="display:flex;align-items:center;gap:0;border-bottom:2px solid #E2E8F0;padding:24px 0">
      <div style="width:296px;padding-right:16px">
        <div style="display:flex;align-items:baseline;gap:10px">
          <span class="num" style="font-size:30px;font-weight:800;color:#CBD5E1">${i + 1}</span>
          <span style="font-size:29px;font-weight:800;letter-spacing:-0.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name}</span>
        </div>
        <div style="font-size:22px;color:#94A3B8;margin-top:4px">${p.gu} ${p.dong}${p.elapsedYear != null ? ` · ${p.elapsedYear}년차` : ''}</div>
      </div>
      <div class="num" style="width:140px;font-size:33px;font-weight:800;color:#2563EB">${eok(p.minPrice)}</div>
      <div style="width:186px">
        <div class="num" style="font-size:29px;font-weight:700">${p.tradeMedian ? eok(p.tradeMedian) : '—'}</div>
        <div style="font-size:21px;margin-top:2px">${gapCell(p.gapPct)}<span style="color:#CBD5E1"> · ${p.tradeCount}건</span></div>
      </div>
      <div class="num" style="width:132px;font-size:27px;font-weight:700;color:#1D4ED8">${fundingOf(p.minPrice).monthly}만</div>
      <div style="width:104px;font-size:27px">${p.jeonseRatioPct != null ? `<span class="num" style="font-weight:700;color:#7C3AED">${p.jeonseRatioPct}%</span>` : '<span style="color:#CBD5E1">—</span>'}</div>
      <div style="width:70px;font-size:26px">${trendCell(p.trendPct)}</div>
    </div>`).join('');
  const th = (w: number, label: string) => `<div style="width:${w}px;font-size:22px;font-weight:700;color:#94A3B8">${label}</div>`;
  return `<style>${baseCss}</style><div class="card">
    ${brandBar(page, total)}
    <div style="font-size:58px;font-weight:800;margin-top:46px">TOP 5 한눈 비교</div>
    <div style="font-size:26px;color:#64748B;margin-top:12px;line-height:1.5">숫자로 먼저 고르세요 — 상세 근거는 다음 장부터 한 단지씩</div>
    <div style="display:flex;margin-top:36px;border-bottom:3px solid #0F172A;padding-bottom:14px">
      ${th(296, '단지')}${th(140, '최저 호가')}${th(186, '실거래 중간·갭')}${th(132, '월 상환*')}${th(104, '전세율')}${th(70, '추이')}
    </div>
    ${rows}
    <div style="margin-top:34px;display:flex;flex-direction:column;gap:10px;font-size:24px;color:#475569;line-height:1.5">
      <div>· <b style="color:#16A34A">갭 마이너스</b> = 호가가 최근 실거래보다 낮음 → 급매 가능성(층·향·동 확인 필수)</div>
      <div>· <b style="color:#1D4ED8">월 상환*</b> = 생애최초 가정(LTV 70%·한도 6억·금리 4.5%·30년) — 소득·DSR 따라 달라짐</div>
      <div>· <b>추이</b> = 120일 전반 vs 후반 실거래 중간값 변화(<span style="color:#16A34A">▼하락</span>·<span style="color:#DC2626">▲상승</span>)</div>
    </div>
    <div class="foot">국토교통부 실거래가 × 네이버부동산 호가 · ${CAP_LABEL} · 300세대+ — 투자 자문 아님</div>
  </div>`;
}

function itemHtml(p: SharePick, rank: number, page: number, total: number): string {
  const gapColor = p.gapPct == null ? '#94A3B8' : p.gapPct <= 2 ? '#16A34A' : p.gapPct > 10 ? '#DC2626' : '#B45309';
  return `<style>${baseCss}</style><div class="card">
    ${brandBar(page, total)}
    <div style="margin-top:56px;display:flex;align-items:center;gap:22px">
      <div class="num" style="font-size:50px;font-weight:800;color:#CBD5E1">${rank}</div>
      <span class="chip num" style="background:#0F172A;color:#fff;font-size:30px">레이더 ${p.score}점</span>
      ${p.topPct != null ? `<span class="num" style="font-size:27px;font-weight:700;color:#2563EB">${CAP_LABEL} ${p.poolSize?.toLocaleString()}곳 중 상위 ${p.topPct}%</span>` : ''}
    </div>
    <div style="font-size:76px;font-weight:800;letter-spacing:-0.02em;margin-top:20px;line-height:1.15">${p.name}</div>
    <div style="font-size:31px;color:#64748B;margin-top:14px">${p.gu} ${p.dong} · ${p.household.toLocaleString()}세대${p.elapsedYear != null ? ` · ${p.elapsedYear}년차` : ''}</div>

    <div style="display:flex;gap:36px;margin-top:44px;align-items:flex-end">
      <div style="flex:1">
        <div style="font-size:27px;color:#94A3B8;font-weight:700">최저 호가</div>
        <div class="num" style="font-size:88px;font-weight:800;color:#2563EB;line-height:1.1;margin-top:4px">${eok(p.minPrice)}</div>
      </div>
      <div style="flex:1">
        ${p.tradeMedian
          ? `<div style="font-size:27px;color:#94A3B8;font-weight:700">실거래 중간 <span style="color:#CBD5E1">(120일·${p.tradeCount}건)</span></div>
             <div class="num" style="font-size:60px;font-weight:800;color:#0F172A;line-height:1.15;margin-top:6px">${eok(p.tradeMedian)}</div>
             <div style="font-size:25px;font-weight:700;margin-top:6px"><span class="num" style="color:${gapColor}">호가 ${p.gapPct! >= 0 ? '+' : ''}${p.gapPct!.toFixed(1)}%</span>${p.trendPct != null ? ` <span style="color:#CBD5E1">·</span> <span class="num" style="color:${p.trendPct <= -1 ? '#16A34A' : p.trendPct >= 1 ? '#DC2626' : '#64748B'}">추이 ${p.trendPct > 0 ? '▲' : p.trendPct < 0 ? '▼' : ''}${Math.abs(p.trendPct).toFixed(1)}%</span>` : ''}</div>`
          : `<div style="font-size:27px;color:#94A3B8;font-weight:700">실거래</div><div style="font-size:36px;color:#CBD5E1;font-weight:700;margin-top:12px">120일 표본 없음</div>`}
      </div>
    </div>

    ${(() => {
      // 💳 자금 계획 — 첫 구매자의 1번 질문. 최저 호가 기준, 생애최초 일반 가정(개인 수치 아님).
      const f = fundingOf(p.minPrice);
      return `<div style="margin-top:34px;background:#EFF6FF;border-radius:20px;padding:28px 34px">
        <div style="display:flex;align-items:baseline;justify-content:space-between">
          <span style="font-size:27px;font-weight:800;color:#1D4ED8">💳 이 가격이면 (생애최초 가정)</span>
          <span style="font-size:22px;color:#64748B">최저 호가 ${eok(p.minPrice)} 기준</span>
        </div>
        <div style="display:flex;gap:40px;margin-top:16px">
          <div><div style="font-size:24px;color:#64748B;font-weight:700">필요 현금</div><div class="num" style="font-size:52px;font-weight:800;color:#0F172A">약 ${eok(f.cash)}</div></div>
          <div><div style="font-size:24px;color:#64748B;font-weight:700">월 상환</div><div class="num" style="font-size:52px;font-weight:800;color:#1D4ED8">약 ${f.monthly}만원</div></div>
          <div style="flex:1;align-self:flex-end;font-size:22px;color:#94A3B8;line-height:1.5;text-align:right">대출 ${eok(f.loan)} · LTV 70%·한도 6억<br/>금리 4.5%·30년 가정 · 부대비용 별도</div>
        </div>
      </div>`;
    })()}
    <div style="margin-top:26px">${verdictGridHtml(p)}</div>
    ${p.factor
      ? `<div style="margin-top:20px;display:flex;gap:14px;align-items:flex-start;padding:20px 26px;background:#FFFBEB;border:2px solid #FDE68A;border-radius:16px">
           <span style="font-size:26px">🚧</span>
           <div style="font-size:25px;line-height:1.5;color:#78350F"><b>[${p.factor.certainty}]</b> ${p.factor.title} — ${p.factor.expected}
             <span style="color:#B45309">· ${p.factor.srcDomain}</span></div>
         </div>`
      : ''}
    <div class="foot">수도권 ${CAP_LABEL} · 300세대+ 전수 스캔 — 국토교통부 실거래가 공개시스템(rt.molit.go.kr) × 네이버부동산 호가 · ${today} 기준 · 투자 자문 아님 · 현장 확인 필수</div>
  </div>`;
}

/** 정책 동향·전망 카드(2026-08-10) — 일일 리서치 결과를 출처와 함께: 금리·정책 방향·체크포인트 */
function outlookHtml(ctx: MarketCtx, page: number, total: number): string {
  const dirLabel = ctx.rate?.direction === 'up' ? ['인상 국면', '#DC2626'] : ctx.rate?.direction === 'down' ? ['인하 국면', '#16A34A'] : ['동결 국면', '#94A3B8'];
  const cautions = (ctx.cautions ?? []).slice(0, 3).map((c) =>
    `<div style="display:flex;gap:14px;font-size:27px;line-height:1.55;color:#CBD5E1"><span style="color:#F59E0B;font-weight:800">!</span><span>${c}</span></div>`).join('');
  const srcs = (ctx.sources ?? []).slice(0, 4).map((s) =>
    `<div style="font-size:23px;color:#94A3B8;line-height:1.5">· ${s.title} <span style="color:#64748B">(${domainOf(s.url)})</span></div>`).join('');
  return `<style>${baseCss}</style><div class="card dark">
    ${brandBar(page, total)}
    <div style="font-size:64px;font-weight:800;margin-top:56px">정책 동향 · 전망</div>
    <div style="font-size:28px;color:#94A3B8;margin-top:14px">일일 자동 리서치 · ${ctx.asOf ?? today} 기준 — 전 항목 출처 명시</div>
    <div style="display:flex;gap:18px;margin-top:40px">
      <div style="flex:1;background:#1E293B;border-radius:18px;padding:26px 30px">
        <div style="font-size:25px;color:#94A3B8;font-weight:700">한은 기준금리</div>
        <div class="num" style="font-size:52px;font-weight:800;margin-top:6px">${ctx.rate?.base != null ? ctx.rate.base + '%' : '—'} <span style="font-size:28px;color:${dirLabel[1]}">${dirLabel[0]}</span></div>
      </div>
    </div>
    ${ctx.policy?.note ? `<div style="margin-top:26px;font-size:29px;line-height:1.6;color:#E2E8F0">${ctx.policy.note.slice(0, 190)}${ctx.policy.note.length > 190 ? '…' : ''}</div>` : ''}
    <div style="margin-top:34px;font-size:27px;font-weight:800;color:#F59E0B">매수 전 체크포인트</div>
    <div style="margin-top:16px;display:flex;flex-direction:column;gap:14px">${cautions}</div>
    <div style="margin-top:auto;padding-top:28px;border-top:2px solid #1E293B">
      <div style="font-size:24px;font-weight:700;color:#64748B;margin-bottom:10px">📎 출처</div>
      ${srcs}
    </div>
    <div class="foot" style="color:#64748B">전망·해석은 인용 보도 기준이며 확정이 아닙니다 — 발표 시 수치가 바뀔 수 있습니다</div>
  </div>`;
}

function methodHtml(page: number, total: number, scanned: number, guCount: number): string {
  const rows = [
    ['실거래 갭', 40, '최저 호가 vs 최근 실거래 중간 — 실거래보다 낮으면 만점, 거품 클수록 감점', '#16A34A'],
    ['유동성', 30, '세대수(1,500세대 만점 15) + 매매 매물 수(15건 만점 15) — 팔기 쉬운가', '#0EA5E9'],
    ['연식·재건축', 15, '준신축(10년↓) 만점 · 30년↑은 용적률 180%↓면 만점(재건축 사업성)', '#F59E0B'],
    ['전세가율', 15, '전세 중간 ÷ 매매 중간 — 70%↑면 실거주 수요 탄탄', '#7C3AED'],
  ] as const;
  const rowHtml = rows.map(([k, max, d, c]) => `
    <div style="display:flex;gap:26px;align-items:flex-start;border-bottom:2px solid #1E293B;padding:32px 0">
      <span style="display:inline-block;width:20px;height:20px;border-radius:6px;background:${c};margin-top:10px;flex-shrink:0"></span>
      <div style="flex:1">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span style="font-size:38px;font-weight:800;color:#fff">${k}</span>
          <span class="num" style="font-size:38px;font-weight:800;color:#60A5FA">${max}점</span>
        </div>
        <div style="font-size:27px;color:#94A3B8;margin-top:8px;line-height:1.5">${d}</div>
      </div>
    </div>`).join('');
  return `<style>${baseCss}</style><div class="card dark">
    ${brandBar(page, total)}
    <div style="font-size:66px;font-weight:800;margin-top:60px;line-height:1.25">레이더 지수,<br/>이렇게 계산했어요 <span style="color:#60A5FA">(100점)</span></div>
    <div style="font-size:29px;color:#CBD5E1;margin-top:26px;line-height:1.6">대상: <b style="color:#fff">수집권 ${guCount}개 구·시 · ${CAP_LABEL} · 300세대+</b> ${scanned.toLocaleString()}곳 통과<br/>모든 지표가 <b style="color:#fff">공개 데이터</b> — 특정인의 예산·통근 기준이 아닙니다 · 가격대 컷 밖 단지는 미포함</div>
    <div style="margin-top:24px">${rowHtml}</div>
    <div style="margin-top:30px;font-size:26px;color:#CBD5E1;line-height:1.6">카드 표기: 지표별 등급은 배점 대비 획득률 — <b style="color:#4ADE80">매우 좋음</b> ≥90% · <b style="color:#2DD4BF">좋음</b> ≥65% · <b style="color:#FBBF24">보통</b> ≥40% · <b style="color:#F87171">약함</b> &lt;40%. '상위 N%'는 같은 가격대 통과 단지 중 종합점수 순위.</div>
    <div class="foot" style="color:#64748B">감(感)이 아니라 규칙 — 매일 같은 기준 자동 채점 · 국토부 실거래가(공공) × 네이버부동산 호가</div>
  </div>`;
}

function policyHtml(page: number, total: number): string {
  const rows: Array<[string, string, string]> = [
    ['LTV', '생애최초 70%', '규제지역 일반 40% — 생초 우대가 예산을 결정'],
    ['주담대 상한', '최대 6억', '15억 이하 주택 기준(15~25억 4억·초과 2억)'],
    ['DSR', '40% + 스트레스', '한도 산정 시 가산금리 수도권 +3.0%p'],
    ['토지거래허가', '2년 실거주', '서울 전역 — 전세 끼고 매수(갭투자) 불가'],
  ];
  const rowHtml = rows.map(([k, v, d]) => `
    <div style="border-bottom:2px solid #1E293B;padding:44px 0">
      <div style="display:flex;align-items:baseline;justify-content:space-between">
        <span style="font-size:40px;font-weight:700;color:#94A3B8">${k}</span>
        <span class="num" style="font-size:58px;font-weight:800;color:#60A5FA">${v}</span>
      </div>
      <div style="font-size:30px;color:#CBD5E1;margin-top:14px;line-height:1.5">${d}</div>
    </div>`).join('');
  return `<style>${baseCss}</style><div class="card dark">
    ${brandBar(page, total)}
    <div style="font-size:76px;font-weight:800;margin-top:90px">무주택자 규제<br/>한눈에 보기</div>
    <div style="margin-top:40px">${rowHtml}</div>
    <div style="font-size:32px;color:#E2E8F0;margin-top:48px;line-height:1.6">💡 생애최초라면 LTV 70%가 적용돼 같은 자본으로 매수 가능 금액이 크게 늘어납니다.</div>
    <div class="foot" style="color:#64748B">10·15 대책 체계 기준 — 실행 전 최신 공고·은행 심사 확인</div>
  </div>`;
}

/* ── 시리즈 2: 호재·정책 브리핑(3-A) — momentum-factors 확정/진행 + 정책, 전 항목 출처 표기 ── */

function briefCoverHtml(count: number, total: number): string {
  return `<style>${baseCss}</style><div class="card dark">
    ${brandBar(1, total)}
    <div style="margin-top:150px">
      <div style="font-size:38px;font-weight:700;color:#F59E0B;letter-spacing:0.06em">WEEKLY BRIEFING</div>
      <div style="font-size:92px;font-weight:800;line-height:1.2;margin-top:26px">이번 주<br/><span style="color:#F59E0B">봐야 할 지역·호재</span></div>
      <div style="font-size:34px;color:#CBD5E1;margin-top:42px;line-height:1.65">착공·승인 단계의 <b style="color:#fff">검증된 호재 ${count}건</b> + 무주택자 규제 요약<br/>전 항목 <b style="color:#fff">정부·공식 발표 근거</b> — 확실성 등급(확정/진행)으로 구분</div>
    </div>
    <div style="margin-top:auto;display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:27px;color:#64748B">구상 단계 호재는 제외 — 발표만 된 계획은 싣지 않습니다</div>
      <div style="font-size:34px;color:#F59E0B;font-weight:700">→</div>
    </div>
  </div>`;
}

/** 호재 카드 v2(2026-08-11 시각화) — 개통 타임라인 + 영향 지역 칩: "언제·어디"가 한눈에 */
function factorHtml(f: MomentumFactor, page: number, total: number): string {
  const badge = f.certainty === '확정' ? ['#16A34A', '확정 — 착공·개통일 확정'] : ['#F59E0B', '진행 — 승인·부분 착공'];
  const srcs = f.sourceUrls.map((s) => s.replace(/^https?:\/\//, '').split('/')[0]).join(' · ');
  const nowYear = Number(today.slice(0, 4));
  const targetYear = Number((f.expected.match(/20\d{2}/) ?? [])[0]) || null;
  const yearsLeft = targetYear ? Math.max(0, targetYear - nowYear) : null;

  // 개통 타임라인 — 지금(좌) → 목표 연도(우), 남은 기간을 큰 수치로
  const timeline = targetYear
    ? `<div style="margin-top:44px;background:#F8FAFC;border-radius:22px;padding:36px 40px">
        <div style="display:flex;align-items:baseline;justify-content:space-between">
          <span style="font-size:27px;font-weight:700;color:#64748B">개통·완공까지</span>
          <span class="num" style="font-size:56px;font-weight:800;color:#2563EB">${yearsLeft === 0 ? '올해' : `약 ${yearsLeft}년`}</span>
        </div>
        <div style="position:relative;height:14px;background:#E2E8F0;border-radius:7px;margin-top:24px">
          <div style="position:absolute;left:0;top:0;bottom:0;width:14px;background:#0F172A;border-radius:7px"></div>
          <div style="position:absolute;right:0;top:-7px;width:28px;height:28px;background:#2563EB;border-radius:50%;border:5px solid #DBEAFE"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:25px;margin-top:14px">
          <span style="color:#0F172A;font-weight:700">지금 (${nowYear})</span>
          <span class="num" style="color:#2563EB;font-weight:800">${targetYear} — ${f.expected.replace(/20\d{2}\s*/, '')}</span>
        </div>
        ${f.certainty !== '확정' ? '<div style="font-size:23px;color:#B45309;margin-top:12px">⚠ 진행 단계 — 목표 시점은 지연될 수 있습니다</div>' : ''}
      </div>`
    : `<div class="num" style="font-size:40px;font-weight:800;color:#2563EB;margin-top:36px">${f.expected}</div>`;

  const regionChips = f.regions
    .map((r) => `<span class="chip" style="background:#EFF6FF;color:#1D4ED8;font-size:28px;font-weight:700">📍 ${r.gu}${r.dongs?.length ? ` ${r.dongs.slice(0, 3).join('·')}` : ''}</span>`)
    .join(' ');

  return `<style>${baseCss}</style><div class="card">
    ${brandBar(page, total)}
    <div style="margin-top:60px;display:flex;gap:14px;align-items:center">
      <span class="chip" style="background:${badge[0]};color:#fff;font-size:28px">${badge[1]}</span>
      ${f.type ? `<span class="chip" style="background:#F1F5F9;color:#475569;font-size:28px">${f.type}</span>` : ''}
    </div>
    <div style="font-size:60px;font-weight:800;letter-spacing:-0.02em;margin-top:28px;line-height:1.25">${f.title}</div>
    ${timeline}
    <div style="font-size:31px;color:#334155;margin-top:34px;line-height:1.6">${f.detail}</div>
    <div style="margin-top:auto;padding-top:30px">
      <div style="font-size:26px;font-weight:700;color:#94A3B8;margin-bottom:12px">수혜 지역</div>
      <div style="display:flex;flex-wrap:wrap;gap:12px">${regionChips}</div>
    </div>
    <div class="foot">📎 근거: ${srcs} · 확인 ${f.verifiedAt} — 개통 목표는 지연이 흔합니다 · 호재를 매수가에 선반영하지 마세요</div>
  </div>`;
}

function outroHtml(page: number, total: number): string {
  return `<style>${baseCss}</style><div class="card dark">
    ${brandBar(page, total)}
    <div style="margin-top:210px;text-align:center">
      <div style="font-size:64px;font-weight:800;line-height:1.4">매일 아침 06:00<br/>실거래·호가 자동 분석</div>
      <div style="font-size:36px;color:#94A3B8;margin-top:48px;line-height:1.7">국토부 실거래 수집 → 공개 지표 채점 → 랭킹<br/>사람 개입 없는 규칙 기반 파이프라인</div>
    </div>
    <div class="foot" style="text-align:center;line-height:1.7">본 콘텐츠는 공개 데이터 기반 정보 공유이며 투자 자문이 아닙니다.<br/>매수 결정 전 반드시 현장 확인·전문가 상담을 거치세요. · ${today}</div>
  </div>`;
}

interface SetOut { pages: string[]; names: string[]; picks: string[]; pickNos: string[]; caption: string }

/** 시리즈 2 — 호재·정책 브리핑: momentum-factors 확정/진행 상위 4건 + 정책 + 아웃트로 */
function buildBriefingSet(): SetOut {
  const factors = allFactors().filter((f) => f.certainty !== '구상').slice(0, 4);
  if (!factors.length) throw new Error('momentum-factors에 확정/진행 팩터가 없습니다');
  const total = factors.length + 3;
  const pages = [briefCoverHtml(factors.length, total)];
  const names = ['01-cover'];
  factors.forEach((f, i) => { pages.push(factorHtml(f, i + 2, total)); names.push(`0${i + 2}-factor-${f.id}`); });
  pages.push(policyHtml(factors.length + 2, total)); names.push(`0${factors.length + 2}-policy`);
  pages.push(outroHtml(total, total)); names.push(`0${factors.length + 3}-outro`);
  const capLines = factors.map((f, i) =>
    `${i + 1}. [${f.certainty}] ${f.title} — ${f.expected}\n   ${f.regions.map((r) => r.gu).join('·')} · 근거: ${f.sourceUrls[0]}`).join('\n');
  const caption = `🚧 이번 주 봐야 할 지역·호재 브리핑 (${today.replaceAll('-', '.')})

착공·승인 단계의 검증된 호재만 담았습니다(구상 단계 제외). 개통 목표는 공식 발표 기준이며 지연이 흔합니다 — 호재를 매수가에 선반영하지 마세요.

${capLines}

📊 원천: 정부·지자체 공식 발표 및 보도(항목별 근거 URL 표기) · 기준일 ${momentumAsOf()}

⚠️ 정보 공유이며 투자 자문이 아닙니다. 매수 결정 전 반드시 현장 확인·전문가 상담을 거치세요.

#부동산 #교통호재 #GTX #재개발 #부동산공부 #내집마련`;
  return { pages, names, picks: factors.map((f) => f.title), pickNos: [], caption };
}

/** 시리즈 1 — 금액대별 큐레이션(6억/8억): 기존 레이더 TOP5 파이프라인 */
async function buildPriceSet(prisma: PrismaClient): Promise<SetOut> {
  const since = new Date(Date.now() - 120 * 86_400_000);
  const [candidates, trades, rents] = await Promise.all([
    prisma.complexCandidate.findMany(),
    prisma.aptTrade.findMany({ where: { dealDate: { gte: since } }, select: { lawdCd: true, aptName: true, dealAmount: true, excluUseAr: true, dealDate: true } }),
    prisma.aptRent.findMany({ where: { dealDate: { gte: since }, monthlyRent: 0 }, select: { lawdCd: true, aptName: true, deposit: true } }),
  ]);
  const med = (a: number[]) => { a.sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
  // 정량 강화(2026-08-10): 평단가(만원/3.3㎡)·120일 전후반 추이 — "매물 선택" 판단축 추가
  const midMs = Date.now() - 60 * 86_400_000;
  const tKey = (lawdCd: string, name: string) => `${lawdCd}|${normName(name)}`;
  const tStats = new Map<string, { median: number; count: number; pyeong: number | null; trendPct: number | null }>();
  {
    const by = new Map<string, Array<{ amt: number; ar: number | null; ms: number }>>();
    for (const t of trades) { const k = tKey(t.lawdCd, t.aptName); (by.get(k) ?? by.set(k, []).get(k)!).push({ amt: t.dealAmount, ar: t.excluUseAr ?? null, ms: t.dealDate.getTime() }); }
    for (const [n, arr] of by) {
      const amounts = arr.map((x) => x.amt);
      const pyArr = arr.filter((x) => x.ar && x.ar > 0).map((x) => x.amt / (x.ar! / 3.3058));
      const older = arr.filter((x) => x.ms < midMs).map((x) => x.amt);
      const recent = arr.filter((x) => x.ms >= midMs).map((x) => x.amt);
      const trendPct = older.length >= 3 && recent.length >= 3 ? +(((med(recent) - med(older)) / med(older)) * 100).toFixed(1) : null;
      tStats.set(n, { median: med(amounts), count: arr.length, pyeong: pyArr.length ? Math.round(med(pyArr)) : null, trendPct });
    }
  }
  const jStats = new Map<string, number>();
  { const by = new Map<string, number[]>(); for (const r of rents) { const k = tKey(r.lawdCd, r.aptName); (by.get(k) ?? by.set(k, []).get(k)!).push(r.deposit); } for (const [n, a] of by) if (a.length >= 2) jStats.set(n, med(a)); }

  // 공유용 컷: 가격대 창(CAP_LABEL) · 300세대+ · 매매 매물 3건+
  const guCount = new Set(candidates.map((c) => c.gu)).size;
  const scanned = candidates.filter((c) => c.household >= MIN_HOUSEHOLD);
  let pool = scanned.filter((c) => c.minDealPrice != null && c.minDealPrice >= WINDOW.min && c.minDealPrice < WINDOW.max && c.dealArticles >= 3);

  // 반복 노출 방지(G2-3): 최근 COOLDOWN_DAYS일 내 등장 단지 제외 — 구세트는 pickNos 부재 시 이름으로 대체 매칭
  const cutoff = new Date(Date.now() - COOLDOWN_DAYS * 86_400_000).toISOString().slice(0, 10);
  const featured = new Set<string>();
  const featuredNames = new Set<string>();
  try {
    const idx = JSON.parse(readFileSync(join(process.cwd(), 'output', 'cardnews', 'index.json'), 'utf-8')) as Array<{ date: string; dir?: string; picks: string[]; pickNos?: string[] }>;
    for (const s of idx) {
      if (s.date < cutoff || (s.dir ?? s.date) === setDir) continue; // 오늘 같은 세트 재생성은 자기 자신을 제외하지 않음
      for (const no of s.pickNos ?? []) featured.add(no);
      if (!s.pickNos) for (const p of s.picks) featuredNames.add(p.replace(/\(\d+\)$/, ''));
    }
  } catch { /* 첫 생성 */ }
  const fresh = pool.filter((c) => !featured.has(c.complexNo) && !featuredNames.has(c.name));
  if (fresh.length >= 5) pool = fresh;
  else console.log(`  ⚠ 쿨다운 제외 후 ${fresh.length}곳뿐 — 다양성 완화(전체 풀 사용, 최근 등장 단지 재등장 허용)`);
  const picks: SharePick[] = pool.map((c) => {
    const lawd = GU_TO_LAWD[c.gu];
    const t = (lawd ? tStats.get(tKey(lawd, c.name)) : null) ?? null;
    const j = (lawd ? jStats.get(tKey(lawd, c.name)) : null) ?? null;
    const jr = j && t ? Math.round((j / t.median) * 100) : null;
    const gapPct = t && c.minDealPrice ? +(((c.minDealPrice - t.median) / t.median) * 100).toFixed(1) : null;
    const base = {
      name: c.name, gu: c.gu, dong: c.dong, complexNo: c.complexNo,
      household: c.household, elapsedYear: c.elapsedYear, far: c.far ?? null,
      minPrice: c.minDealPrice!, dealArticles: c.dealArticles,
      tradeMedian: t?.median ?? null, tradeCount: t?.count ?? 0,
      pyeongManwon: t?.pyeong ?? null, trendPct: t?.trendPct ?? null,
      jeonseMedian: j, jeonseRatioPct: jr, gapPct,
      listings: ((c.listings as unknown as Array<{ price: number; exclusiveArea: number | null; floor: string | null }>) ?? []),
    };
    const s = radarScore({ household: base.household, elapsedYear: base.elapsedYear, far: base.far, dealArticles: base.dealArticles, gapPct: base.gapPct, jeonseRatioPct: base.jeonseRatioPct, tradeCount: base.tradeCount });
    // 지역 호재(확정·진행만) — 정부·공식 발표 근거 URL 동반(momentum-factors)
    const mf = recoFactorsFor(c.gu, c.dong)[0];
    const factor = mf ? { certainty: mf.certainty, title: mf.title, expected: mf.expected, srcDomain: mf.sourceUrls[0] ? domainOf(mf.sourceUrls[0]) : '공식 발표' } : null;
    return { ...base, ...s, factor };
  });
  picks.sort((a, b) => b.score - a.score || (a.gapPct ?? 99) - (b.gapPct ?? 99));
  // 같은 동 도배 방지: 동별 최대 2곳. 백분위(상위 N%)는 통과 풀 전체 대비 순위 — 절대점수보다 직관적.
  const top: SharePick[] = [];
  const perDong: Record<string, number> = {};
  const perGu: Record<string, number> = {}; // 구·시별 최대 2 — 한 지역 도배 방지(마케팅 다양성, G2-3)
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i];
    const k = `${p.gu}|${p.dong}`;
    if ((perDong[k] ?? 0) >= 2 || (perGu[p.gu] ?? 0) >= 2) continue;
    perDong[k] = (perDong[k] ?? 0) + 1;
    perGu[p.gu] = (perGu[p.gu] ?? 0) + 1;
    p.topPct = Math.max(1, Math.ceil(((i + 1) / picks.length) * 100));
    p.poolSize = picks.length;
    top.push(p);
    if (top.length >= 5) break;
  }

  // 2026-08-10 개편: 자기홍보성 아웃트로 제거 → TOP5 정량 비교표(2p) + 정책 동향·전망(10p, 출처 동반) — "선택"을 위한 정보 밀도 우선
  const ctx = loadMarketCtx();
  const total = ctx ? 10 : 9;
  const pages: string[] = [coverHtml(scanned.length, pool.length, total, guCount)];
  const names: string[] = ['01-cover'];
  pages.push(compareHtml(top, 2, total)); names.push('02-compare');
  top.forEach((p, i) => { pages.push(itemHtml(p, i + 1, i + 3, total)); names.push(`0${i + 3}-pick${i + 1}`); });
  pages.push(methodHtml(8, total, pool.length, guCount)); names.push('08-method');
  pages.push(policyHtml(9, total)); names.push('09-policy');
  if (ctx) { pages.push(outlookHtml(ctx, 10, total)); names.push('10-outlook'); }

  // ── 인스타 캡션 v2(2026-08-11) — 훅 1줄 + 단지당 1줄 + CTA. 근거·출처 상세는 카드에 ──
  const hookOf = (p: SharePick): string => {
    if (p.gapPct != null && p.gapPct <= -3) return `실거래보다 ${Math.abs(p.gapPct).toFixed(0)}% 싸게 나옴`;
    if (p.trendPct != null && p.trendPct <= -3) return `최근 ${Math.abs(p.trendPct).toFixed(0)}% 조정 구간`;
    if (p.jeonseRatioPct != null && p.jeonseRatioPct >= 70) return `전세가율 ${p.jeonseRatioPct}% 실수요 탄탄`;
    if (p.tradeCount >= 15) return `120일 ${p.tradeCount}건 거래 활발`;
    return `현금 약 ${eok(fundingOf(p.minPrice).cash)}이면 시작`;
  };
  const capLines = top.map((p, i) => `${i + 1} ${p.name} ${eok(p.minPrice)} — ${hookOf(p)}`).join('\n');
  const caption = `${CAP_LABEL}로 내 집, 지금 볼만한 5곳 🏠 (${today.slice(5).replace('-', '.')})

${capLines}

💳 필요 현금·월 상환까지 카드에 계산해뒀어요
📌 저장했다가 임장 갈 때 꺼내보세요

국토부 실거래 × 네이버 호가 · 매일 자동 분석 · 출처는 카드 마지막 장 · 투자 자문 아님

#내집마련 #첫집 #${CAP_LABEL.replace(/[\s~]/g, '')}아파트 #아파트추천 #실거래가 #무주택자 #부동산공부 #신혼집`;

  return { pages, names, picks: top.map((p) => `${p.name}(${p.score})`), pickNos: top.map((p) => p.complexNo), caption };
}

(async () => {
  const prisma = new PrismaClient();
  const set = series === 'briefing' ? buildBriefingSet() : await buildPriceSet(prisma);

  mkdirSync(OUT_DIR, { recursive: true });
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const files: string[] = [];
  for (let i = 0; i < set.pages.length; i++) {
    await page.setContent(set.pages[i], { waitUntil: 'networkidle' });
    const file = `${set.names[i]}.png`;
    await page.screenshot({ path: join(OUT_DIR, file) });
    files.push(file);
    console.log(`  [${i + 1}/${set.pages.length}] ${file}`);
  }
  await browser.close();

  const indexPath = join(process.cwd(), 'output', 'cardnews', 'index.json');
  let idx: Array<{ date: string; series?: string; dir?: string; files: string[]; picks: string[]; pickNos?: string[]; caption?: string }> = [];
  try { idx = JSON.parse(readFileSync(indexPath, 'utf-8')); } catch { /* 첫 생성 */ }
  idx = idx.filter((s) => (s.dir ?? s.date) !== setDir);
  idx.unshift({ date: today, series, dir: setDir, files, picks: set.picks, pickNos: set.pickNos, caption: set.caption });
  const kept = idx.slice(0, 30);
  writeFileSync(indexPath, JSON.stringify(kept, null, 2));

  // 디스크 프루닝(2026-08-11) — index에서 밀려난 옛 세트 디렉토리 삭제(무한 누적 방지, ~2MB/세트)
  const keepDirs = new Set(kept.map((s) => s.dir ?? s.date));
  for (const d of readdirSync(join(process.cwd(), 'output', 'cardnews'), { withFileTypes: true })) {
    if (d.isDirectory() && /^\d{4}-\d{2}-\d{2}/.test(d.name) && !keepDirs.has(d.name)) {
      rmSync(join(process.cwd(), 'output', 'cardnews', d.name), { recursive: true, force: true });
      console.log(`  🗑 옛 세트 삭제: ${d.name}`);
    }
  }
  console.log(`카드뉴스 생성 완료 → output/cardnews/${setDir}/ (${files.length}장, 시리즈 ${series}) · ${set.picks.join(', ')}`);
  await prisma.$disconnect();
})();
