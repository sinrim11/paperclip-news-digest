/**
 * Supplement an under-filled daily digest.
 * Usage: npx tsx scripts/supplement-digest.ts [date]
 * Default date: 2026-04-18
 *
 * For each category with < 10 items, calls LM Studio to generate
 * additional training-data-based news items and inserts them into the DB.
 */

import { PrismaClient } from '@prisma/client';
import { chatJSON } from '../src/lib/llm';

const prisma = new PrismaClient();

const TARGET_DATE = process.argv[2] ?? '2026-04-18';
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

function normalizeUrgency(u: unknown): 'breaking' | 'watch' | 'note' {
  if (u === 'breaking' || u === 'critical' || u === 'urgent') return 'breaking';
  if (u === 'watch' || u === 'warning') return 'watch';
  return 'note';
}

async function generateSupplements(
  category: string,
  label: string,
  date: string,
  needed: number,
  existing: string[],
): Promise<SupplementItem[]> {
  const existingList = existing.length > 0
    ? `\n기존 제목 (중복 금지):\n${existing.map((t) => `- ${t}`).join('\n')}`
    : '';

  const messages = [
    {
      role: 'system' as const,
      content: '반드시 한국어로 JSON만 출력. 마크다운·코드블록 금지. urgency는 "breaking", "watch", "note" 중 하나.',
    },
    {
      role: 'user' as const,
      content: `날짜: ${date}\n카테고리: ${label}\n\n현재 ${existing.length}건이 있습니다. 아래 기존 제목과 겹치지 않는 새로운 뉴스 ${needed}건을 ${date} 기준 학습 데이터에서 생성하세요.${existingList}

반드시 ${needed}건 출력, 순수 JSON:
{"items":[{"title":"...","urgency":"watch","fact":"1문장","impact":"1문장","action":"1문장","contextTags":["태그"],"source":"출처명","sourceUrl":"https://example.com"}]}`,
    },
  ];

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await chatJSON<{ items?: SupplementItem[] } | SupplementItem[]>(messages, {
        temperature: 0.6,
        maxTokens: 3000,
      });
      let items: SupplementItem[];
      if (Array.isArray(result)) {
        items = result;
      } else if (result && typeof result === 'object' && Array.isArray((result as { items?: SupplementItem[] }).items)) {
        items = (result as { items: SupplementItem[] }).items;
      } else {
        console.warn(`  [${category}] attempt ${attempt + 1}: unexpected response shape`);
        continue;
      }
      const valid = items.filter(i => i.title).map(i => ({
        ...i,
        urgency: normalizeUrgency(i.urgency) as 'breaking' | 'watch' | 'note',
      }));
      if (valid.length > 0) return valid.slice(0, needed);
    } catch (err) {
      console.error(`  [${category}] attempt ${attempt + 1} failed:`, err);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return [];
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
      sourceCount: 0,
      sourceList: [],
      consensusFacts: null,
      conflictingFacts: null,
      isGithubTrending: false,
      githubStarsDelta: null,
      githubLanguage: null,
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
