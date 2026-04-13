import { prisma } from '@/lib/db';
import { CATEGORIES, CATEGORY_LABEL, type CategoryKey } from '@/lib/types';
import { DateNavigator } from '@/components/DateNavigator';
import { MarketDashboard } from '@/components/MarketDashboard';
import { TopHighlights, type Top3Item } from '@/components/TopHighlights';
import { CategoryTabs, type CategoryTabData } from '@/components/CategoryTabs';
import { GenerateButton } from '@/components/GenerateButton';

export const dynamic = 'force-dynamic';

/** Return today's date in KST (UTC+9) as YYYY-MM-DD */
function todayKST(): string {
  const d = new Date();
  d.setTime(d.getTime() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export default async function HomePage({
  searchParams,
}: {
  searchParams?: { date?: string };
}) {
  const today = todayKST();
  const dateStr = searchParams?.date ?? today;

  // Clamp to valid date
  const targetDate = new Date(dateStr);
  if (isNaN(targetDate.getTime())) {
    return <p className="text-red-500 p-8">잘못된 날짜입니다.</p>;
  }
  targetDate.setUTCHours(0, 0, 0, 0);

  // Fetch digest + available dates in parallel
  const [digest, recentDigests] = await Promise.all([
    prisma.dailyDigest
      .findFirst({
        where: { date: targetDate },
        include: {
          marketDaily: true,
          categoryBriefings: true,
          newsItems: { orderBy: [{ category: 'asc' }, { newsOrder: 'asc' }] },
        },
      })
      .catch(() => null),
    prisma.dailyDigest
      .findMany({
        where: { status: 'done' },
        select: { date: true },
        orderBy: { date: 'desc' },
        take: 60,
      })
      .catch(() => []),
  ]);

  const availableDates = recentDigests.map((d) =>
    d.date.toISOString().slice(0, 10),
  );
  // Always include today so navigator shows it even before first digest
  if (!availableDates.includes(today)) availableDates.push(today);

  // ── Build TOP 3 ────────────────────────────────────────────────────────────
  const top3Items: Top3Item[] =
    digest?.newsItems
      .filter((n) => n.isTop3)
      .sort((a, b) => (a.top3Rank ?? 9) - (b.top3Rank ?? 9))
      .map((n) => ({
        id: n.id,
        title: n.title,
        category: n.category as CategoryKey,
        urgency: n.urgency as 'breaking' | 'watch' | 'note',
        top3Rank: n.top3Rank ?? 0,
        fact: n.fact,
        impact: n.impact,
        action: n.action,
        relatedData: n.relatedData,
        contextLinks: n.contextLinks,
        upcomingEvents: n.upcomingEvents,
        sourceUrl: n.sourceUrl,
      })) ?? [];

  // ── Build category tabs (fix: compare DB enum key, not Korean label) ───────
  const categoryTabs: CategoryTabData[] = CATEGORIES.flatMap((catKey) => {
    const items = digest?.newsItems.filter((n) => n.category === catKey) ?? [];
    if (!items.length) return [];
    const briefing = digest?.categoryBriefings.find((cb) => cb.category === catKey);
    return [
      {
        key: catKey,
        summary: briefing?.summary ?? '',
        items: items.map((n) => ({
          id: n.id,
          title: n.title,
          urgency: n.urgency as 'breaking' | 'watch' | 'note',
          fact: n.fact,
          impact: n.impact,
          action: n.action,
          contextTags: n.contextTags,
          source: n.source,
          sourceUrl: n.sourceUrl,
          isTop3: n.isTop3,
          top3Rank: n.top3Rank,
        })),
      },
    ];
  });

  return (
    <div className="space-y-8">
      {/* Header row: date nav + generate button */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <DateNavigator currentDate={dateStr} availableDates={availableDates} />
        {!digest && <GenerateButton date={dateStr} />}
      </div>

      {/* Empty state */}
      {!digest && (
        <div className="text-center py-20 text-gray-400">
          <p className="text-6xl mb-4">📭</p>
          <p className="text-xl">
            {dateStr === today
              ? '오늘의 브리핑이 아직 없습니다.'
              : `${dateStr} 브리핑이 없습니다.`}
          </p>
          <p className="text-sm mt-2">
            {dateStr === today
              ? '위 버튼을 눌러 지금 생성하거나 크론이 자동 실행됩니다.'
              : '해당 날짜의 데이터가 저장되지 않았습니다.'}
          </p>
        </div>
      )}

      {/* Digest in progress */}
      {digest?.status === 'in_progress' && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
          ⏳ 브리핑을 생성하고 있습니다. 잠시 후 새로고침 해주세요.
        </div>
      )}

      {digest?.status === 'failed' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between">
          <span className="text-sm text-red-700">❌ 브리핑 생성에 실패했습니다.</span>
          <GenerateButton date={dateStr} />
        </div>
      )}

      {digest && digest.status === 'done' && (
        <>
          {/* Market snapshot */}
          {digest.marketDaily && (
            <MarketDashboard market={digest.marketDaily} />
          )}

          {/* TOP 3 */}
          {top3Items.length > 0 && <TopHighlights items={top3Items} />}

          {/* Stats bar */}
          {categoryTabs.length > 0 && (
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span>총 {digest.newsItems.length}건</span>
              <span>·</span>
              {categoryTabs.map((c) => (
                <span key={c.key}>
                  {CATEGORY_LABEL[c.key]} {c.items.length}
                </span>
              ))}
            </div>
          )}

          {/* Category tabs */}
          {categoryTabs.length > 0 && <CategoryTabs categories={categoryTabs} />}
        </>
      )}
    </div>
  );
}
