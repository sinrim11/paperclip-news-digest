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

/** new.land /api/regions/complexes 응답 원소 (2026-08-30 프로브로 필드 확인). */
interface NewLandComplex {
  complexNo: string;
  complexName: string;
  realEstateTypeCode: string; // 'APT' | 'ABYG'(아파트분양권) | 'JGC'(재건축) …
  totalHouseholdCount?: number;
  useApproveYmd?: string; // 'YYYYMMDD'
  latitude?: number;
  longitude?: number;
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
 * 한 동의 아파트를 열거 — new.land `/api/regions/complexes`.
 *
 * 2026-08-20부터 11일간 전 동이 0단지로 끝났다(2026-08-30 프로브로 원인 확정).
 * 종전 방식은 fin.land SPA(`/regions?si&gun&eup`)를 열고 그 내부 요청
 * `front-api/v1/complex/region`을 가로채는 것이었는데, 네이버가 그 경로를 폐지했다.
 * 지금 딥링크는 429가 아니라 200으로 `financial.pstatic.net/404.html`에 떨어지고
 * SPA는 auth 계열만 호출한다 — 차단이 아니라 라우팅 변경이라 재시도로는 복구되지 않는다.
 *
 * 대체 API는 이미 이 저장소가 쓰던 것이다(backfill-coords·backfill-far). 같은 IP에서
 * 정상 응답하며 필요한 필드를 직접 준다 — SPA 가로채기라는 간접 경로가 사라진 게 오히려 낫다.
 * 부수 효과: 종전엔 SPA가 로드하는 page 0(상위 30개)만 잡혔는데 이 API는 동 전체를 준다.
 */
interface DongResult {
  complexes: ComplexInfo[];
  apiOk: boolean; // false = HTTP 오류(차단 의심)
  rawCount: number; // 필터 전 단지 수 — 0이면 그 동에 등록 아파트가 없다는 뜻
}

async function enumerateDong(page: Page, code: string, minHousehold: number): Promise<DongResult> {
  const res = await page.evaluate(async (cortarNo: string) => {
    const r = await fetch(`/api/regions/complexes?cortarNo=${cortarNo}&realEstateType=APT:ABYG:JGC&order=`, {
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) return { ok: false as const, status: r.status };
    return { ok: true as const, list: ((await r.json())?.complexList ?? []) as NewLandComplex[] };
  }, code);

  if (!res.ok) {
    // 상태를 삼키면 "0단지"와 "차단"이 같은 모양이 된다 — 11일 실패가 정확히 그랬다.
    console.error(`  · 동 ${code}: HTTP ${res.status}`);
    return { complexes: [], apiOk: false, rawCount: 0 };
  }

  const out: ComplexInfo[] = [];
  for (const c of res.list) {
    if (c.realEstateTypeCode !== 'APT') continue;
    if ((c.totalHouseholdCount ?? 0) < minHousehold) continue;
    const ymd = c.useApproveYmd ?? null; // 'YYYYMMDD'
    out.push({
      complexNumber: Number(c.complexNo),
      name: c.complexName,
      type: 'A01',
      totalHouseholdNumber: c.totalHouseholdCount ?? 0,
      useApprovalDate: ymd ?? undefined,
      approvalElapsedYear: ymd ? new Date().getFullYear() - Number(ymd.slice(0, 4)) : undefined,
    });
  }
  return { complexes: out, apiOk: true, rawCount: res.list.length };
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
  // 점유 상태(2026-09-12) — 실입주 목적 매수자에게는 '언제 들어갈 수 있나'가 가격만큼 중요하다.
  // 네이버는 이걸 구조화 필드로 주지 않고 중개사 설명 텍스트에만 담는다.
  occupancy: 'vacant' | 'tenant' | 'owner' | 'negotiable' | null; // 즉시입주 / 세입자 / 집주인 / 협의 / 미상
  feature: string | null; // 중개사 설명 원문(앞 60자) — 분류 근거를 사람이 확인할 수 있게
  hugSafeLessor: boolean | null; // HUG 안심임대인 등록 여부(전세 낀 매물의 보증금 안전 참고)
}

/**
 * 점유 상태 분류 — 중개사 설명의 관용 표현에서 읽는다.
 * 구조화 데이터가 아니므로 **명확한 표현만** 잡고 나머지는 null(미상)로 둔다.
 * 틀린 점유 상태는 미상보다 나쁘다 — "즉시입주"인 줄 알고 갔다가 세입자 만기가 1년 남았으면
 * 계약 자체가 틀어진다.
 */
function classifyOccupancy(desc: string | null): AffordableListing['occupancy'] {
  if (!desc) return null;
  const d = desc.replace(/\s/g, '');
  // 부정형이 섞이면 판단하지 않는다("즉시입주불가", "세안고아님")
  if (/(즉시입주|입주)(불가|어려움)/.test(d)) return null;
  if (/(세|전세|월세)(안고|낀)|임대중|세입자|만기|계약기간/.test(d)) return 'tenant';
  if (/주인거주|집주인거주|자가거주/.test(d)) return 'owner';
  if (/즉시입주|즉시계약|공실|입주매물|빈집/.test(d)) return 'vacant';
  // '입주협의'(2026-09-13) — 첫 수집에서 미상 5,467건 중 1,223건이 이 표현이었다.
  // 점유자가 세입자인지 집주인인지는 알 수 없지만 **즉시입주가 아니라는 사실은 확실**하다.
  // 실입주 목적 매수자에게는 그것만으로도 정보다. 억지로 tenant/owner로 찍으면 틀린다.
  if (/입주일?협의|협의입주|입주가능일|입주\d{2}년/.test(d)) return 'negotiable';
  return null;
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
      const detail = (rep as {
        articleDetail?: { floorInfo?: string; direction?: string; articleFeatureDescription?: string; isSafeLessorOfHug?: boolean };
      }).articleDetail;
      const feature = detail?.articleFeatureDescription ?? null;
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
        occupancy: classifyOccupancy(feature),
        feature: feature ? feature.slice(0, 60) : null,
        hugSafeLessor: detail?.isSafeLessorOfHug ?? null,
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
  // --limit=N — 구조 변경 후 소규모로 먼저 확인하기 위한 안전장치.
  // 전량(361동)을 바로 돌리면 실패해도 몇 시간 뒤에 알게 되고 그 사이 계속 요청한다.
  const limitArg = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice('--limit='.length) ?? 0);
  const dongList = limitArg > 0 ? resolveDongs(cfg, groupArg).slice(0, limitArg) : resolveDongs(cfg, groupArg);
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
  // enumerateDong이 상대경로로 /api/regions/complexes를 부르므로 new.land 오리진에서 시작해야 한다
  // (쿠키도 여기서 받는다 — backfill-coords·backfill-far와 같은 진입).
  await page.goto('https://new.land.naver.com/complexes', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(3000);

  // 1) 동별 열거 → minHousehold+ 아파트 후보
  const candidates: Array<ComplexInfo & { gu: string; dong: string }> = [];
  let zeroDongs = 0;
  let emptyDongs = 0; // 등록 아파트가 아예 없는 동(정상)
  // 조기 중단 가드 — 차단/구조변경 시 전 동이 0단지가 되는데, 그대로 두면 4~6시간을 헛돌고
  // 그 사이 계속 요청해 차단을 연장한다.
  //
  // 판정 기준 교정(2026-09-02): 종전엔 '연속 0단지'로 판단했는데, 9/2 wed 회차가 종로구
  // 청운·신교·궁정·효자·창성·통의·적선동에서 오발동해 3분 만에 중단됐다. 서촌 일대라
  // 실제로 150세대+ 아파트가 없는 동이고, wed 그룹은 하필 이 동들로 시작한다.
  // 0단지는 '차단'과 '그 동에 아파트가 없음' 둘 다에서 나오므로 신호가 될 수 없다.
  // 이제 API 응답 자체가 실패한 경우만 센다 — 차단이면 HTTP 오류가 나므로 이쪽이 진짜 신호다.
  const API_FAIL_ABORT = 5;
  let apiFailStreak = 0;
  for (const d of dongList) {
    try {
      const { complexes: found, apiOk, rawCount } = await enumerateDong(page, d.code, cfg.minHousehold);
      for (const c of found) candidates.push({ ...c, gu: d.gu, dong: d.dong });

      if (!apiOk) {
        if (++apiFailStreak >= API_FAIL_ABORT) {
          console.error(
            `[sweep] ⛔ 연속 ${apiFailStreak}개 동에서 API 응답 실패 — 차단이나 구조 변경으로 판단해 중단합니다.` +
              ' 계속 두면 헛돌면서 차단만 길어집니다. 잠시 후 재시도하세요.',
          );
          break;
        }
      } else {
        apiFailStreak = 0;
      }

      if (found.length === 0) zeroDongs++;
      if (apiOk && rawCount === 0) emptyDongs++;
      // rawCount를 함께 찍는다 — '필터로 걸러져 0'인지 '동에 아파트가 없어 0'인지 로그만 보고 갈리게.
      console.log(
        `[sweep] 열거 ${d.gu} ${d.dong}: ${found.length}단지(${cfg.minHousehold}세대+)` +
          (found.length === 0 ? ` · 등록 ${rawCount}개${rawCount === 0 ? ' — 아파트 없는 동' : ' 중 규모 미달'}` : ''),
      );
    } catch (err) {
      console.error(`[sweep] 열거 실패 ${d.dong}:`, err);
    }
    await sleep(jitter(cfg.enumDelayMs));
  }
  console.log(`[sweep] 열거 요약 — ${dongList.length}개 동 중 0단지 ${zeroDongs}개(그중 아파트 없는 동 ${emptyDongs}개)`);
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
  let specOnly = 0; // 예산 밖이라 매물은 없지만 세대수·연식을 남긴 단지
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
        // 예산 밖이어도 스펙(세대수·연식)은 남긴다 — 2026-09-01 확인: 열거 1014단지 중 659개만
        // 저장돼 355개의 세대수를 잃었고, 추천은 실거래 기반이라 '지금 매물이 없는 단지'도 후보에
        // 오른다. 그 결과 추천 9건 중 6건이 '👥 세대수 미상'으로 나갔다.
        // 매물 필드는 0/빈 배열이라 inBudgetCount>0 필터를 쓰는 소비처는 영향받지 않는다.
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
            inBudgetCount: 0,
            minDealPrice: min,
            maxDealPrice: max,
            budgetCeiling: ceiling,
            listings: [],
          },
          update: {
            household: t.totalHouseholdNumber,
            elapsedYear: t.approvalElapsedYear ?? null,
            approvalDate: t.useApprovalDate ?? null,
            totalArticles: articles.length,
            dealArticles: dealCount,
            inBudgetCount: 0,
            minDealPrice: min,
            maxDealPrice: max,
            budgetCeiling: ceiling,
            listings: [],
            sweptAt: new Date(),
          },
        });
        specOnly++;
        console.log(`[sweep] – ${t.gu} ${t.dong} ${t.name}(${t.totalHouseholdNumber}세대): 예산내 매물 없음(최저 ${min ? (min / 10000).toFixed(1) + '억' : '매물0'}) — 스펙만 저장 [${i + 1}/${targets.length}]`);
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
  console.log(`[sweep] 완료 — 예산 내 매물 ${saved}개 저장 · 스펙만 ${specOnly}개(세대수 보존)`);
}

main()
  .catch((err) => {
    console.error('[sweep] fatal:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
