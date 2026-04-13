import { prisma } from '@/lib/db';
import { WeeklyView } from '@/components/WeeklyView';
import { IssueTimeline, type TimelineNewsItem } from '@/components/IssueTimeline';
import { WeeklyGenerateButton } from '@/components/WeeklyGenerateButton';
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
      <div className="flex flex-col items-center py-12">
        <div className="w-full max-w-lg rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-sm text-3xl">
            📆
          </div>
          <h2 className="mb-2 text-lg font-semibold text-gray-800">주간 브리핑이 아직 없습니다</h2>
          <p className="mb-6 text-sm leading-relaxed text-gray-500">
            지난 7일간 뉴스를 카테고리별 트렌드·주요 이슈·시장 흐름으로 종합 정리합니다.
          </p>
          <WeeklyGenerateButton />
          <p className="mt-4 text-xs text-gray-400">
            ⏰ 주간 브리핑은 매주 월요일 오전 8시(KST) 자동 생성됩니다
          </p>
        </div>
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
