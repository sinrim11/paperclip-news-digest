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
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { radarScore, RADAR_PART_META } from '../src/lib/radar-score';
import { allFactors, momentumAsOf, type MomentumFactor } from '../src/lib/momentum';

const W = 1080, H = 1350;
const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

/**
 * 시리즈(3-A): --series=price6(기본)|price8|briefing
 *  - price6/price8: 금액대별 큐레이션(공개 가격대 컷 6억/8억 — 요일 로테이션은 gen-cardnews.sh)
 *  - briefing: 호재·정책 브리핑(momentum-factors 확정/진행 + 정책 카드, 전 항목 출처 표기)
 *  - 10억 시리즈는 보류 — 스윕 상한(9.2억) 상향 선행 필요(Phase 0 판정)
 */
type Series = 'price6' | 'price8' | 'briefing';
const series: Series = (process.argv.find((a) => a.startsWith('--series='))?.slice('--series='.length) as Series) ?? 'price6';
if (!['price6', 'price8', 'briefing'].includes(series)) throw new Error(`알 수 없는 시리즈: ${series}`);
const DIR_SUFFIX: Record<Series, string> = { price6: '', price8: '-p8', briefing: '-brief' };
const setDir = today + DIR_SUFFIX[series];
const OUT_DIR = join(process.cwd(), 'output', 'cardnews', setDir);

/** 공개 프레임 — 개인 예산이 아닌 카드 명시용 가격대 컷 */
const PRICE_CAP = series === 'price8' ? 80000 : 60000; // 만원
const CAP_LABEL = series === 'price8' ? '8억 이하' : '6억 이하';
const MIN_HOUSEHOLD = 300;

/* ── 공유용 객관 지표·레이더 지수 ── */
interface SharePick {
  name: string; gu: string; dong: string; complexNo: string;
  household: number; elapsedYear: number | null;
  far: number | null; // 용적률 % — 재건축 사업성(낮을수록 유리)
  minPrice: number; dealArticles: number;
  tradeMedian: number | null; tradeCount: number;
  jeonseMedian: number | null; jeonseRatioPct: number | null;
  gapPct: number | null; // (호가-실거래)/실거래
  score: number; parts: { gap: number; liq: number; fresh: number; jeonse: number };
  facts: string[]; // 수치 기반 객관 서술
  listings: Array<{ price: number; exclusiveArea: number | null; floor: string | null }>;
}

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
      <div style="font-size:96px;font-weight:800;line-height:1.18;margin-top:26px">서울 <span style="color:#60A5FA">${CAP_LABEL}</span><br/>아파트 레이더 TOP 5</div>
      <div style="font-size:34px;color:#CBD5E1;margin-top:42px;line-height:1.65">수집권 ${guCount}개 구·시 · 300세대+ <b style="color:#fff">${scanned.toLocaleString()}곳 전수 스캔</b> → 통과 ${passed.toLocaleString()}곳<br/>실거래 갭 · 거래량 · 전세가율 · 연식/용적률, <b style="color:#fff">공개 데이터 지표</b>로만 채점</div>
    </div>
    <div style="margin-top:auto;display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:27px;color:#64748B">국토교통부 실거래가 × 네이버부동산 호가 · 특정인 예산 기준 아님</div>
      <div style="font-size:34px;color:#60A5FA;font-weight:700">→</div>
    </div>
  </div>`;
}

function scoreBarHtml(parts: SharePick['parts'], score: number): string {
  const segs = RADAR_PART_META.map((m) => {
    const v = parts[m.key as keyof SharePick['parts']];
    const fill = (v / m.max) * 100;
    return `<div style="width:${m.max}%;height:100%;background:#E2E8F0;position:relative;border-right:3px solid #fff"><div style="position:absolute;left:0;top:0;bottom:0;width:${fill}%;background:${m.color}"></div></div>`;
  }).join('');
  const labels = RADAR_PART_META.map((m) => `<span style="white-space:nowrap"><span style="display:inline-block;width:15px;height:15px;border-radius:4px;background:${m.color};margin-right:7px;vertical-align:-1px"></span>${m.label} <b class="num">${parts[m.key as keyof SharePick['parts']]}</b><span style="color:#CBD5E1">/${m.max}</span></span>`).join('');
  return `
    <div style="display:flex;align-items:baseline;gap:14px"><span style="font-size:26px;font-weight:700;color:#94A3B8">레이더 지수</span><span class="num" style="font-size:28px;font-weight:800;color:#0F172A">${score}<span style="color:#94A3B8;font-weight:600">/100</span></span><span style="font-size:22px;color:#CBD5E1">— 공개 데이터 4지표</span></div>
    <div style="display:flex;height:22px;border-radius:8px;overflow:hidden;margin-top:12px">${segs}</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px 22px;font-size:22px;color:#64748B;margin-top:12px">${labels}</div>`;
}

function itemHtml(p: SharePick, rank: number, page: number, total: number): string {
  const gapColor = p.gapPct == null ? '#94A3B8' : p.gapPct <= 2 ? '#16A34A' : p.gapPct > 10 ? '#DC2626' : '#B45309';
  const facts = p.facts.slice(0, 2).map((x) => `<div style="display:flex;gap:14px;font-size:30px;line-height:1.45;color:#334155"><span style="color:#16A34A;font-weight:800">✓</span><span>${x}</span></div>`).join('');
  const chips = p.listings.slice(0, 3).map((l) => `<span class="chip num" style="background:#F1F5F9;color:#334155;font-size:25px;font-weight:600">${eok(l.price)}${l.exclusiveArea ? ` · ${Math.round(l.exclusiveArea)}㎡` : ''}${l.floor ? ` · ${l.floor}` : ''}</span>`).join(' ');
  return `<style>${baseCss}</style><div class="card">
    ${brandBar(page, total)}
    <div style="margin-top:56px;display:flex;align-items:center;gap:22px">
      <div class="num" style="font-size:50px;font-weight:800;color:#CBD5E1">${rank}</div>
      <span class="chip num" style="background:#0F172A;color:#fff;font-size:30px">레이더 ${p.score}점</span>
    </div>
    <div style="font-size:76px;font-weight:800;letter-spacing:-0.02em;margin-top:20px;line-height:1.15">${p.name}</div>
    <div style="font-size:31px;color:#64748B;margin-top:14px">${p.gu} ${p.dong} · ${p.household.toLocaleString()}세대${p.elapsedYear != null ? ` · ${p.elapsedYear}년차` : ''}${p.far != null ? ` · 용적률 <b style="color:${p.far <= 180 ? '#16A34A' : '#64748B'}">${Math.round(p.far)}%</b>` : ''}</div>

    <div style="display:flex;gap:36px;margin-top:44px;align-items:flex-end">
      <div style="flex:1">
        <div style="font-size:27px;color:#94A3B8;font-weight:700">최저 호가</div>
        <div class="num" style="font-size:88px;font-weight:800;color:#2563EB;line-height:1.1;margin-top:4px">${eok(p.minPrice)}</div>
      </div>
      <div style="flex:1">
        ${p.tradeMedian
          ? `<div style="font-size:27px;color:#94A3B8;font-weight:700">실거래 중간 <span style="color:#CBD5E1">(120일·${p.tradeCount}건)</span></div>
             <div class="num" style="font-size:60px;font-weight:800;color:#0F172A;line-height:1.15;margin-top:6px">${eok(p.tradeMedian)}</div>
             <div class="num" style="font-size:25px;font-weight:700;margin-top:6px;color:${gapColor}">호가 ${p.gapPct! >= 0 ? '+' : ''}${p.gapPct!.toFixed(1)}%</div>`
          : `<div style="font-size:27px;color:#94A3B8;font-weight:700">실거래</div><div style="font-size:36px;color:#CBD5E1;font-weight:700;margin-top:12px">120일 표본 없음</div>`}
      </div>
    </div>

    <div style="display:flex;gap:18px;margin-top:36px">
      <div class="stat" style="flex:1"><div class="k">전세 중간 · 전세가율</div><div class="v num" style="color:#7C3AED">${p.jeonseMedian ? `${eok(p.jeonseMedian)} · ${p.jeonseRatioPct}%` : '표본 없음'}</div><div class="s">전세 수요·방어력</div></div>
      <div class="stat" style="flex:1"><div class="k">120일 매매 거래</div><div class="v num">${p.tradeCount}건</div><div class="s">환금성의 실체</div></div>
      <div class="stat" style="flex:1"><div class="k">매매 매물</div><div class="v num">${p.dealArticles}건</div><div class="s">선택지·협상 여지</div></div>
    </div>

    <div style="margin-top:32px;padding:28px 32px;background:#F8FAFC;border-radius:20px">${scoreBarHtml(p.parts, p.score)}</div>
    <div style="margin-top:28px;display:flex;flex-direction:column;gap:12px">${facts}</div>
    <div style="margin-top:24px;display:flex;flex-wrap:wrap;gap:12px">${chips}</div>
    <div class="foot">서울 ${CAP_LABEL} · 300세대+ 전수 스캔 — 국토부 실거래 × 네이버 호가 · 투자 자문 아님 · 현장 확인 필수</div>
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

function factorHtml(f: MomentumFactor, page: number, total: number): string {
  const badge = f.certainty === '확정' ? ['#16A34A', '확정 — 착공·개통일 확정'] : ['#F59E0B', '진행 — 승인·부분 착공'];
  const regions = f.regions.map((r) => r.gu).join(' · ');
  const srcs = f.sourceUrls.map((s) => s.replace(/^https?:\/\//, '').split('/')[0]).join(' · ');
  return `<style>${baseCss}</style><div class="card">
    ${brandBar(page, total)}
    <div style="margin-top:70px">
      <span class="chip" style="background:${badge[0]};color:#fff;font-size:28px">${badge[1]}</span>
    </div>
    <div style="font-size:64px;font-weight:800;letter-spacing:-0.02em;margin-top:30px;line-height:1.25">${f.title}</div>
    <div class="num" style="font-size:36px;font-weight:700;color:#2563EB;margin-top:24px">${f.expected}</div>
    <div style="font-size:32px;color:#334155;margin-top:36px;line-height:1.65">${f.detail}</div>
    <div class="stat" style="margin-top:40px"><div class="k">영향 지역</div><div style="font-size:34px;font-weight:700;margin-top:8px">${regions}</div></div>
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

interface SetOut { pages: string[]; names: string[]; picks: string[]; caption: string }

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
  return { pages, names, picks: factors.map((f) => f.title), caption };
}

/** 시리즈 1 — 금액대별 큐레이션(6억/8억): 기존 레이더 TOP5 파이프라인 */
async function buildPriceSet(prisma: PrismaClient): Promise<SetOut> {
  const since = new Date(Date.now() - 120 * 86_400_000);
  const [candidates, trades, rents] = await Promise.all([
    prisma.complexCandidate.findMany(),
    prisma.aptTrade.findMany({ where: { dealDate: { gte: since } }, select: { aptName: true, dealAmount: true } }),
    prisma.aptRent.findMany({ where: { dealDate: { gte: since }, monthlyRent: 0 }, select: { aptName: true, deposit: true } }),
  ]);
  const med = (a: number[]) => { a.sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
  const tStats = new Map<string, { median: number; count: number }>();
  { const by = new Map<string, number[]>(); for (const t of trades) { (by.get(t.aptName) ?? by.set(t.aptName, []).get(t.aptName)!).push(t.dealAmount); } for (const [n, a] of by) tStats.set(n, { median: med(a), count: a.length }); }
  const jStats = new Map<string, number>();
  { const by = new Map<string, number[]>(); for (const r of rents) { (by.get(r.aptName) ?? by.set(r.aptName, []).get(r.aptName)!).push(r.deposit); } for (const [n, a] of by) if (a.length >= 2) jStats.set(n, med(a)); }

  // 공유용 컷: 가격대(CAP_LABEL) · 300세대+ · 매매 매물 3건+
  const guCount = new Set(candidates.map((c) => c.gu)).size;
  const scanned = candidates.filter((c) => c.household >= MIN_HOUSEHOLD);
  const pool = scanned.filter((c) => c.minDealPrice != null && c.minDealPrice <= PRICE_CAP && c.dealArticles >= 3);
  const picks: SharePick[] = pool.map((c) => {
    const t = tStats.get(c.name) ?? null;
    const j = jStats.get(c.name) ?? null;
    const jr = j && t ? Math.round((j / t.median) * 100) : null;
    const gapPct = t && c.minDealPrice ? +(((c.minDealPrice - t.median) / t.median) * 100).toFixed(1) : null;
    const base = {
      name: c.name, gu: c.gu, dong: c.dong, complexNo: c.complexNo,
      household: c.household, elapsedYear: c.elapsedYear, far: c.far ?? null,
      minPrice: c.minDealPrice!, dealArticles: c.dealArticles,
      tradeMedian: t?.median ?? null, tradeCount: t?.count ?? 0,
      jeonseMedian: j, jeonseRatioPct: jr, gapPct,
      listings: ((c.listings as unknown as Array<{ price: number; exclusiveArea: number | null; floor: string | null }>) ?? []),
    };
    const s = radarScore({ household: base.household, elapsedYear: base.elapsedYear, far: base.far, dealArticles: base.dealArticles, gapPct: base.gapPct, jeonseRatioPct: base.jeonseRatioPct, tradeCount: base.tradeCount });
    return { ...base, ...s };
  });
  picks.sort((a, b) => b.score - a.score || (a.gapPct ?? 99) - (b.gapPct ?? 99));
  // 같은 동 도배 방지: 동별 최대 2곳
  const top: SharePick[] = [];
  const perDong: Record<string, number> = {};
  for (const p of picks) { const k = `${p.gu}|${p.dong}`; if ((perDong[k] ?? 0) >= 2) continue; perDong[k] = (perDong[k] ?? 0) + 1; top.push(p); if (top.length >= 5) break; }

  const total = 9;
  const pages: string[] = [coverHtml(scanned.length, pool.length, total, guCount)];
  const names: string[] = ['01-cover'];
  top.forEach((p, i) => { pages.push(itemHtml(p, i + 1, i + 2, total)); names.push(`0${i + 2}-pick${i + 1}`); });
  pages.push(methodHtml(7, total, pool.length, guCount)); names.push('07-method');
  pages.push(policyHtml(8, total)); names.push('08-policy');
  pages.push(outroHtml(9, total)); names.push('09-outro');

  // ── 인스타 캡션 — 카드와 동일 데이터·수치 중심 ──
  const capLines = top.map((p, i) =>
    `${i + 1}. ${p.name} (${p.gu} ${p.dong}) — 호가 ${eok(p.minPrice)}${p.tradeMedian ? ` · 실거래 ${eok(p.tradeMedian)}(${p.tradeCount}건, 갭 ${p.gapPct! >= 0 ? '+' : ''}${p.gapPct}%)` : ''}${p.jeonseRatioPct ? ` · 전세가율 ${p.jeonseRatioPct}%` : ''} · 지수 ${p.score}`).join('\n');
  const caption = `🏠 서울 ${CAP_LABEL} 아파트 레이더 TOP 5 (${today.replaceAll('-', '.')})

수집권 ${guCount}개 구·시의 300세대 이상 ${scanned.length.toLocaleString()}개 단지를 전수 스캔해 공개 데이터 지표(실거래 갭 40 · 유동성 30 · 연식/용적률 15 · 전세가율 15)로만 채점했습니다. 특정인의 예산·취향 기준이 아니며, 가격대 컷(${CAP_LABEL}) 밖 단지는 포함되지 않습니다.

${capLines}

📊 원천: 국토교통부 실거래가(공공) × 네이버부동산 호가 — 매일 같은 규칙으로 자동 채점.

⚠️ 정보 공유이며 투자 자문이 아닙니다. 매수 전 반드시 현장 확인·전문가 상담을 거치세요.

#부동산 #아파트 #내집마련 #서울아파트 #${CAP_LABEL.replace(' ', '')} #실거래가 #부동산데이터 #재테크 #부동산공부 #무주택자`;

  return { pages, names, picks: top.map((p) => `${p.name}(${p.score})`), caption };
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
  let idx: Array<{ date: string; series?: string; dir?: string; files: string[]; picks: string[]; caption?: string }> = [];
  try { idx = JSON.parse(readFileSync(indexPath, 'utf-8')); } catch { /* 첫 생성 */ }
  idx = idx.filter((s) => (s.dir ?? s.date) !== setDir);
  idx.unshift({ date: today, series, dir: setDir, files, picks: set.picks, caption: set.caption });
  writeFileSync(indexPath, JSON.stringify(idx.slice(0, 30), null, 2));
  console.log(`카드뉴스 생성 완료 → output/cardnews/${setDir}/ (${files.length}장, 시리즈 ${series}) · ${set.picks.join(', ')}`);
  await prisma.$disconnect();
})();
