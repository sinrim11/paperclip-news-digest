/**
 * scripts/collect-gosi.ts — 도시계획 고시 선행 감지 (2026-08-29 신설).
 *
 * 목적: 개발 호재를 "뉴스"가 아니라 "원문"으로 먼저 잡는다. 재개발 구역 지정·지구단위계획·
 * 주택건설사업계획 승인 같은 결정은 반드시 고시(告示)로 먼저 공개되고, 기사는 그걸 받아쓴다.
 *
 * 소스: 토지이음 고시정보(eum.go.kr) — 국토계획법에 따른 전국 고시 원문 목록. 로그인 불필요.
 *   ※ data.go.kr의 개발행위허가 API는 신청·인증까지 통과했으나 전 지역·전 기간 0건이라
 *     (데이터 연계 중단으로 판단) 사용하지 않는다. 파일데이터는 로그인이 필요해 자동화 불가.
 *
 * 흐름: 최근 N페이지 수집 → 커버리지 지역 + 부동산 키워드 필터 → 신규(seq)만 알림·기록.
 * 산출: config/gosi-seen.json(중복 방지 상태) · config/gosi-hits.json(감지 이력, 최근 200건)
 * 실행: npx tsx scripts/collect-gosi.ts [--pages=8] [--dry]
 */

import { readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { LAWD_GU } from '../src/lib/tiers';
import { sendTelegram } from '../src/lib/telegram';
import { extractGosiFacts, formatArea, type GosiFacts } from '../src/lib/gosi-extract';

const BASE = 'https://www.eum.go.kr';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const LIST_URL = `${BASE}/web/gs/gv/gvGosiList.jsp`;
const DETAIL_URL = `${BASE}/web/gs/gv/gvGosiDet.jsp?seq=`;
const SEEN_PATH = join(process.cwd(), 'config', 'gosi-seen.json');
const HITS_PATH = join(process.cwd(), 'config', 'gosi-hits.json');

/**
 * 우리 커버리지 매칭 토큰 — 구 이름만 보면 안 된다(2026-08-29 오탐 교정).
 * '중구'·'강서구'·'중랑구'는 전국에 여러 개라, 실제로 대전광역시 중구 고시가
 * 서울 중구로 잘못 잡혔다. lawdCd 앞 2자리로 시·도를 판별해 org 접두어까지 검증한다.
 */
const SIDO_PREFIX: Record<string, string[]> = { '11': ['서울특별시', '서울시', '서울'], '41': ['경기도'] };
const REGION_TOKENS: Array<{ token: string; gu: string; sido: string[] }> = Object.entries(LAWD_GU).flatMap(([cd, gu]) => {
  const sido = SIDO_PREFIX[cd.slice(0, 2)] ?? [];
  const parts = gu.split(' ');
  return parts.length > 1
    ? [{ token: parts[1], gu, sido }, { token: parts[0], gu, sido }] // '동안구','안양'
    : [{ token: gu, gu, sido }]; // '남양주시','노원구'
});

/** org(게시 지자체)와 고시번호에서 시·도까지 일치하는 지역만 우리 커버리지로 인정. */
function matchRegion(org: string, no: string): string {
  const hay = `${org} ${no}`;
  for (const r of REGION_TOKENS) {
    if (!hay.includes(r.token)) continue;
    if (r.sido.length && !r.sido.some((s) => hay.includes(s))) continue; // 타 시·도 동명 구 배제
    return r.gu;
  }
  return '';
}

/* 부동산 가치 영향도 등급(2026-08-29, 한 달치 500건 표본으로 튜닝):
   초기 필터가 '도시계획시설'을 통째로 통과시켜 도로·공원·공공공지·수도설비 같은 소규모 시설
   고시가 절반을 차지했다. 시설류는 원칙적으로 빼되, 철도·역·광역교통만 남긴다. */
const HIGH = ['정비구역', '재개발', '재건축', '조합설립', '사업시행계획인가', '사업시행인가', '관리처분',
  '지구지정', '도시개발', '공공주택', '택지개발', '가로주택', '소규모재개발', '모아타운', '역세권',
  '주택건설사업계획', '철도', '광역교통', '환승'];
const MID = ['지구단위계획', '정비계획', '개발행위허가 제한', '용도지역', '지구계획'];
/** 시설 고시 중 부동산 가치와 무관한 소규모 인프라 — 단독으로 등장하면 제외 */
const FACILITY_NOISE = ['근린공원', '공공공지', '수도공급', '자동차정류장', '주차장', '녹지', '하수',
  '폐기물', '체육시설', '종합의료시설', '도시계획시설(도로', '시설:도로', '(도로)'];
const EXCLUDE = ['자연재해', '산사태', '농지', '축사', '분뇨', '묘지', '수산', '어항'];

interface Gosi { seq: string; date: string; no: string; title: string; org: string; gu: string; grade?: '높음' | '중간'; facts?: GosiFacts }

/** 등급 판정 — HIGH 우선, 없으면 MID. 시설 노이즈만 있으면 null(제외). */
function gradeOf(title: string): '높음' | '중간' | null {
  if (EXCLUDE.some((k) => title.includes(k))) return null;
  if (HIGH.some((k) => title.includes(k))) return '높음';
  const isNoise = FACILITY_NOISE.some((k) => title.includes(k));
  if (MID.some((k) => title.includes(k))) return isNoise ? null : '중간';
  return null;
}

/**
 * 고시 원문(PDF)에서 면적·제한기간을 뽑아 알림에 덧붙인다(2026-08-29).
 * 양식이 지자체·유형마다 달라 전건 성공은 불가능하므로(조사 결과 7/10) "되면 붙이고 안 되면 생략".
 * 다운로드 규약: POST /web/FileDownload.do · 파일명 EUC-KR 인코딩 필수(UTF-8이면 서버가 거부)
 *   + gosi=Y, seq, Referer. Node에 EUC-KR 인코더가 없어 python3로 퍼센트 인코딩만 위임한다.
 */
async function fetchFacts(seq: string): Promise<GosiFacts | null> {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const exec = promisify(execFile);

    const res = await fetch(`${DETAIL_URL}${seq}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
    const html = dec(await res.arrayBuffer());
    const pdfPath = [...html.matchAll(/download\('\/web\/FileDownload\.do',\s*'([^']+)'\)/g)]
      .map((m) => m[1]).find((f) => /\.pdf$/i.test(f));
    if (!pdfPath) return null;

    const { stdout: enc } = await exec('python3', ['-c', `import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1].encode('euc-kr')))`, pdfPath]);
    const tmp = join(tmpdir(), `gosi-${seq}.pdf`);
    await exec('curl', ['-s', '-L', '--max-time', '60', '-A', UA, '-e', `${DETAIL_URL}${seq}`,
      '--data', `file=${enc.trim()}&gosi=Y&seq=${seq}&mobile_yn=`, `${BASE}/web/FileDownload.do`, '-o', tmp]);

    const { stdout: text } = await exec('pdftotext', ['-layout', '-f', '1', '-l', '4', tmp, '-'], { maxBuffer: 20e6 });
    rmSync(tmp, { force: true });
    const facts = extractGosiFacts(text);
    return facts.areaM2 || facts.periodText ? facts : null;
  } catch {
    return null; // 원문 파싱은 부가 정보 — 실패해도 알림 자체는 나가야 한다
  }
}

const dec = (buf: ArrayBuffer) => new TextDecoder('euc-kr').decode(buf);
const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

async function fetchPage(pageNo: number): Promise<Gosi[]> {
  const res = await fetch(`${LIST_URL}?pageNo=${pageNo}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = dec(await res.arrayBuffer());
  const out: Gosi[] = [];
  for (const row of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    const seq = row.match(/gvGosiDet\.jsp\?seq=(\d+)/)?.[1];
    if (!seq) continue;
    const cells = (row.match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? []).map(strip);
    if (cells.length < 4) continue;
    const [date, no, title, org] = cells;
    out.push({ seq, date, no, title, org, gu: matchRegion(org, no) });
  }
  return out;
}

const relevant = (g: Gosi) => {
  if (!g.gu) return false;
  const grade = gradeOf(g.title);
  if (!grade) return false;
  g.grade = grade;
  return true;
};

function loadJson<T>(p: string, fallback: T): T {
  try { return JSON.parse(readFileSync(p, 'utf-8')) as T; } catch { return fallback; }
}

async function main() {
  const dry = process.argv.includes('--dry');
  const pages = Number(process.argv.find((a) => a.startsWith('--pages='))?.split('=')[1] ?? 8);

  const all: Gosi[] = [];
  for (let p = 1; p <= pages; p++) {
    try {
      all.push(...(await fetchPage(p)));
    } catch (e) {
      console.error(`[gosi] ${p}페이지 실패:`, e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, 600)); // 공공 사이트 예의
  }

  const seen = new Set(loadJson<string[]>(SEEN_PATH, []));
  const hits = all.filter(relevant);
  const fresh = hits.filter((g) => !seen.has(g.seq));
  console.log(`[gosi] ${pages}페이지 ${all.length}건 수집 · 커버리지+키워드 적중 ${hits.length}건 · 신규 ${fresh.length}건`);
  for (const g of fresh) console.log(`  · ${g.grade === '높음' ? '🔴' : '🟡'} [${g.date}] ${g.gu} — ${g.title}`);

  // 알림에 나갈 건만 원문에서 면적·기간 보강(있으면 붙이고 없으면 생략)
  for (const g of fresh.slice(0, 8)) {
    g.facts = (await fetchFacts(g.seq)) ?? undefined;
    if (g.facts?.areaM2) console.log(`     └ 원문: ${formatArea(g.facts.areaM2)}${g.facts.periodText ? ` · ${g.facts.periodText}` : ''}`);
    await new Promise((r) => setTimeout(r, 800));
  }

  if (dry) return;

  for (const g of all) seen.add(g.seq); // 적중 여부와 무관하게 '본 것'으로 기록(재알림 방지)
  writeFileSync(SEEN_PATH, JSON.stringify([...seen].slice(-4000), null, 0));

  if (fresh.length) {
    const hist = loadJson<Gosi[]>(HITS_PATH, []);
    writeFileSync(HITS_PATH, JSON.stringify([...fresh, ...hist].slice(0, 200), null, 2));
    const lines = fresh.slice(0, 8).map((g) => {
      const f = [g.facts?.areaM2 ? `면적 ${formatArea(g.facts.areaM2)}` : null, g.facts?.periodText].filter(Boolean).join(' · ');
      return `${g.grade === '높음' ? '🔴' : '🟡'} [${g.gu}] ${g.title}\n${f ? `  📐 ${f}\n` : ''}  ${g.no} (${g.date})\n  ${DETAIL_URL}${g.seq}`;
    });
    await sendTelegram(
      [`📜 도시계획 고시 ${fresh.length}건 (🔴정비·개발 ${fresh.filter((g) => g.grade === '높음').length} · 🟡계획변경 ${fresh.filter((g) => g.grade === '중간').length}) — 기사보다 먼저 나오는 원문`, '', ...lines,
        fresh.length > 8 ? `\n외 ${fresh.length - 8}건` : '',
        '\n출처: 토지이음 고시정보(국토계획법 고시 원문)'].filter(Boolean).join('\n'),
    );
  }
}

main().catch((e) => { console.error('[gosi] fatal:', e); process.exitCode = 1; });
