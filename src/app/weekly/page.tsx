import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function WeeklyPage() {
  const latest = await prisma.weeklyDigest.findFirst({
    orderBy: { weekStart: 'desc' },
  }).catch(() => null);

  if (!latest) {
    return (
      <div className="text-center py-20 text-gray-400">
        <p className="text-6xl mb-4">📆</p>
        <p className="text-xl">주간 브리핑이 아직 없습니다.</p>
      </div>
    );
  }

  const content = latest.content as {
    headline: string;
    categoryRecaps: Array<{ category: string; summary: string; keyItems: string[] }>;
    topTrends: Array<{ tag: string; count: number; description: string }>;
    outlook: string;
  };

  const ws = new Date(latest.weekStart);
  const we = new Date(latest.weekEnd);
  const fmt = (d: Date) => d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold">{fmt(ws)} ~ {fmt(we)} 주간 브리핑</h2>
        <p className="text-gray-600 mt-2 text-lg">{content.headline}</p>
      </div>

      <section>
        <h3 className="font-bold text-lg mb-4">카테고리별 주간 총평</h3>
        <div className="space-y-4">
          {content.categoryRecaps?.map((recap) => (
            <div key={recap.category} className="bg-white rounded-xl border border-gray-200 p-5">
              <h4 className="font-semibold mb-2">{recap.category}</h4>
              <p className="text-sm text-gray-700 mb-3">{recap.summary}</p>
              <ul className="text-sm text-gray-500 space-y-1">
                {recap.keyItems?.map((item, i) => (
                  <li key={i}>• {item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {content.topTrends?.length > 0 && (
        <section>
          <h3 className="font-bold text-lg mb-4">이번 주 반복된 트렌드</h3>
          <div className="grid md:grid-cols-2 gap-4">
            {content.topTrends.map((trend) => (
              <div key={trend.tag} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-blue-600">#{trend.tag}</span>
                  <span className="text-xs text-gray-400">{trend.count}회 언급</span>
                </div>
                <p className="text-sm text-gray-600">{trend.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="bg-blue-50 border border-blue-200 rounded-xl p-6">
        <h3 className="font-bold text-lg mb-2">📅 다음 주 전망</h3>
        <p className="text-sm text-gray-700">{content.outlook}</p>
      </section>
    </div>
  );
}
