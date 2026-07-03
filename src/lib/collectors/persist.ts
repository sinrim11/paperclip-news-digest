import { prisma } from '../db';
import type { RawArticle } from '../types';

export async function persistArticles(articles: RawArticle[], sourceType: string): Promise<number> {
  let count = 0;
  for (const a of articles) {
    if (!a.url || !a.title) continue;
    try {
      await prisma.article.upsert({
        where: { url: a.url },
        update: { title: a.title, content: a.content ?? null, publishedAt: a.publishedAt ? new Date(a.publishedAt) : null },
        create: {
          title: a.title,
          url: a.url,
          sourceType,
          category: a.category ?? null,
          content: a.content ?? null,
          publishedAt: a.publishedAt ? new Date(a.publishedAt) : null,
          metadata: {
            source: a.source,
            isGithubTrending: a.isGithubTrending ?? false,
            githubStarsDelta: a.githubStarsDelta ?? null,
            githubLanguage: a.githubLanguage ?? null,
          },
        },
      });
      count++;
    } catch {
      // skip individual upsert failures
    }
  }
  return count;
}

export async function persistEntityStats(articles: RawArticle[], sourceType: string): Promise<void> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (const a of articles) {
    if (!a.title) continue;
    try {
      await prisma.entityStat.upsert({
        where: { entityName_entityType_statDate: { entityName: a.title.slice(0, 200), entityType: sourceType, statDate: today } },
        update: { metrics: { url: a.url, source: a.source } },
        create: {
          entityName: a.title.slice(0, 200),
          entityType: sourceType,
          statDate: today,
          metrics: { url: a.url, source: a.source, githubStarsDelta: a.githubStarsDelta ?? null },
        },
      });
    } catch {
      // skip individual failures
    }
  }
}
