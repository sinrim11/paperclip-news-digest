/**
 * econ-calendar.ts — 오늘 발표 예정 US/KR 경제지표 (2026-09-15).
 *
 * investing.com 경제캘린더를 TradingAgents(CDP Chrome + 로그인 세션)가 수집해 남긴 캐시를
 * 읽는다. 직접 긁지 않는 이유는 `collectors/investing.ts`와 같다(Cloudflare Turnstile).
 *
 * **이건 기사가 아니라 일정이다.** 그래서 `collectByCategory`에 넣지 않는다 — 수집 파이프라인에
 * 들어가면 LLM 요약 대상이 되고, 일정이 뉴스 문장으로 각색될 여지가 생긴다. 이 시스템의
 * "기사에 없는 뉴스 생성 금지" 원칙에 따라 결정론 데이터는 결정론으로 렌더한다(MarketDaily와 같은 계열).
 *
 * **날짜가 오늘이 아니면 버린다.** 시간 기반 신선도 가드보다 강한 조건이다 — 캘린더는 당일 뷰라
 * 어제 것은 26시간이 안 지났어도 무의미하다. refresh가 실패한 날 조용히 전날 일정을
 * "오늘 발표 예정"으로 내보내는 것이 이 연동의 유일한 거짓말 경로이므로 거기를 막는다.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

export interface EconEvent {
  time: string;       // "21:30"
  country: string;    // "US" | "KR"
  indicator: string;
  actual: string;
  forecast: string;
  previous: string;
}

interface CalendarCache {
  events: EconEvent[];
  date: string;           // 수집일(YYYY-MM-DD)
  collected_at: string;
  count: number;
  rows_seen?: number;
  parsed_rows?: number;   // 0이면 파싱 실패, >0인데 count=0이면 '오늘 해당 이벤트 없음'
}

function cacheDir(): string {
  return process.env.INVESTING_CACHE_DIR
    ?? join(process.env.HOME ?? '', '.tradingagents', 'investing-cache');
}

const todayKst = (): string =>
  new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

/** 오늘자 캘린더. 없거나·낡았거나·파싱이 깨졌으면 null(호출부는 렌더하지 않는다). */
export function loadEconCalendar(): { events: EconEvent[]; collectedAt: string } | null {
  const path = join(cacheDir(), 'economic-calendar.json');
  let c: CalendarCache;
  try {
    c = JSON.parse(readFileSync(path, 'utf-8')) as CalendarCache;
  } catch {
    return null; // 캐시 없음 — 정상 상태(수집 전)일 수 있어 조용히 넘긴다
  }

  const today = todayKst();
  if (c.date !== today) {
    console.warn(`[econ-calendar] STALE — 캐시 날짜 ${c.date} ≠ 오늘 ${today}. 표시하지 않음(아침 재수집 실패 추정).`);
    return null;
  }
  // parsed_rows가 0이면 표에서 아무것도 못 읽은 것 = 파싱 실패. 이벤트 0건(주말 등)과 구분된다.
  if (c.parsed_rows === 0) {
    console.warn(`[econ-calendar] DEAD — rows_seen=${c.rows_seen ?? '?'}인데 parsed_rows=0. 파싱 실패.`);
    return null;
  }
  if (!c.events?.length) return null; // 오늘 해당 이벤트 없음 — 주말엔 정상

  return { events: c.events, collectedAt: c.collected_at };
}

/**
 * 텔레그램 브리핑용 한 블록. 데이터 주입 그대로(무날조) — 값이 없으면 항목을 빼고 쓰지 않는다.
 * `sendTelegram`은 parse_mode를 지정하지 않으므로 **plain text**다(HTML 태그를 쓰면 그대로 보인다).
 */
export function renderEconCalendarText(): string {
  const cal = loadEconCalendar();
  if (!cal) return '';
  const lines = ['', '📅 오늘 발표 예정 (US·KR)'];
  for (const e of cal.events.slice(0, 6)) {
    const vals: string[] = [];
    if (e.forecast) vals.push(`예상 ${e.forecast}`);
    if (e.previous) vals.push(`이전 ${e.previous}`);
    lines.push(`· ${e.time} [${e.country}] ${e.indicator}${vals.length ? ` (${vals.join(' · ')})` : ''}`);
  }
  return lines.join('\n');
}
