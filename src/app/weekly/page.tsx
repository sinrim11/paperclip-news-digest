import { prisma } from '@/lib/db';
import { WeeklyView } from '@/components/WeeklyView';
import { IssueTimeline, type TimelineNewsItem } from '@/components/IssueTimeline';
import type { MarketDayData } from '@/components/MarketSparklines';
import type { WeeklyDigestContent } from '@/lib/types';
import type { CategoryKey, Urgency } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function WeeklyPage() {
  const [latest, recentDigests, marketRows] = await Promise.all([
    prisma.weeklyDigest.findFirst({ orderBy: { weekStart: 'desc' } }).catch(() => null),
    prisma.dailyDigest
      .findMany({
        where:   { status: 'done' },
        orderBy: { date: 'desc' },
        take:    7,
        select: {
          date: true,
          newsItems: {
            where:   { urgency: { in: ['breaking', 'watch'] } },
            orderBy: { newsOrder: 'asc' },
            select: {
              id:          true,
              title:       true,
              category:    true,
              urgency:     true,
              fact:        true,
              contextTags: true,
              sourceUrl:   true,
            },
          },
        },
      })
      .catch(() => []),
    prisma.marketDaily
      .findMany({
        orderBy: { date: 'desc' },
        take:    7,
        select: {
          date:        true,
          kospiValue:  true,
          kosdaqValue: true,
          usdKrwValue: true,
          wtiValue:    true,
        },
      })
      .catch(() => []),
  ]);

  if (!latest) {
    return (
      <div className="text-center py-20 text-gray-400">
        <p className="text-6xl mb-4">📆</p>
        <p className="text-xl">주간 브리핑이 아직 없습니다.</p>
      </div>
    );
  }

  const content = latest.content as unknown as WeeklyDigestContent;

  const timelineItems: TimelineNewsItem[] = recentDigests.flatMap((d) =>
    d.newsItems.map((n) => ({
      id:          n.id,
      title:       n.title,
      category:    n.category as CategoryKey,
      urgency:     n.urgency as Urgency,
      fact:        n.fact,
      contextTags: n.contextTags,
      sourceUrl:   n.sourceUrl ?? undefined,
      digestDate:  d.date.toISOString().slice(0, 10),
    }))
  );

  // Oldest → newest for sparklines
  const marketData: MarketDayData[] = [...marketRows].reverse().map((r) => ({
    date:    r.date.toISOString().slice(0, 10),
    kospi:   r.kospiValue  ?? undefined,
    kosdaq:  r.kosdaqValue ?? undefined,
    usdKrw:  r.usdKrwValue ?? undefined,
    wti:     r.wtiValue    ?? undefined,
  }));

  return (
    <div className="space-y-12">
      <WeeklyView
        content={content}
        weekStart={new Date(latest.weekStart)}
        weekEnd={new Date(latest.weekEnd)}
        marketData={marketData}
        timelineItems={timelineItems}
      />
      {timelineItems.length > 0 && <IssueTimeline items={timelineItems} />}
    </div>
  );
}
