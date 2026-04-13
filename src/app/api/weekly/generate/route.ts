/**
 * POST /api/weekly/generate
 * Synthesises the past 7 daily digests into a weekly briefing.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { chatJSON } from '@/lib/llm';
import { buildWeeklyPrompt } from '@/lib/prompts/weekly-digest';
import type { WeeklyDigestContent, Category } from '@/lib/types';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { weekStart?: string };

  // Default: week starting 7 days ago
  const weekEndDate = new Date();
  weekEndDate.setUTCHours(0, 0, 0, 0);
  const weekStartDate = body.weekStart
    ? new Date(body.weekStart)
    : new Date(weekEndDate.getTime() - 6 * 86_400_000);

  weekStartDate.setUTCHours(0, 0, 0, 0);

  // Guard: skip if already exists
  const existing = await prisma.weeklyDigest.findFirst({ where: { weekStart: weekStartDate } });
  if (existing) {
    return NextResponse.json({ message: 'Already exists', weeklyId: existing.id }, { status: 200 });
  }

  // Fetch 7 days of daily digests
  const dailyDigests = await prisma.dailyDigest.findMany({
    where: {
      date: { gte: weekStartDate, lte: weekEndDate },
      status: 'done',
    },
    orderBy: { date: 'asc' },
    include: {
      categoryBriefings: true,
      newsItems: { where: { isTop3: true }, orderBy: { top3Rank: 'asc' } },
    },
  });

  if (!dailyDigests.length) {
    return NextResponse.json({ error: 'No daily digests found for this week' }, { status: 404 });
  }

  const weekStart = weekStartDate.toISOString().slice(0, 10);
  const weekEnd = weekEndDate.toISOString().slice(0, 10);

  const days = dailyDigests.map((d) => ({
    date: d.date.toISOString().slice(0, 10),
    top3Titles: d.newsItems.map((n) => n.title),
    categoryBriefings: d.categoryBriefings.map((cb) => ({
      category: cb.category as Category,
      summary: cb.summary,
    })),
  }));

  const content = await chatJSON<WeeklyDigestContent>(
    buildWeeklyPrompt(weekStart, weekEnd, days),
    { temperature: 0.3, maxTokens: 4096 },
  );

  const weekly = await prisma.weeklyDigest.create({
    data: { weekStart: weekStartDate, weekEnd: weekEndDate, content: content as unknown as object },
  });

  return NextResponse.json({ weeklyId: weekly.id, weekStart, weekEnd });
}
