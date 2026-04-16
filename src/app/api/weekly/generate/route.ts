/**
 * POST /api/weekly/generate
 * Synthesises the past 7 daily digests into a weekly briefing (Phase 4 full spec).
 *
 * Queries: DailyDigest TOP3, breaking NewsItems, CategoryBriefing summaries,
 *          MarketDaily (7 days), ContextTagHistory (active in the past 7 days).
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { chatJSON } from '@/lib/claude';
import { buildWeeklyPrompt } from '@/lib/prompts/weekly-digest';
import type { WeeklyDigestContent, Category } from '@/lib/types';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as { weekStart?: string };

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

    // ── 1. Fetch all needed data in parallel ──────────────────────────────────
    const [dailyDigests, breakingNews, marketRows, activeTags] = await Promise.all([
      prisma.dailyDigest.findMany({
        where: { date: { gte: weekStartDate, lte: weekEndDate }, status: 'done' },
        orderBy: { date: 'asc' },
        include: {
          categoryBriefings: true,
          newsItems: { where: { isTop3: true }, orderBy: { top3Rank: 'asc' } },
        },
      }),

      // Breaking news across the week
      prisma.newsItem.findMany({
        where: {
          urgency: 'breaking',
          digest: { date: { gte: weekStartDate, lte: weekEndDate } },
        },
        select: { title: true, category: true, digest: { select: { date: true } } },
        orderBy: { createdAt: 'desc' },
      }),

      // Market snapshots for the week
      prisma.marketDaily.findMany({
        where: { date: { gte: weekStartDate, lte: weekEndDate } },
        orderBy: { date: 'asc' },
      }),

      // Context tags active in the past 7 days
      prisma.contextTagHistory.findMany({
        where: { lastSeenDate: { gte: new Date(weekEndDate.getTime() - 7 * 86_400_000) } },
        orderBy: { count: 'desc' },
        take: 20,
      }),
    ]);

    if (!dailyDigests.length) {
      return NextResponse.json({ error: 'No daily digests found for this week' }, { status: 404 });
    }

    const weekStart = weekStartDate.toISOString().slice(0, 10);
    const weekEnd = weekEndDate.toISOString().slice(0, 10);

    // ── 2. Per-day input enriched with breaking news ──────────────────────────
    const breakingByDate = new Map<string, string[]>();
    for (const item of breakingNews) {
      const date = (item.digest as { date: Date }).date.toISOString().slice(0, 10);
      const list = breakingByDate.get(date) ?? [];
      list.push(item.title);
      breakingByDate.set(date, list);
    }

    const days = dailyDigests.map((d) => {
      const dateStr = d.date.toISOString().slice(0, 10);
      return {
        date: dateStr,
        top3Titles: d.newsItems.map((n) => n.title),
        categoryBriefings: d.categoryBriefings.map((cb) => ({
          category: cb.category as unknown as Category,
          summary: cb.summary,
        })),
        breakingTitles: breakingByDate.get(dateStr) ?? [],
      };
    });

    // ── 3. Market summary ─────────────────────────────────────────────────────
    const marketData = marketRows.map((m) => ({
      date: m.date.toISOString().slice(0, 10),
      kospi: m.kospiValue != null ? `${m.kospiValue}(${m.kospiChange ?? ''})` : undefined,
      kosdaq: m.kosdaqValue != null ? `${m.kosdaqValue}(${m.kosdaqChange ?? ''})` : undefined,
      usdKrw: m.usdKrwValue != null ? `${m.usdKrwValue}(${m.usdKrwChange ?? ''})` : undefined,
      wti: m.wtiValue != null ? `${m.wtiValue}(${m.wtiChange ?? ''})` : undefined,
      us10y: m.us10yValue != null ? `${m.us10yValue}(${m.us10yChange ?? ''})` : undefined,
      btcUsd: m.btcUsdValue != null ? `${m.btcUsdValue}(${m.btcUsdChange ?? ''})` : undefined,
    }));

    const activeTagNames = activeTags.map((t) => t.tag);

    // ── 4. Call LLM (max_tokens: 8192 per Phase 4 spec) ───────────────────────
    const content = await chatJSON<WeeklyDigestContent>(
      buildWeeklyPrompt(weekStart, weekEnd, days, marketData, activeTagNames),
      { temperature: 0.3, maxTokens: 8192 },
    );

    // ── 5. Save WeeklyDigest ──────────────────────────────────────────────────
    const weekly = await prisma.weeklyDigest.create({
      data: { weekStart: weekStartDate, weekEnd: weekEndDate, content: content as unknown as object },
    });

    return NextResponse.json({
      weeklyId: weekly.id,
      weekStart,
      weekEnd,
      // Phase 4 content fields surfaced for Slack notifications
      executive_summary: content.executive_summary ?? null,
      weekly_top5: content.weekly_top5 ?? null,
    });
  } catch (err) {
    console.error('[weekly/generate] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error', detail: String(err) },
      { status: 500 },
    );
  }
}
