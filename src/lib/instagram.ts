/**
 * instagram.ts — 카드뉴스 인스타그램 캐러셀 게시 (sklee01.ai 단일 계정).
 *
 * 참조 구현: card-news-generator/cardnews-harness-v2/src/export/instagram.mjs 이식.
 *   "Instagram Login" 경로(graph.instagram.com/v23.0) — IGAA 프로페셔널 토큰 직접 게시.
 *   흐름: PNG→JPEG(sips, 인스타 피드는 JPEG만 공식 지원) → 아이템 컨테이너 ×N
 *        → CAROUSEL 컨테이너(caption) → status_code=FINISHED 폴링 → media_publish → permalink.
 *   이미지는 공개 URL로 인스타 서버가 직접 가져감 — news-digest는 makeagent.dev로 이미 공개 노출이라
 *   INSTAGRAM_PUBLIC_BASE_URL=https://makeagent.dev/api/cardnews 를 그대로 사용(별도 서버 불필요).
 * env(.env): INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_USER_ID / INSTAGRAM_LABEL(sklee01.ai) / INSTAGRAM_PUBLIC_BASE_URL.
 *   ⚠️ 이 프로젝트에는 sklee01.ai 계정만 설정한다(사용자 지시 — 타 계정 게시 금지).
 */
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execFile);
const GRAPH = 'https://graph.instagram.com/v23.0';
const REQUEST_TIMEOUT_MS = 30_000;
const POLL_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;
const CAROUSEL_MAX = 10;

const env = (k: string) => process.env[k]?.trim() ?? '';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const maskToken = (s: string) => s.replace(/access_token=[^&\s]+/g, 'access_token=***');

export function igStatus(): { available: boolean; label?: string; reason?: string } {
  const missing = ['INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_USER_ID', 'INSTAGRAM_PUBLIC_BASE_URL'].filter((k) => !env(k));
  if (missing.length) return { available: false, reason: `미설정: ${missing.join(', ')}` };
  return { available: true, label: env('INSTAGRAM_LABEL') || env('INSTAGRAM_USER_ID') };
}

async function graphRequest(url: string, { method = 'GET', params = {} as Record<string, string> } = {}): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let target = url;
    const options: RequestInit = { method, signal: controller.signal };
    if (method === 'POST') options.body = new URLSearchParams(params);
    else {
      const u = new URL(url);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      target = u.toString();
    }
    const res = await fetch(target, options).catch((e) => {
      throw new Error(`Graph API 요청 실패(${method} ${maskToken(url)}): ${e.name === 'AbortError' ? '타임아웃' : e.message}`);
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Graph API 오류(HTTP ${res.status}): ${maskToken(text).slice(0, 500)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForContainer(id: string, token: string) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const info = await graphRequest(`${GRAPH}/${id}`, { params: { fields: 'status_code', access_token: token } });
    if (info.status_code === 'FINISHED') return;
    if (info.status_code === 'ERROR' || info.status_code === 'EXPIRED') throw new Error(`컨테이너 처리 실패(status=${info.status_code})`);
    if (Date.now() >= deadline) throw new Error(`컨테이너 준비 대기 초과(마지막 status=${info.status_code ?? '?'})`);
    await sleep(POLL_INTERVAL_MS);
  }
}

/** output/cardnews/<date>/의 PNG 세트를 sklee01.ai 캐러셀로 게시. 반환: permalink */
export async function publishCardnewsCarousel(date: string, files: string[], caption: string): Promise<{ postId: string; permalink: string | null; username: string }> {
  const st = igStatus();
  if (!st.available) throw new Error(`인스타그램 게시 불가 — ${st.reason}`);
  const token = env('INSTAGRAM_ACCESS_TOKEN');
  const igUserId = env('INSTAGRAM_USER_ID');
  const base = env('INSTAGRAM_PUBLIC_BASE_URL').replace(/\/+$/, '');

  // 게시 대상 계정 확인(안전장치): sklee01.ai가 아니면 중단 — 타 계정 오게시 방지
  const me = await graphRequest(`${GRAPH}/me`, { params: { fields: 'username', access_token: token } });
  if (me.username !== 'sklee01.ai') throw new Error(`토큰 계정이 sklee01.ai가 아닙니다(${me.username}) — 게시 중단`);

  const pngs = files.filter((f) => /\.png$/i.test(f));
  if (!pngs.length) throw new Error('게시할 PNG가 없습니다');
  if (pngs.length > CAROUSEL_MAX) throw new Error(`캐러셀 최대 ${CAROUSEL_MAX}장(현재 ${pngs.length}장)`);

  // ⚠️ 중복 게시 가드(2026-07-06 사고 교훈): 인스타는 게시를 성공시키고도 403(2207051)을 반환할 수 있어
  //    재시도가 중복 게시를 만든다 — 최근 15분 내 동일 캡션 게시물이 있으면 중단.
  const dup = await findRecentPost(token, igUserId, Date.now() - 15 * 60_000, caption);
  if (dup) throw new Error(`15분 내 동일 캡션 게시물이 이미 존재합니다(${dup.permalink}) — 중복 게시 방지로 중단. 인스타 앱에서 확인하세요.`);
  const startedAt = Date.now();

  // 1) PNG→JPEG 변환(인스타 피드는 JPEG만 공식 지원) — 같은 폴더에 .jpg, /api/cardnews가 서빙
  const dir = join(process.cwd(), 'output', 'cardnews', date);
  const jpgs: string[] = [];
  for (const f of pngs) {
    const jpg = f.replace(/\.png$/i, '.jpg');
    const jpgPath = join(dir, jpg);
    if (!existsSync(jpgPath)) {
      await exec('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', join(dir, f), '--out', jpgPath]);
    }
    jpgs.push(jpg);
  }

  // 2) 아이템 컨테이너 ×N (공개 URL — 파일명 percent-encode: 참조 구현의 9004 오류 예방)
  //    연속 생성 스팸 차단(2207051) 대응: 5초 페이싱 + 차단 시 30/60/120초 백오프 재시도
  const children: string[] = [];
  for (const jpg of jpgs) {
    const imageUrl = `${base}/${encodeURIComponent(date)}/${encodeURIComponent(jpg)}`;
    let item: any = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        item = await graphRequest(`${GRAPH}/${igUserId}/media`, {
          method: 'POST',
          params: { image_url: imageUrl, is_carousel_item: 'true', access_token: token },
        });
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('2207051') && attempt < 3) { await sleep(30_000 * Math.pow(2, attempt)); continue; }
        throw e;
      }
    }
    if (!item?.id) throw new Error(`아이템 컨테이너 실패(${jpg}): ${JSON.stringify(item)}`);
    children.push(item.id);
    await sleep(5_000);
  }

  // 3) 캐러셀 컨테이너 → 폴링 → 게시
  const container = await graphRequest(`${GRAPH}/${igUserId}/media`, {
    method: 'POST',
    params: { media_type: 'CAROUSEL', children: children.join(','), caption, access_token: token },
  });
  if (!container.id) throw new Error(`캐러셀 컨테이너 실패: ${JSON.stringify(container)}`);
  await waitForContainer(container.id, token);

  let published: any;
  try {
    published = await graphRequest(`${GRAPH}/${igUserId}/media_publish`, {
      method: 'POST',
      params: { creation_id: container.id, access_token: token },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('2207051')) {
      // ⚠️ 인스타는 게시를 성공시키고도 2207051을 반환할 수 있음(2026-07-06 실측: 6중복 사고)
      //    → 에러를 믿지 말고 실제 게시 여부를 미디어 목록으로 확인
      await sleep(15_000);
      const posted = await findRecentPost(token, igUserId, startedAt, caption).catch(() => null);
      if (posted) {
        clearPending();
        return { postId: posted.id, permalink: posted.permalink ?? null, username: me.username };
      }
      savePending(date, container.id);
      throw new Error(`컨테이너(${container.id})까지 성공했으나 게시 액션이 차단됨(2207051, 실제 미게시 확인됨). 잠시 후 '게시 재시도'로 게시만 다시 시도하세요(컨테이너 24시간 유효).`);
    }
    throw e;
  }
  if (!published.id) throw new Error(`media_publish 실패: ${JSON.stringify(published)}`);
  clearPending();

  let permalink: string | null = null;
  try {
    const info = await graphRequest(`${GRAPH}/${published.id}`, { params: { fields: 'permalink', access_token: token } });
    permalink = info.permalink ?? null;
  } catch { /* permalink 없이 성공 처리 */ }

  return { postId: published.id, permalink, username: me.username };
}

/** 최근 게시물 중 기준 시각 이후·동일 캡션 시작 게시물 탐색 — "403이지만 실제론 게시됨" 검증용 */
async function findRecentPost(token: string, igUserId: string, sinceMs: number, caption: string): Promise<{ id: string; permalink?: string } | null> {
  const list = await graphRequest(`${GRAPH}/${igUserId}/media`, {
    params: { fields: 'id,permalink,timestamp,caption', limit: '5', access_token: token },
  });
  const prefix = caption.slice(0, 30);
  for (const m of list.data ?? []) {
    const ts = Date.parse(m.timestamp);
    if (ts >= sinceMs - 60_000 && (m.caption ?? '').startsWith(prefix)) return m;
  }
  return null;
}

/* ── 게시 차단 시 컨테이너 보존·재시도 (creation_id는 24시간 유효) ── */
const PENDING_PATH = () => join(process.cwd(), 'output', 'cardnews', 'pending-publish.json');

export function getPending(): { date: string; creationId: string; createdAt: string } | null {
  try { return JSON.parse(readFileSync(PENDING_PATH(), 'utf-8')); } catch { return null; }
}
function savePending(date: string, creationId: string) {
  writeFileSync(PENDING_PATH(), JSON.stringify({ date, creationId, createdAt: new Date().toISOString() }));
}
function clearPending() {
  try { unlinkSync(PENDING_PATH()); } catch { /* 없음 */ }
}

/** 보존된 컨테이너로 게시만 재시도 */
export async function retryPendingPublish(): Promise<{ postId: string; permalink: string | null }> {
  const pending = getPending();
  if (!pending) throw new Error('재시도할 대기 컨테이너가 없습니다');
  const token = env('INSTAGRAM_ACCESS_TOKEN');
  const igUserId = env('INSTAGRAM_USER_ID');
  const published = await graphRequest(`${GRAPH}/${igUserId}/media_publish`, {
    method: 'POST',
    params: { creation_id: pending.creationId, access_token: token },
  });
  if (!published.id) throw new Error(`media_publish 실패: ${JSON.stringify(published)}`);
  clearPending();
  let permalink: string | null = null;
  try {
    const info = await graphRequest(`${GRAPH}/${published.id}`, { params: { fields: 'permalink', access_token: token } });
    permalink = info.permalink ?? null;
  } catch { /* */ }
  return { postId: published.id, permalink };
}
