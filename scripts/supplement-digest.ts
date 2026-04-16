/**
 * Supplement an under-filled daily digest.
 * Usage: npx tsx scripts/supplement-digest.ts [date]
 * Default date: 2026-04-17
 *
 * For each category with < 10 items, calls Claude (web search enabled)
 * to collect additional real news and inserts them directly into the DB.
 */

import { PrismaClient } from '@prisma/client';
import { chatJSON } from '../src/lib/claude';

const prisma = new PrismaClient();

const TARGET_DATE = process.argv[2] ?? '2026-04-17';
const TARGET_PER_CAT = 10;

const CATEGORY_LABELS: Record<string, string> = {
  GLOBAL:    '글로벌 국제',
  STOCKS:    '주식·금융·증권',
  AI:        'AI·인공지능·테크',
  POLICY:    '한국 정부정책·정치',
  REALESTATE: '한국 부동산',
};

interface SupplementItem {
  title: string;
  urgency: 'breaking' | 'watch' | 'note';
  fact: string;
  impact: string;
  action: string;
  contextTags: string[];
  source: string;
  sourceUrl: string;
}

async function generateSupplements(
  category: string,
  label: string,
  date: string,
  needed: number,
  existing: string[],
): Promise<SupplementItem[]> {
  const existingList = existing.length > 0
    ? `\n이미 수집된 기사 제목 (중복 금지):\n${existing.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
    : '';

  const messages = [
    {
      role: 'system' as const,
      content: `너는 한국어 뉴스 큐레이터다. ${date} 날짜 기준 실제 뉴스를 웹 검색으로 수집해 JSON으로 반환한다.
규칙:
- 실제 기사 기반 뉴스만 출력. 없으면 근접 날짜 뉴스 허용.
- 순수 JSON 배열만 출력. 마크다운 없이.
- urgency는 "breaking", "watch", "note" 중 하나.`,
    },
    {
      role: 'user' as const,
      content: `${date} 날짜 기준 ${label} 카테고리 주요 뉴스 ${needed}건을 웹 검색해서 수집하세요.${existingList}

출력 형식 (순수 JSON 배열):
[
  {
    "title": "뉴스 제목",
    "urgency": "breaking|watch|note",
    "fact": "핵심 사실 1문장",
    "impact": "영향 1문장",
    "action": "행동 지침 1문장",
    "contextTags": ["태그1", "태그2"],
    "source": "출처명",
    "sourceUrl": "https://..."
  }
]`,
    },
  ];

  try {
    const result = await chatJSON<SupplementItem[]>(messages, {
      temperature: 0.3,
      maxTokens: 8192,
      useWebSearch: true,
    });
    return Array.isArray(result) ? result.slice(0, needed) : [];
  } catch (err) {
    console.error(`[supplement] ${category} failed:`, err);
    return [];
  }
}

async function main() {
  const targetDate = new Date(TARGET_DATE);
  targetDate.setUTCHours(0, 0, 0, 0);

  const digest = await prisma.dailyDigest.findFirst({
    where: { date: targetDate, archived: false },
  });

  if (!digest) {
    console.error(`No digest found for ${TARGET_DATE}`);
    process.exit(1);
  }

  console.log(`Digest ID: ${digest.id}, status: ${digest.status}`);

  const allItems = await prisma.newsItem.findMany({
    where: { digestId: digest.id },
    select: { category: true, title: true, newsOrder: true },
    orderBy: { newsOrder: 'asc' },
  });

  const countByCategory = new Map<string, number>();
  const titlesByCategory = new Map<string, string[]>();
  for (const item of allItems) {
    countByCategory.set(item.category, (countByCategory.get(item.category) ?? 0) + 1);
    if (!titlesByCategory.has(item.category)) titlesByCategory.set(item.category, []);
    titlesByCategory.get(item.category)!.push(item.title);
  }

  console.log('\nCurrent counts:');
  for (const [cat, label] of Object.entries(CATEGORY_LABELS)) {
    console.log(`  ${cat}: ${countByCategory.get(cat) ?? 0} (label: ${label})`);
  }

  for (const [category, label] of Object.entries(CATEGORY_LABELS)) {
    const current = countByCategory.get(category) ?? 0;
    const needed = TARGET_PER_CAT - current;
    if (needed <= 0) {
      console.log(`\n[${category}] already at ${current} — skipping`);
      continue;
    }

    console.log(`\n[${category}] need ${needed} more items (current: ${current})`);

    const briefing = await prisma.categoryBriefing.findFirst({
      where: { digestId: digest.id, category: category as any },
    });
    if (!briefing) {
      console.warn(`  No briefing found for ${category} — skipping`);
      continue;
    }

    const existing = titlesByCategory.get(category) ?? [];
    const supplements = await generateSupplements(category, label, TARGET_DATE, needed, existing);

    if (supplements.length === 0) {
      console.warn(`  No supplements generated for ${category}`);
      continue;
    }

    console.log(`  Got ${supplements.length} supplements`);

    const itemsToCreate = supplements.map((item, idx) => ({
      digestId: digest.id,
      categoryBriefingId: briefing.id,
      category: category as any,
      newsOrder: current + idx + 1,
      title: item.title ?? '',
      urgency: (item.urgency ?? 'note') as any,
      fact: item.fact ?? '',
      impact: item.impact ?? '',
      action: item.action ?? '',
      contextTags: item.contextTags ?? [],
      source: item.source ?? '',
      sourceUrl: item.sourceUrl ?? '',
      isTop3: false,
      relatedData: [],
      contextLinks: [],
      upcomingEvents: [],
      sourceCount: 1,
      sourceList: [item.source ?? ''],
    }));

    await prisma.newsItem.createMany({ data: itemsToCreate });

    // Update briefing count
    await prisma.categoryBriefing.update({
      where: { id: briefing.id },
      data: { newsCount: current + supplements.length },
    });

    console.log(`  Inserted ${itemsToCreate.length} items for ${category}`);
  }

  // Final count
  const finalCount = await prisma.newsItem.count({ where: { digestId: digest.id } });
  console.log(`\nFinal total: ${finalCount} items`);

  const finalByCategory = await prisma.newsItem.groupBy({
    by: ['category'],
    where: { digestId: digest.id },
    _count: { id: true },
  });
  for (const row of finalByCategory) {
    console.log(`  ${row.category}: ${row._count.id}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  prisma.$disconnect();
  process.exit(1);
});
