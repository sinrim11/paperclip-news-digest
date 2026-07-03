import { prisma } from '@/lib/db';
import { chatJSON } from '@/lib/llm';
import { rankArticles } from '@/lib/ranker';
import type { Persona, RankableArticle } from '@/lib/ranker';

// ─── Synthetic Personas ───────────────────────────────────────────────────────

const PERSONAS: Persona[] = [
  {
    id: 'A',
    name: 'AI 개발자',
    interests: ['llm', 'gpt', 'gpu', 'pytorch', 'transformer', '반도체', 'agent', 'inference'],
  },
  {
    id: 'B',
    name: '부동산 투자자',
    interests: ['아파트', '매매', '금리', 'dsr', 'ltv', '분양', '전세', '재개발'],
  },
  {
    id: 'C',
    name: '글로벌 정치 애널리스트',
    interests: ['지정학', '무역', '제재', 'nato', 'g7', '외교', '관세', '안보'],
  },
];

const TOP_K = 20;

// ─── Types ────────────────────────────────────────────────────────────────────

interface RankedItem {
  newsItemId: string;
  rank: number;
  rationale: string;
}

interface ClusterHeadline {
  headline: string;
  articleIds: string[];
}

interface LLMRerankResponse {
  reranked: Array<{ id: string; rank: number; rationale: string }>;
  clusters: Array<{ headline: string; articleIds: string[] }>;
}

// ─── LLM Rerank ───────────────────────────────────────────────────────────────

async function llmRerank(
  persona: Persona,
  articles: Array<{ id: string; title: string; tags: string[] }>,
): Promise<{ rankedItems: RankedItem[]; clusterHeadlines: ClusterHeadline[] }> {
  const articleList = articles.map((a, i) => ({
    id: a.id,
    index: i + 1,
    title: a.title,
    tags: a.tags.slice(0, 5),
  }));

  const messages = [
    {
      role: 'system' as const,
      content:
        '당신은 뉴스 큐레이션 전문가입니다. 반드시 유효한 JSON으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요.',
    },
    {
      role: 'user' as const,
      content: `페르소나: ${persona.name}
관심사: ${persona.interests.join(', ')}

다음 뉴스 기사 목록을 이 페르소나에게 가장 유용한 순서로 재정렬하고, 각 항목에 한국어로 한줄 이유를 작성하세요.
또한 관련성이 높은 기사들을 2~4개 클러스터로 묶어 대표 제목을 한국어로 생성하세요.

기사 목록:
${JSON.stringify(articleList, null, 2)}

응답 형식 (JSON만):
{
  "reranked": [{"id": "기사ID", "rank": 1, "rationale": "한줄 이유"}],
  "clusters": [{"headline": "클러스터 대표 제목", "articleIds": ["id1", "id2"]}]
}`,
    },
  ];

  // Wrap with a timeout since ChatOptions has no timeout field
  const result = await Promise.race<LLMRerankResponse>([
    chatJSON<LLMRerankResponse>(messages, { temperature: 0.3, maxTokens: 2048 }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('llmRerank timeout')), 120_000),
    ),
  ]);

  const rankedItems: RankedItem[] = (result.reranked ?? []).map((item) => ({
    newsItemId: item.id,
    rank: item.rank,
    rationale: item.rationale ?? '',
  }));

  const clusterHeadlines: ClusterHeadline[] = (result.clusters ?? []).map((c) => ({
    headline: c.headline ?? '',
    articleIds: c.articleIds ?? [],
  }));

  return { rankedItems, clusterHeadlines };
}

// ─── Fallback (deterministic only) ────────────────────────────────────────────

function deterministicFallback(
  persona: Persona,
  articles: Array<{ id: string; title: string; tags: string[]; publishedAt: Date; sourceType: string; githubStarsDelta?: number; isGithubTrending?: boolean; sourceCount?: number }>,
): { rankedItems: RankedItem[]; clusterHeadlines: ClusterHeadline[] } {
  const rankable: RankableArticle[] = articles.map((a) => ({
    id: a.id,
    title: a.title,
    contextTags: a.tags,
    publishedAt: a.publishedAt,
    sourceType: a.sourceType,
    githubStarsDelta: a.githubStarsDelta,
    isGithubTrending: a.isGithubTrending,
    sourceCount: a.sourceCount,
  }));

  const results = rankArticles(rankable, persona, new Set());

  const rankedItems: RankedItem[] = results.map((r) => ({
    newsItemId: r.articleId,
    rank: r.rank,
    rationale: '',
  }));

  return { rankedItems, clusterHeadlines: [] };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface RerankerOptions {
  digestDate?: string; // "YYYY-MM-DD", defaults to today KST
  hardDeadline?: Date; // abort after this time
}

export interface PersonaRerankerResult {
  personaId: string;
  personaName: string;
  usedFallback: boolean;
  itemCount: number;
}

export async function runPersonaRerank(
  options: RerankerOptions = {},
): Promise<PersonaRerankerResult[]> {
  const kst = new Date();
  kst.setTime(kst.getTime() + 9 * 60 * 60 * 1000);
  const dateStr = options.digestDate ?? kst.toISOString().slice(0, 10);

  const digest = await prisma.dailyDigest.findUnique({
    where: { date: new Date(dateStr) },
    include: {
      newsItems: {
        where: { archived: false },
        select: {
          id: true,
          title: true,
          contextTags: true,
          category: true,
          urgency: true,
          sourceCount: true,
          isGithubTrending: true,
          githubStarsDelta: true,
          createdAt: true,
        },
      },
    },
  });

  if (!digest) throw new Error(`No digest found for ${dateStr}`);

  const articles = digest.newsItems.map((item) => ({
    id: item.id,
    title: item.title,
    tags: item.contextTags,
    publishedAt: item.createdAt,
    sourceType: item.category.toLowerCase(),
    sourceCount: item.sourceCount,
    isGithubTrending: item.isGithubTrending,
    githubStarsDelta: item.githubStarsDelta ?? undefined,
  }));

  const results: PersonaRerankerResult[] = [];

  for (const persona of PERSONAS) {
    const isTimedOut = options.hardDeadline ? new Date() >= options.hardDeadline : false;
    let rankedItems: RankedItem[];
    let clusterHeadlines: ClusterHeadline[];
    let usedFallback = false;

    // Take top-K by deterministic rank for LLM input
    const rankable: RankableArticle[] = articles.map((a) => ({
      id: a.id,
      title: a.title,
      contextTags: a.tags,
      publishedAt: a.publishedAt,
      sourceType: a.sourceType,
      sourceCount: a.sourceCount,
      isGithubTrending: a.isGithubTrending,
      githubStarsDelta: a.githubStarsDelta,
    }));
    const topK = rankArticles(rankable, persona, new Set())
      .slice(0, TOP_K)
      .map((r) => {
        const art = articles.find((a) => a.id === r.articleId)!;
        return { id: art.id, title: art.title, tags: art.tags };
      });

    if (isTimedOut) {
      const fallback = deterministicFallback(persona, articles);
      rankedItems = fallback.rankedItems;
      clusterHeadlines = fallback.clusterHeadlines;
      usedFallback = true;
    } else {
      try {
        const llmResult = await llmRerank(persona, topK);
        rankedItems = llmResult.rankedItems;
        clusterHeadlines = llmResult.clusterHeadlines;

        // Ensure all top-K articles are present (LLM may omit some)
        const seen = new Set(rankedItems.map((r) => r.newsItemId));
        let nextRank = rankedItems.length + 1;
        for (const art of topK) {
          if (!seen.has(art.id)) {
            rankedItems.push({ newsItemId: art.id, rank: nextRank++, rationale: '' });
          }
        }
      } catch {
        const fallback = deterministicFallback(persona, articles);
        rankedItems = fallback.rankedItems;
        clusterHeadlines = fallback.clusterHeadlines;
        usedFallback = true;
      }
    }

    await prisma.personaRankResult.upsert({
      where: { digestId_personaId: { digestId: digest.id, personaId: persona.id } },
      update: {
        rankedItems: rankedItems as unknown as never,
        clusterHeadlines: clusterHeadlines as unknown as never,
        usedFallback,
        updatedAt: new Date(),
      },
      create: {
        digestId: digest.id,
        personaId: persona.id,
        personaName: persona.name,
        rankedItems: rankedItems as unknown as never,
        clusterHeadlines: clusterHeadlines as unknown as never,
        usedFallback,
      },
    });

    results.push({
      personaId: persona.id,
      personaName: persona.name,
      usedFallback,
      itemCount: rankedItems.length,
    });
  }

  return results;
}
