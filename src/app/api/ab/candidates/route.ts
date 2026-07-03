import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// Persona keywords for scoring (from READER_PROFILE)
const PERSONA_KEYWORDS: Record<string, number> = {
  반도체: 3, 한미반도체: 5, HBM: 5, CoWoS: 4, 메모리: 2,
  원자력: 3, 원전: 4, 두산: 4, SMR: 5, APR1400: 4, 에너지: 2,
  연금: 3, DC연금: 5, ETF: 3, TDF: 4,
  부동산: 3, 아파트: 3, 서울: 2, 분당: 3, 판교: 3, DSR: 4, 금리: 2,
};

const PERSONA_NAME = '반도체·원전·연금·부동산 투자자';

function scoreItem(item: { title: string; fact: string; impact: string; contextTags: string[] }): number {
  const text = [item.title, item.fact, item.impact, ...item.contextTags].join(' ');
  let score = 0;
  for (const [kw, weight] of Object.entries(PERSONA_KEYWORDS)) {
    if (text.includes(kw)) score += weight;
  }
  return score;
}

export async function GET() {
  // Find the most recent completed digest
  const digest = await prisma.dailyDigest.findFirst({
    where: { status: 'done', archived: false },
    orderBy: { date: 'desc' },
    include: {
      newsItems: {
        where: { archived: false },
        orderBy: [{ category: 'asc' }, { newsOrder: 'asc' }],
      },
    },
  });

  if (!digest) {
    return NextResponse.json({ error: 'No digest available' }, { status: 404 });
  }

  const items = digest.newsItems.map((n) => ({
    id: n.id,
    category: n.category,
    newsOrder: n.newsOrder,
    title: n.title,
    urgency: n.urgency,
    fact: n.fact,
    impact: n.impact,
    action: n.action,
    contextTags: n.contextTags,
    source: n.source,
    sourceUrl: n.sourceUrl,
    isTop3: n.isTop3,
  }));

  // A: standard order (top 10 by newsOrder across all categories)
  const snapshotA = items.slice(0, 10);

  // B: persona-scored re-ranking (top 10 by score desc)
  const scored = items.map((item) => ({ ...item, _score: scoreItem(item) }));
  scored.sort((a, b) => b._score - a._score || a.newsOrder - b.newsOrder);
  const scoresB: Record<string, number> = {};
  for (const item of scored) {
    scoresB[item.id] = item._score;
  }
  const snapshotB = scored.slice(0, 10).map(({ _score: _s, ...rest }) => rest);

  return NextResponse.json({
    digestDate: digest.date.toISOString().slice(0, 10),
    personaName: PERSONA_NAME,
    snapshotA,
    snapshotB,
    scoresB,
  });
}
