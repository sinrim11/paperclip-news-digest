import { describe, it, expect } from 'vitest';
import {
  computeTrustScore,
  computeFreshnessScore,
  computeInterestMatchScore,
  computeSignalScore,
  scoreArticle,
  rankArticles,
  type Persona,
  type RankableArticle,
} from '../lib/ranker';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

const SEEN_NONE = new Set<string>();

// ─── Trust ────────────────────────────────────────────────────────────────────

describe('computeTrustScore', () => {
  it('returns correct trust for known source types', () => {
    expect(computeTrustScore('arxiv')).toBe(0.95);
    expect(computeTrustScore('pwc')).toBe(0.90);
    expect(computeTrustScore('github')).toBe(0.80);
    expect(computeTrustScore('newsletter')).toBe(0.75);
    expect(computeTrustScore('rss')).toBe(0.70);
    expect(computeTrustScore('hn')).toBe(0.65);
  });

  it('is case-insensitive', () => {
    expect(computeTrustScore('RSS')).toBe(computeTrustScore('rss'));
    expect(computeTrustScore('GitHub')).toBe(computeTrustScore('github'));
  });

  it('returns defaultTrust for unknown source types', () => {
    expect(computeTrustScore('unknown_source')).toBe(0.60);
  });
});

// ─── Freshness ────────────────────────────────────────────────────────────────

describe('computeFreshnessScore', () => {
  const full = 24;
  const target = 168;
  const targetScore = 0.10;

  it('returns 1.0 for brand-new articles (0h elapsed)', () => {
    expect(computeFreshnessScore(0, full, target, targetScore)).toBe(1.0);
  });

  it('returns 1.0 at the fullScoreHours boundary (24h)', () => {
    expect(computeFreshnessScore(24, full, target, targetScore)).toBe(1.0);
  });

  it('returns ~0.10 at decayTargetHours (168h)', () => {
    const score = computeFreshnessScore(168, full, target, targetScore);
    expect(score).toBeCloseTo(0.10, 4);
  });

  it('is monotonically decreasing after fullScoreHours', () => {
    const scores = [24, 48, 72, 96, 120, 144, 168].map((h) =>
      computeFreshnessScore(h, full, target, targetScore),
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });

  it('never drops below 0.01', () => {
    expect(computeFreshnessScore(9999, full, target, targetScore)).toBeGreaterThanOrEqual(0.01);
  });
});

// ─── Interest match ───────────────────────────────────────────────────────────

describe('computeInterestMatchScore', () => {
  const persona: Persona = {
    id: 'p1',
    name: 'Tech Investor',
    interests: ['ai', 'nvidia', 'llm', 'gpu'],
  };

  const highMatchArticle: RankableArticle = {
    id: 'a1',
    title: 'NVIDIA releases new GPU for LLM inference',
    contextTags: ['nvidia', 'gpu', 'llm', 'ai'],
    publishedAt: hoursAgo(1),
    sourceType: 'rss',
  };

  const lowMatchArticle: RankableArticle = {
    id: 'a2',
    title: 'Seoul real estate prices rise 3%',
    contextTags: ['부동산', '서울', '아파트'],
    publishedAt: hoursAgo(1),
    sourceType: 'rss',
  };

  it('returns 1.0 when all interests match', () => {
    expect(computeInterestMatchScore(highMatchArticle, persona)).toBe(1.0);
  });

  it('returns 0 when no interests match', () => {
    expect(computeInterestMatchScore(lowMatchArticle, persona)).toBe(0);
  });

  it('returns partial score for partial match', () => {
    const partialArticle: RankableArticle = {
      id: 'a3',
      title: 'AI chip demand grows',
      contextTags: ['ai', 'semiconductor'],
      publishedAt: hoursAgo(1),
      sourceType: 'rss',
    };
    const score = computeInterestMatchScore(partialArticle, persona);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1.0);
  });

  it('returns 0 for persona with empty interests', () => {
    const emptyPersona: Persona = { id: 'px', name: 'Empty', interests: [] };
    expect(computeInterestMatchScore(highMatchArticle, emptyPersona)).toBe(0);
  });
});

// ─── Signal ───────────────────────────────────────────────────────────────────

describe('computeSignalScore', () => {
  it('returns higher signal for GitHub trending with many stars', () => {
    const trending: RankableArticle = {
      id: 't1',
      title: 'Trending repo',
      contextTags: [],
      publishedAt: hoursAgo(1),
      sourceType: 'github',
      isGithubTrending: true,
      githubStarsDelta: 5000,
      sourceCount: 1,
    };
    expect(computeSignalScore(trending)).toBeGreaterThan(0.7);
  });

  it('returns higher signal for multi-source articles', () => {
    const multiSource: RankableArticle = {
      id: 'm1',
      title: 'Multi-source story',
      contextTags: [],
      publishedAt: hoursAgo(1),
      sourceType: 'rss',
      sourceCount: 10,
    };
    const singleSource: RankableArticle = { ...multiSource, id: 'm2', sourceCount: 1 };
    expect(computeSignalScore(multiSource)).toBeGreaterThan(computeSignalScore(singleSource));
  });

  it('clamps to 1.0 even with extreme values', () => {
    const extreme: RankableArticle = {
      id: 'e1',
      title: 'Extreme',
      contextTags: [],
      publishedAt: hoursAgo(1),
      sourceType: 'github',
      isGithubTrending: true,
      githubStarsDelta: 999_999,
      sourceCount: 999,
    };
    expect(computeSignalScore(extreme)).toBeLessThanOrEqual(1.0);
  });
});

// ─── Full scoreArticle ────────────────────────────────────────────────────────

describe('scoreArticle', () => {
  const persona: Persona = {
    id: 'p1',
    name: 'Investor',
    interests: ['ai', 'llm'],
  };

  const freshArticle: RankableArticle = {
    id: 'fresh',
    title: 'AI LLM breakthrough',
    contextTags: ['ai', 'llm'],
    publishedAt: hoursAgo(1),
    sourceType: 'arxiv',
    sourceCount: 3,
  };

  it('computes a score within a reasonable range', () => {
    const { score } = scoreArticle(freshArticle, persona, SEEN_NONE);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(2.0);
  });

  it('seen penalty reduces score', () => {
    const seenSet = new Set(['fresh']);
    const unseenScore = scoreArticle(freshArticle, persona, SEEN_NONE).score;
    const seenScore = scoreArticle(freshArticle, persona, seenSet).score;
    expect(seenScore).toBeLessThan(unseenScore);
  });

  it('known input → deterministic output (same call twice = same score)', () => {
    const s1 = scoreArticle(freshArticle, persona, SEEN_NONE).score;
    const s2 = scoreArticle(freshArticle, persona, SEEN_NONE).score;
    expect(s1).toBe(s2);
  });
});

// ─── rankArticles (persona differentiation) ───────────────────────────────────

describe('rankArticles', () => {
  const aiArticle: RankableArticle = {
    id: 'ai-1',
    title: 'ChatGPT gains 100M users',
    contextTags: ['ai', 'llm', 'openai'],
    publishedAt: hoursAgo(2),
    sourceType: 'rss',
    sourceCount: 5,
  };

  const realEstateArticle: RankableArticle = {
    id: 're-1',
    title: '서울 강남 아파트 신고가',
    contextTags: ['부동산', '서울', '아파트', '강남'],
    publishedAt: hoursAgo(2),
    sourceType: 'rss',
    sourceCount: 5,
  };

  const articles = [aiArticle, realEstateArticle];

  it('ranks AI article first for AI persona', () => {
    const aiPersona: Persona = { id: 'ai', name: 'AI Researcher', interests: ['ai', 'llm', 'openai'] };
    const results = rankArticles(articles, aiPersona, SEEN_NONE);
    expect(results[0].articleId).toBe('ai-1');
  });

  it('ranks real estate article first for real estate persona', () => {
    const rePersona: Persona = { id: 're', name: 'Property Investor', interests: ['부동산', '아파트', '강남'] };
    const results = rankArticles(articles, rePersona, SEEN_NONE);
    expect(results[0].articleId).toBe('re-1');
  });

  it('same article pool, different personas → different top results', () => {
    const aiPersona: Persona = { id: 'ai', name: 'AI Researcher', interests: ['ai', 'llm', 'openai'] };
    const rePersona: Persona = { id: 're', name: 'Property Investor', interests: ['부동산', '아파트', '강남'] };

    const aiResults = rankArticles(articles, aiPersona, SEEN_NONE);
    const reResults = rankArticles(articles, rePersona, SEEN_NONE);

    expect(aiResults[0].articleId).not.toBe(reResults[0].articleId);
  });

  it('assigns sequential rank numbers starting at 1', () => {
    const persona: Persona = { id: 'p', name: 'Generic', interests: [] };
    const results = rankArticles(articles, persona, SEEN_NONE);
    results.forEach((r, i) => expect(r.rank).toBe(i + 1));
  });

  it('is deterministic — same inputs produce identical ranking', () => {
    const persona: Persona = { id: 'p', name: 'Generic', interests: ['ai'] };
    const r1 = rankArticles(articles, persona, SEEN_NONE).map((r) => r.articleId);
    const r2 = rankArticles(articles, persona, SEEN_NONE).map((r) => r.articleId);
    expect(r1).toEqual(r2);
  });

  it('no LLM call — pure synchronous execution', () => {
    const persona: Persona = { id: 'p', name: 'Generic', interests: [] };
    const result = rankArticles(articles, persona, SEEN_NONE);
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });
});
