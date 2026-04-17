/**
 * EntityStat aggregator — extracts entity stats from a digest's NewsItems
 * and upserts into the EntityStat table (one row per entity+type+date).
 *
 * Metrics stored per entity per day:
 *   mentions    — how many news items reference this tag
 *   sentiment   — avg score: breaking=-0.5, watch=0.0, note=0.3
 *   sourceCount — total cross-source count (sum of item.sourceCount)
 *   signals     — GitHub star deltas for trending repos
 *   sourceList  — deduplicated list of source names
 */

import { PrismaClient } from '@prisma/client';

const URGENCY_SENTIMENT: Record<string, number> = {
  breaking: -0.5,
  watch: 0.0,
  note: 0.3,
};

const COMPANY_TOKENS = [
  'openai', 'anthropic', 'google', 'meta', 'apple', 'samsung', 'nvidia',
  'microsoft', 'amazon', 'tesla', 'bytedance', 'baidu', 'tencent', 'alibaba',
  '삼성', '현대', 'sk', 'lg', '카카오', '네이버',
];
const ASSET_TOKENS = [
  'usd', 'krw', 'eur', 'jpy', 'btc', 'eth', 'wti', 'oil', 'gold',
  'kospi', 'kosdaq', 'nasdaq', 's&p', 'dow', 'nikkei',
];
const CONCEPT_TOKENS = [
  'ai', 'llm', 'gpu', 'api', 'ipo', 'etf', 'pf', 'gdp', 'inflation',
  'mortgage', 'lease', 'sanction', 'regulation', 'policy', '금리', '인플레',
];

function inferEntityType(tag: string): string {
  const lower = tag.toLowerCase();
  if (ASSET_TOKENS.some((t) => lower === t || lower.startsWith(t + '/'))) return 'asset';
  if (COMPANY_TOKENS.some((t) => lower.includes(t))) return 'company';
  if (CONCEPT_TOKENS.some((t) => lower.includes(t))) return 'concept';
  return 'entity';
}

interface EntityAccumulator {
  mentions: number;
  sentimentSum: number;
  sourceCount: number;
  signals: number;
  sources: Set<string>;
}

export async function aggregateEntityStats(
  digestId: string,
  statDate: Date,
  prismaClient?: PrismaClient,
): Promise<number> {
  const prisma = prismaClient ?? new PrismaClient();
  const ownPrisma = !prismaClient;

  try {
    const newsItems = await prisma.newsItem.findMany({
      where: { digestId },
      select: {
        contextTags: true,
        urgency: true,
        sourceCount: true,
        isGithubTrending: true,
        githubStarsDelta: true,
        source: true,
      },
    });

    const entityMap = new Map<string, EntityAccumulator>();

    for (const item of newsItems) {
      const sentimentScore = URGENCY_SENTIMENT[item.urgency] ?? 0;
      const starSignal = item.isGithubTrending && item.githubStarsDelta ? item.githubStarsDelta : 0;

      for (const rawTag of item.contextTags) {
        const tag = rawTag.toLowerCase().trim();
        if (!tag || tag.length < 2) continue;

        let acc = entityMap.get(tag);
        if (!acc) {
          acc = { mentions: 0, sentimentSum: 0, sourceCount: 0, signals: 0, sources: new Set() };
          entityMap.set(tag, acc);
        }

        acc.mentions += 1;
        acc.sentimentSum += sentimentScore;
        acc.sourceCount += item.sourceCount ?? 1;
        acc.signals += starSignal;
        if (item.source) acc.sources.add(item.source);
      }
    }

    const dateOnly = new Date(statDate);
    dateOnly.setUTCHours(0, 0, 0, 0);

    let upserted = 0;
    for (const [entityName, acc] of entityMap.entries()) {
      const entityType = inferEntityType(entityName);
      const metrics = {
        mentions: acc.mentions,
        sentiment: acc.mentions > 0 ? Math.round((acc.sentimentSum / acc.mentions) * 100) / 100 : 0,
        sourceCount: acc.sourceCount,
        signals: acc.signals,
        sourceList: [...acc.sources],
      };

      await prisma.entityStat.upsert({
        where: { entityName_entityType_statDate: { entityName, entityType, statDate: dateOnly } },
        create: { entityName, entityType, statDate: dateOnly, metrics },
        update: { metrics },
      });
      upserted++;
    }

    console.log(`[entity-stat] ${dateOnly.toISOString().slice(0, 10)}: ${upserted} entities aggregated`);
    return upserted;
  } finally {
    if (ownPrisma) await prisma.$disconnect();
  }
}
