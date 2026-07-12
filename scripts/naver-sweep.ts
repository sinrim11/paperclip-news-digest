/**
 * scripts/naver-sweep.ts — 네이버 매물 전수 스윕 (최초 1회 후보 발굴)
 *
 * 목표: "내 예산 내 + 300세대 이상 + 관심지역" 아파트 후보를 전수 발굴.
 *   1) config/naver-sweep.json의 각 동을 region API로 열거 (세대수 내림차순)
 *      → type A01(아파트) & household >= min 만 채택, min 미만 나오면 그 동 조기 중단
 *   2) 채택 단지마다 매물 수확 → 매매(A1) 호가 <= 예산 상한 필터
 *   3) ComplexCandidate로 저장 (예산 내 매물 있는 단지만)
 *
 * 차단 회피: 단일 브라우저/컨텍스트(NNB 쿠키 유지), 단지 간 9s+지터,
 *   20단지마다 25s 휴지, 연속 실패 6회 시 중단.
 *
 * 실행: scripts/naver-sweep.sh  (env 로드)
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { chromium, type Page } from 'playwright';
import { harvestComplexArticles, isDealType, dealPriceManwon, repInfoOf } from '../src/lib/collectors/naver-land';

const prisma = new PrismaClient();
const UA_PC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

interface SweepConfig {
  budgetCeilingManwon: number;
  minHousehold: number;
  minExclusiveAreaM2?: number;
  perComplexDelayMs: number;
  enumDelayMs: number;
  longPauseEvery: number;
  longPauseMs: number;
  dongs?: Array<{ gu: string; dong: string; code: string }>;
  dongMapFile?: string;
  dongMapFiles?: string[]; // 복수 맵(서울+경기, 1-B-iii) — dongMapFile보다 우선
  targetGus?: string[];
  groups?: Record<string, string[]>; // 요일 분할 그룹(1-B-ii) — --group=sun|wed
}

type DongEntry = { gu: string; dong: string; code: string };

/**
 * 대상 구의 모든 법정동을 검증된 코드 맵에서 로드.
 * config.dongs(하드코딩)가 있으면 그것을 우선 사용(back-compat).
 * groupName이 있으면 cfg.groups[groupName](요일 분할, 1-B-ii), 없으면 targetGus.
 * dongMapFile 전개로 대림동 코드 오류류의 조용한 누락 방지.
 */
function resolveDongs(cfg: SweepConfig, groupName?: string): DongEntry[] {
  if (cfg.dongs && cfg.dongs.length) return cfg.dongs;
  let gus = cfg.targetGus;
  if (groupName) {
    const g = cfg.groups?.[groupName];
    if (!g?.length) throw new Error(`config.groups에 없는 그룹: ${groupName}`);
    gus = g;
  }
  const mapFiles = cfg.dongMapFiles?.length ? cfg.dongMapFiles : cfg.dongMapFile ? [cfg.dongMapFile] : [];
  if (!mapFiles.length || !gus?.length) {
    throw new Error('config에 dongs 또는 (dongMapFile(s) + targetGus/groups)가 필요합니다');
  }
  // 모든 도(province)를 병합해 구/시 → 동 → 코드 평탄화 (서울 외 지역 지원, 1-B-iii)
  const byGu: Record<string, Record<string, string>> = {};
  for (const file of mapFiles) {
    const raw = JSON.parse(readFileSync(join(process.cwd(), file), 'utf-8')) as Record<string, Record<string, Record<string, string>> | string>;
    for (const [k, province] of Object.entries(raw)) {
      if (k.startsWith('_') || typeof province === 'string') continue;
      for (const [gu, dongs] of Object.entries(province)) byGu[gu] = { ...byGu[gu], ...dongs };
    }
  }
  const out: DongEntry[] = [];
  for (const gu of gus) {
    const dongs = byGu[gu];
    if (!dongs) {
      console.error(`[sweep] ⚠ 맵에 없는 구: ${gu}`);
      continue;
    }
    for (const [dong, code] of Object.entries(dongs)) out.push({ gu, dong, code });
  }
  return out;
}

interface ComplexInfo {
  complexNumber: number;
  name: string;
  type: string;
  totalHouseholdNumber: number;
  useApprovalDate?: string;
  approvalElapsedYear?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (base: number) => base + Math.floor(Math.random() * 2500);

function loadConfig(): SweepConfig {
  return JSON.parse(readFileSync(join(process.cwd(), 'config', 'naver-sweep.json'), 'utf-8')) as SweepConfig;
}

/**
 * 한 동을 region API로 열거 — household>=min & type A01.
 * 직접 요청은 429로 차단되고 SPA 자체 요청만 route로 가로챌 수 있음.
 * region API는 세대수 내림차순 정렬 → 300세대+ 단지는 전부 첫 페이지(상위 30개)에 포함
 * (검증: 봉천 15/신림 16 모두 30개 이내). 따라서 SPA가 로드하는 page 0 캡처로 충분.
 */
async function enumerateDong(page: Page, code: string, minHousehold: number): Promise<ComplexInfo[]> {
  const si = code.slice(0, 2) + '00000000'; // 시도 코드 파생(서울 11·경기 41) — 1-B-iii에서 하드코딩 제거
  // 구·군 코드는 앞 5자리(11XXX/41XXX). 4자리 절단 시 5번째 자리가 0이 아닌 광진(11215)·강북(11305)·금천(11545)이 잘못된 gun으로 조용히 0단지가 됨.
  const gun = code.slice(0, 5) + '00000';
  const captured: string[] = [];
  const pattern = '**/front-api/v1/complex/region**';
  const handler = async (route: import('playwright').Route) => {
    try {
      const r = await route.fetch();
      const t = await r.text();
      if (route.request().url().includes(code)) captured.push(t);
      await route.fulfill({ response: r, body: t });
    } catch {
      await route.continue().catch(() => {});
    }
  };
  await page.route(pattern, handler);
  try {
    await page
      .goto(`https://fin.land.naver.com/regions?si=${si}&gun=${gun}&eup=${code}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      })
      .catch(() => {});
    await sleep(6000); // SPA가 region page 0 을 부를 시간
  } finally {
    await page.unroute(pattern).catch(() => {});
  }

  const byNo = new Map<number, ComplexInfo>();
  for (const text of captured) {
    try {
      const j = JSON.parse(text) as { result?: { list?: Array<{ complexInfo: ComplexInfo }> } };
      for (const x of j?.result?.list ?? []) {
        const c = x.complexInfo;
        if (c && c.type === 'A01' && (c.totalHouseholdNumber ?? 0) >= minHousehold) byNo.set(c.complexNumber, c);
      }
    } catch {
      /* skip */
    }
  }
  return [...byNo.values()];
}

interface AffordableListing {
  price: number; // 만원
  exclusiveArea: number | null;
  floor: string | null;
  dong: string | null;
  name: string | null;
  confirmDate: string | null; // 매물 확인/등록일(YYYY-MM-DD)
  direction: string | null; // 향 코드(E/W/S/N 조합)
  articleNo: number | null; // 네이버 매물 번호 — fin.land.naver.com/articles/{articleNo} 딥링크용
}

function extractAffordable(articles: unknown[], ceiling: number, minArea: number): { deals: AffordableListing[]; dealCount: number; min: number | null; max: number | null } {
  const dealPrices: number[] = [];
  const affordable: AffordableListing[] = [];
  for (const a of articles) {
    const rep = repInfoOf(a);
    if (!isDealType(rep)) continue;
    const price = dealPriceManwon(a);
    if (price === null) continue;
    const space = (rep as { spaceInfo?: { exclusiveSpace?: number } }).spaceInfo?.exclusiveSpace ?? null;
    // 면적 요건: 전용 minArea㎡ 이상만. 면적 미상은 제외(소형 혼입 방지). min/max·매물수도 이 기준으로 일관 계산.
    if (minArea > 0 && (space === null || space < minArea)) continue;
    dealPrices.push(price);
    if (price <= ceiling) {
      const detail = (rep as { articleDetail?: { floorInfo?: string; direction?: string } }).articleDetail;
      const floor = detail?.floorInfo ?? (rep as { floorInfo?: string }).floorInfo ?? null;
      const confirmDate = (rep as { verificationInfo?: { articleConfirmDate?: string } }).verificationInfo?.articleConfirmDate ?? null;
      affordable.push({
        price,
        exclusiveArea: space,
        floor: floor as string | null,
        dong: (rep as { dongName?: string }).dongName ?? null,
        name: (rep as { articleName?: string }).articleName ?? null,
        confirmDate,
        direction: detail?.direction ?? null,
        articleNo: (rep as { articleNumber?: number }).articleNumber ?? null,
      });
    }
  }
  affordable.sort((a, b) => a.price - b.price);
  return {
    deals: affordable,
    dealCount: dealPrices.length,
    min: dealPrices.length ? Math.min(...dealPrices) : null,
    max: dealPrices.length ? Math.max(...dealPrices) : null,
  };
}

async function main() {
  const cfg = loadConfig();
  const ceiling = cfg.budgetCeilingManwon;
  const minArea = cfg.minExclusiveAreaM2 ?? 0;
  const groupArg = process.argv.find((a) => a.startsWith('--group='))?.slice('--group='.length);
  const dongList = resolveDongs(cfg, groupArg);
  console.log(`[sweep] start — 예산상한 ${(ceiling / 10000).toFixed(1)}억, 최소 ${cfg.minHousehold}세대, 전용 ${minArea}㎡+, ${dongList.length}개 동${groupArg ? ` (그룹 ${groupArg})` : ''}`);
  if (process.argv.includes('--plan')) {
    const byGu = new Map<string, number>();
    for (const d of dongList) byGu.set(d.gu, (byGu.get(d.gu) ?? 0) + 1);
    for (const [gu, n] of byGu) console.log(`[sweep]   ${gu}: ${n}개 동`);
    console.log('[sweep] --plan — 열거만 하고 종료(네트워크 접근 없음)');
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA_PC, locale: 'ko-KR', viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(`() => {
    Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
    Object.defineProperty(navigator,'languages',{get:()=>['ko-KR','ko']});
    window.chrome = window.chrome || { runtime: {} };
  }`);
  const page = await ctx.newPage();
  await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await sleep(1500);

  // 1) 동별 열거 → minHousehold+ 아파트 후보
  const candidates: Array<ComplexInfo & { gu: string; dong: string }> = [];
  let zeroDongs = 0;
  let cappedDongs = 0;
  for (const d of dongList) {
    try {
      const found = await enumerateDong(page, d.code, cfg.minHousehold);
      for (const c of found) candidates.push({ ...c, gu: d.gu, dong: d.dong });
      if (found.length === 0) zeroDongs++;
      // region API는 세대수 내림차순 page 0(상위 ~30)만 캡처 → 30 근접 시 하위 소단지 누락 가능(150세대 기준)
      if (found.length >= 30) {
        cappedDongs++;
        console.log(`[sweep] 열거 ${d.gu} ${d.dong}: ${found.length}단지 ⚠상한(page0) — 하위 소단지 누락 가능`);
      } else {
        console.log(`[sweep] 열거 ${d.gu} ${d.dong}: ${found.length}단지(${cfg.minHousehold}세대+)`);
      }
    } catch (err) {
      console.error(`[sweep] 열거 실패 ${d.dong}:`, err);
    }
    await sleep(jitter(cfg.enumDelayMs));
  }
  console.log(`[sweep] 열거 요약 — ${dongList.length}개 동 중 0단지 ${zeroDongs}개 / page0 상한 근접 ${cappedDongs}개`);
  // 구 단위 전멸 감지 — 잘못된 지역코드·차단은 개별 동 0이 아니라 구 전체 0으로 나타남(광진·강북·금천 gun 절단 버그의 관측 신호)
  const targetGuSet = new Set(dongList.map((d) => d.gu));
  const foundGuSet = new Set(candidates.map((c) => c.gu));
  for (const gu of targetGuSet) {
    if (!foundGuSet.has(gu)) console.error(`[sweep] ⚠ ${gu}: 전 동 0단지 — 지역코드 오류/차단 의심, 확인 필요`);
  }
  // 중복 제거(동 경계 단지)
  const uniq = new Map<number, (typeof candidates)[0]>();
  for (const c of candidates) if (!uniq.has(c.complexNumber)) uniq.set(c.complexNumber, c);
  const targets = [...uniq.values()].sort((a, b) => b.totalHouseholdNumber - a.totalHouseholdNumber);
  console.log(`[sweep] 총 후보 단지: ${targets.length}개 → 매물 수집 시작`);

  // 2) 단지별 매물 수집 + 예산 필터
  let saved = 0;
  let consecFail = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    try {
      const { articles } = await harvestComplexArticles(page, String(t.complexNumber));
      if (articles.length === 0) {
        consecFail++;
        if (consecFail >= 6) {
          console.error('[sweep] 연속 6회 매물 수집 실패 — 차단 의심, 중단');
          break;
        }
      } else {
        consecFail = 0;
      }
      const { deals, dealCount, min, max } = extractAffordable(articles, ceiling, minArea);

      if (deals.length > 0) {
        await prisma.complexCandidate.upsert({
          where: { complexNo: String(t.complexNumber) },
          create: {
            complexNo: String(t.complexNumber),
            name: t.name,
            gu: t.gu,
            dong: t.dong,
            household: t.totalHouseholdNumber,
            elapsedYear: t.approvalElapsedYear ?? null,
            approvalDate: t.useApprovalDate ?? null,
            totalArticles: articles.length,
            dealArticles: dealCount,
            inBudgetCount: deals.length,
            minDealPrice: min,
            maxDealPrice: max,
            budgetCeiling: ceiling,
            listings: JSON.parse(JSON.stringify(deals.slice(0, 20))),
          },
          update: {
            household: t.totalHouseholdNumber,
            totalArticles: articles.length,
            dealArticles: dealCount,
            inBudgetCount: deals.length,
            minDealPrice: min,
            maxDealPrice: max,
            budgetCeiling: ceiling,
            listings: JSON.parse(JSON.stringify(deals.slice(0, 20))),
            sweptAt: new Date(),
          },
        });
        saved++;
        console.log(`[sweep] ✓ ${t.gu} ${t.dong} ${t.name}(${t.totalHouseholdNumber}세대): 예산내 ${deals.length}건, 최저 ${(min! / 10000).toFixed(1)}억 [${i + 1}/${targets.length}]`);
      } else {
        console.log(`[sweep] – ${t.gu} ${t.dong} ${t.name}: 예산내 매물 없음(최저 ${min ? (min / 10000).toFixed(1) + '억' : '매물0'}) [${i + 1}/${targets.length}]`);
      }
    } catch (err) {
      console.error(`[sweep] ${t.name} 수집 오류:`, err);
      consecFail++;
      if (consecFail >= 6) break;
    }
    await sleep(jitter(cfg.perComplexDelayMs));
    if ((i + 1) % cfg.longPauseEvery === 0) {
      console.log(`[sweep] ${i + 1}단지 처리 — ${(cfg.longPauseMs / 1000).toFixed(0)}s 휴지`);
      await sleep(cfg.longPauseMs);
    }
  }

  await browser.close();
  console.log(`[sweep] 완료 — 예산 내 매물 있는 단지 ${saved}개 저장`);
}

main()
  .catch((err) => {
    console.error('[sweep] fatal:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
