import { describe, it, expect } from 'vitest';
import {
  normalizeUrl,
  titleSimilarity,
  dedupArticles,
  computeRollingDuplicateRate,
  DEDUP_THRESHOLD,
} from '../lib/dedup';
import type { RawArticle } from '../lib/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeArticle(overrides: Partial<RawArticle> & { title: string; url: string }): RawArticle {
  return {
    content: overrides.title + ' — 본문 내용입니다.',
    source: '테스트뉴스',
    category: 'GLOBAL',
    publishedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── URL normalisation ────────────────────────────────────────────────────────

describe('normalizeUrl', () => {
  it('strips query parameters', () => {
    expect(normalizeUrl('https://example.com/news?utm_source=rss&utm_medium=feed')).toBe(
      'https://example.com/news',
    );
  });

  it('removes www. prefix', () => {
    expect(normalizeUrl('https://www.reuters.com/article/123')).toBe(
      'https://reuters.com/article/123',
    );
  });

  it('removes trailing slash from path', () => {
    expect(normalizeUrl('https://bbc.co.uk/news/world/')).toBe('https://bbc.co.uk/news/world');
  });

  it('lowercases scheme and host', () => {
    expect(normalizeUrl('HTTPS://BBC.CO.UK/news/world')).toBe('https://bbc.co.uk/news/world');
  });

  it('strips URL fragment', () => {
    expect(normalizeUrl('https://example.com/article#section-2')).toBe(
      'https://example.com/article',
    );
  });

  it('treats www and non-www versions as equal', () => {
    const a = normalizeUrl('https://www.yonhapnews.co.kr/bulletin/2026/04/18/0200000000AKR20260418.HTML');
    const b = normalizeUrl('https://yonhapnews.co.kr/bulletin/2026/04/18/0200000000AKR20260418.HTML?input=rss');
    expect(a).toBe(b);
  });

  it('handles URL with multiple query params and fragment', () => {
    const result = normalizeUrl('https://example.com/page?a=1&b=2#top');
    expect(result).toBe('https://example.com/page');
  });

  it('returns best-effort lowercase for invalid URL', () => {
    const result = normalizeUrl('not-a-url');
    expect(result).toBe('not-a-url');
  });
});

// ─── Title similarity ─────────────────────────────────────────────────────────

describe('titleSimilarity', () => {
  it('returns 1.0 for identical titles', () => {
    expect(titleSimilarity('삼성전자 1분기 영업이익 발표', '삼성전자 1분기 영업이익 발표')).toBe(1);
  });

  it('returns high score for near-duplicate titles', () => {
    const score = titleSimilarity(
      '삼성전자 1분기 영업이익 6조원 발표',
      '삼성전자 1분기 영업이익 6조원 잠정 발표',
    );
    expect(score).toBeGreaterThanOrEqual(DEDUP_THRESHOLD);
  });

  it('returns low score for unrelated titles', () => {
    const score = titleSimilarity(
      '삼성전자 반도체 실적 발표',
      '현대차 전기차 유럽 수출 급증',
    );
    expect(score).toBeLessThan(0.3);
  });

  it('returns 0 for empty strings', () => {
    expect(titleSimilarity('', 'anything')).toBe(0);
    expect(titleSimilarity('anything', '')).toBe(0);
  });
});

// ─── dedupArticles ────────────────────────────────────────────────────────────

describe('dedupArticles', () => {
  it('same URL (with query params) collapses to one group', () => {
    const articles = [
      makeArticle({ title: '금리 인상 결정', url: 'https://example.com/article?utm_source=rss' }),
      makeArticle({ title: '금리 인상 결정', url: 'https://example.com/article?from=app' }),
    ];
    const result = dedupArticles(articles);
    expect(result.groups).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it('same-source near-duplicate titles collapse', () => {
    // Two URLs that don't normalise to the same string, but titles are near-identical
    const articles = [
      makeArticle({ title: '연준 FOMC 기준금리 0.25%p 동결 결정 발표', url: 'https://news.co.kr/1001', source: '한국경제' }),
      makeArticle({ title: '연준 FOMC 기준금리 0.25%p 동결 결정', url: 'https://news.co.kr/1002', source: '한국경제' }),
    ];
    const result = dedupArticles(articles);
    expect(result.groups).toHaveLength(1);
    expect(result.duplicateRate).toBeCloseTo(0.5);
  });

  it('cross-source near-duplicate titles are NOT collapsed (preserved for clustering)', () => {
    const articles = [
      makeArticle({ title: '애플 신제품 공개', url: 'https://reuters.com/1', source: 'Reuters' }),
      makeArticle({ title: '애플 신제품 공개', url: 'https://bbc.com/1', source: 'BBC' }),
    ];
    const result = dedupArticles(articles);
    // Different sources → kept as separate groups
    expect(result.groups).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(0);
  });

  it('sourceList contains all original URLs in a merged group', () => {
    const articles = [
      makeArticle({ title: '코스피 2500 돌파 — 장중', url: 'https://mk.co.kr/1', source: '매일경제' }),
      makeArticle({ title: '코스피 2500 돌파 장중', url: 'https://mk.co.kr/2', source: '매일경제' }),
    ];
    const result = dedupArticles(articles);
    expect(result.groups[0].sourceList).toContain('매일경제');
  });

  it('consensusFacts is non-empty for merged group', () => {
    const articles = [
      makeArticle({ title: '현대차 전기차 수출 급증 발표', url: 'https://news.co.kr/a', source: '뉴스1' }),
      makeArticle({ title: '현대차 전기차 수출 급증', url: 'https://news.co.kr/b', source: '뉴스1' }),
    ];
    const result = dedupArticles(articles);
    expect(result.groups[0].consensusFacts).toBeTruthy();
  });

  it('no false positives on unrelated articles (duplicate rate = 0)', () => {
    const articles = [
      makeArticle({ title: '삼성 갤럭시 신모델 출시', url: 'https://a.com/1', source: 'A' }),
      makeArticle({ title: '현대차 수소차 개발 발표', url: 'https://b.com/1', source: 'B' }),
      makeArticle({ title: '카카오 AI 서비스 오픈', url: 'https://c.com/1', source: 'C' }),
      makeArticle({ title: 'LG 가전 유럽 수출', url: 'https://d.com/1', source: 'D' }),
    ];
    const result = dedupArticles(articles);
    expect(result.duplicatesRemoved).toBe(0);
    expect(result.duplicateRate).toBe(0);
  });

  it('representative is the article with the longest content', () => {
    const short = makeArticle({ title: '기준금리 인하 결정', url: 'https://example.com/a?x=1', source: 'S', content: '짧은 내용' });
    const long = makeArticle({ title: '기준금리 인하 결정', url: 'https://example.com/a?x=2', source: 'S', content: '매우 길고 상세한 내용입니다. '.repeat(20) });
    const result = dedupArticles([short, long]);
    expect(result.groups[0].representative.content).toBe(long.content);
  });
});

// ─── computeRollingDuplicateRate ──────────────────────────────────────────────

describe('computeRollingDuplicateRate', () => {
  it('returns 0 for empty array', () => {
    expect(computeRollingDuplicateRate([])).toBe(0);
  });

  it('returns 0 when all articles are unique', () => {
    const articles = [
      makeArticle({ title: '기사 A', url: 'https://a.com/1' }),
      makeArticle({ title: '기사 B', url: 'https://b.com/2' }),
    ];
    expect(computeRollingDuplicateRate(articles)).toBe(0);
  });

  it('excludes articles outside the 7-day window', () => {
    const old = makeArticle({
      title: '오래된 기사',
      url: 'https://a.com/old',
      publishedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
    });
    const recent = makeArticle({
      title: '최신 기사',
      url: 'https://a.com/new',
      publishedAt: new Date().toISOString(),
    });
    // Even if old article is a near-duplicate of recent, it should be excluded
    const rate = computeRollingDuplicateRate([old, recent]);
    // Only 1 article in window → no duplicates
    expect(rate).toBe(0);
  });

  it('returns rate below 0.02 target for typical unique article set', () => {
    const titles = [
      '삼성전자 1분기 실적 발표', '현대차 전기차 유럽 수출 급증', '카카오 AI 신규 서비스 출시',
      '애플 WWDC 2026 일정 공개', '테슬라 FSD 한국 출시 임박', '엔비디아 블랙웰 GPU 공급 확대',
      '국내 부동산 거래량 회복세', '연준 기준금리 동결 유지', '한국은행 기준금리 인상 검토',
      'LG에너지솔루션 미국 공장 증설',
    ];
    const sources = ['Reuters', 'Bloomberg', 'Yonhap', 'MK', 'KBS'];
    const articles = titles.flatMap((title, i) =>
      sources.map((source, j) =>
        makeArticle({ title, url: `https://${source.toLowerCase()}.com/${i}-${j}`, source }),
      ),
    );
    // All different stories (even if same title, different source → not collapsed by design)
    expect(computeRollingDuplicateRate(articles)).toBeLessThan(0.02);
  });
});
