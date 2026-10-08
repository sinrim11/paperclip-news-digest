import type { RawArticle } from '../types';
import { assertSourceAllowed } from '../source-guard';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * investing.com 시장 뉴스 — TradingAgents가 떨어뜨린 캐시를 읽는다.
 *
 * **왜 직접 긁지 않는가**: investing.com은 Cloudflare Turnstile이 헤드리스·자동 로그인을 막아서,
 * ~/TradingAgents-ClaudeCLI는 실제 Chrome을 remote-debugging(9222)으로 띄우고 사람이 1회 로그인한
 * 세션(`~/.investing_chrome_cdp`)을 재사용한다. 그 의존성을 news-digest가 복제하면 launchd 무인
 * 실행에서 깨진다. TradingAgents가 매일 17:00에 캐시를 쓰므로 우리는 읽기만 한다.
 *
 * **그래서 생기는 제약**: 이 소스의 신선도는 남의 잡과 남의 로그인 세션에 달려 있다. 세션이
 * 만료되면(해당 plist는 KeepAlive=false — 수동 재로그인 필요) 캐시가 조용히 늙는다. 조용한
 * 노화야말로 오늘 하루 종일 잡은 그 실패 유형이라, collected_at을 보고 늙으면 로그를 남긴다.
 *
 * 캐시 경로는 INVESTING_CACHE_DIR로 덮어쓸 수 있다(TradingAgents plist와 같은 키).
 */

const STALE_WARN_HOURS = 26; // 하루 1회 갱신 + 여유. 넘으면 한 번은 거른 것
const STALE_DEAD_HOURS = 50; // 이틀 연속 실패 = 세션 만료로 본다

interface MarketNewsCache {
  items: Array<{ title: string; time: string; href: string; tag?: string }>;
  collected_at: string;
  source: string;
  count: number;
}

function cacheDir(): string {
  return process.env.INVESTING_CACHE_DIR
    ?? join(process.env.HOME ?? '', '.tradingagents', 'investing-cache');
}

export async function collectInvesting(): Promise<RawArticle[]> {
  assertSourceAllowed('investing');
  const path = join(cacheDir(), 'market-news.json');
  let cache: MarketNewsCache;
  try {
    cache = JSON.parse(readFileSync(path, 'utf-8')) as MarketNewsCache;
  } catch (err) {
    console.warn(`[collector:investing] DEAD — 캐시를 읽을 수 없음: ${path} (${String(err).slice(0, 60)})`);
    return [];
  }

  const ageH = (Date.now() - new Date(cache.collected_at).getTime()) / 3_600_000;
  if (!Number.isFinite(ageH)) {
    console.warn(`[collector:investing] DEAD — collected_at 파싱 불가: ${cache.collected_at}`);
    return [];
  }
  if (ageH > STALE_DEAD_HOURS) {
    console.warn(
      `[collector:investing] DEAD — 캐시가 ${Math.round(ageH)}시간 낡음. ` +
      `TradingAgents의 investing.com 로그인 세션이 만료됐을 가능성이 높다 ` +
      `(CDP Chrome에서 1회 수동 재로그인 필요).`);
    return [];
  }
  if (ageH > STALE_WARN_HOURS) {
    console.warn(`[collector:investing] EMPTY — 캐시가 ${Math.round(ageH)}시간 낡음(수집 잡을 한 번 거른 듯). 일단 사용.`);
  }

  const items = (cache.items ?? [])
    .filter((i) => i.title && i.href)
    .map((i) => ({
      title: i.title,
      // 캐시에 본문이 없다(헤드라인 수집기다). 무엇을 가진 항목인지는 명시해야 LLM이 살을
      // 붙이지 않는다 — 이 시스템의 "기사에 없는 뉴스 생성 금지" 원칙.
      //
      // 안내 문구가 아니라 제목을 앞에 둔다. 모든 항목이 같은 문구로 시작하면 clusterArticles의
      // bigram 유사도(content 앞 300자)가 1.0이 되는데, 다행히 `clusterArticles`에 **같은 소스끼리는
      // 병합하지 않는** 가드가 있어 investing 내부 오병합은 실제로 일어나지 않는다(2건으로 재현 확인).
      // 그래도 제목을 앞에 두는 편이 낫다 — 요약 단계에서 content가 그대로 쓰이므로 제목 맥락이
      // 남고, 다른 소스와의 유사도 계산도 보일러플레이트가 아닌 실데이터로 이뤄진다.
      content: `${i.title}\n\n(investing.com 헤드라인${i.tag ? ` · ${i.tag}` : ''} — 본문 미수집, 제목과 시각만 확인됨)`,
      url: i.href,
      source: 'investing.com',
      category: 'STOCKS' as const,
      publishedAt: i.time ? new Date(i.time.replace(' ', 'T') + '+09:00').toISOString() : undefined,
    }));

  if (items.length === 0) console.warn('[collector:investing] EMPTY — 캐시는 읽었으나 항목 0건');
  return items;
}
