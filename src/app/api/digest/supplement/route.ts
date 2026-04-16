/**
 * POST /api/digest/supplement
 * Adds missing news items to an under-filled digest without touching existing items.
 * Body: { date?: string, targetPerCategory?: number }
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { chatJSON } from '@/lib/llm';
import { CATEGORIES, type CategoryKey } from '@/lib/types';

const CATEGORY_SEARCH_LABEL: Record<CategoryKey, string> = {
  GLOBAL:    '글로벌 국제뉴스 (미국, 유럽, 중동, 아시아)',
  STOCKS:    '주식 금융 증권 시장뉴스 (미국증시, 한국증시, 환율, 채권)',
  AI:        'AI 인공지능 테크뉴스 (LLM, 생성AI, 빅테크)',
  POLICY:    '한국 정부정책 정치뉴스',
  REALESTATE:'한국 부동산뉴스',
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

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { date?: string; targetPerCategory?: number };
  const dateStr = body.date ?? new Date().toISOString().slice(0, 10);
  const targetPerCat = body.targetPerCategory ?? 10;

  const targetDate = new Date(dateStr);
  targetDate.setUTCHours(0, 0, 0, 0);

  const digest = await prisma.dailyDigest.findFirst({ where: { date: targetDate, archived: false } });
  if (!digest) {
    return NextResponse.json({ error: `No digest for ${dateStr}` }, { status: 404 });
  }

  const results: Record<string, number> = {};

  for (const catKey of CATEGORIES) {
    const currentCount = await prisma.newsItem.count({ where: { digestId: digest.id, category: catKey } });
    const needed = targetPerCat - currentCount;

    if (needed <= 0) {
      results[catKey] = currentCount;
      continue;
    }

    console.log(`[supplement] ${catKey}: current=${currentCount}, need ${needed} more`);

    const existingTitles = await prisma.newsItem.findMany({
      where: { digestId: digest.id, category: catKey },
      select: { title: true },
    });
    const excludeList = existingTitles.map((it, i) => `${i + 1}. ${it.title}`).join('\n');

    const briefing = await prisma.categoryBriefing.findFirst({
      where: { digestId: digest.id, category: catKey },
    });
    if (!briefing) {
      console.warn(`[supplement] ${catKey}: no briefing — skipping`);
      results[catKey] = currentCount;
      continue;
    }

    const label = CATEGORY_SEARCH_LABEL[catKey];
    const messages = [
      {
        role: 'system' as const,
        content: `너는 한국어 뉴스 큐레이터다. 웹 검색으로 ${dateStr} 전후 실제 뉴스를 찾아 JSON 배열만 출력한다. 마크다운 없이 순수 JSON만.`,
      },
      {
        role: 'user' as const,
        content: `${dateStr} 기준 ${label} 뉴스 ${needed}건을 웹 검색으로 수집하세요.

중복 제외 목록:
${excludeList || '(없음)'}

출력 형식 (순수 JSON 배열, ${needed}건):
[
  {
    "title": "뉴스 제목",
    "urgency": "breaking|watch|note",
    "fact": "핵심 사실 1문장",
    "impact": "영향 1문장",
    "action": "행동 지침 (~검토|~주시|~대비) 1문장",
    "contextTags": ["태그1", "태그2"],
    "source": "출처명",
    "sourceUrl": "https://..."
  }
]`,
      },
    ];

    let items: SupplementItem[] = [];
    try {
      items = await chatJSON<SupplementItem[]>(messages, {
        temperature: 0.3,
        maxTokens: 8192,
      });
      if (!Array.isArray(items)) items = [];
      items = items.slice(0, needed);
    } catch (err) {
      console.error(`[supplement] ${catKey} LLM failed:`, err);
      results[catKey] = currentCount;
      continue;
    }

    if (items.length === 0) {
      results[catKey] = currentCount;
      continue;
    }

    await prisma.newsItem.createMany({
      data: items.map((item, idx) => ({
        digestId: digest.id,
        categoryBriefingId: briefing.id,
        category: catKey,
        newsOrder: currentCount + idx + 1,
        title: item.title ?? '',
        urgency: (item.urgency ?? 'note') as 'breaking' | 'watch' | 'note',
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
      })),
    });

    await prisma.categoryBriefing.update({
      where: { id: briefing.id },
      data: { newsCount: currentCount + items.length },
    });

    console.log(`[supplement] ${catKey}: inserted ${items.length}`);
    results[catKey] = currentCount + items.length;
  }

  const total = Object.values(results).reduce((a, b) => a + b, 0);
  return NextResponse.json({ date: dateStr, digestId: digest.id, results, total });
}
