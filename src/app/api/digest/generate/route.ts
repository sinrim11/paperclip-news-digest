/**
 * POST /api/digest/generate
 *
 * Main orchestration:
 * 1. Collect market data via Ollama
 * 2. Fetch RSS articles per category
 * 3. Run 5 category prompts in parallel (Promise.allSettled)
 * 4. Select TOP 3 with a second LLM pass
 * 5. Persist everything to PostgreSQL
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { chatJSON } from '@/lib/llm';
import { collectByCategory } from '@/lib/news-collector';
import { buildMarketPrompt, buildCategoryPrompt, buildTop3Prompt } from '@/lib/prompts/daily-digest';
import {
  CATEGORIES,
  toCategoryLabel,
  type CategoryKey,
  type Category,
  type MarketSnapshot,
  type LLMCategoryResult,
  type LLMTop3Item,
  type RawArticle,
} from '@/lib/types';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as {
    date?: string;
    force?: boolean;
    preCollectedArticles?: Record<string, RawArticle[]>; // CategoryKey → articles (bypasses RSS)
  };
  const dateStr = body.date ?? new Date().toISOString().slice(0, 10);
  const targetDate = new Date(dateStr);
  targetDate.setUTCHours(0, 0, 0, 0);

  // ── Guard: skip if already done (unless forced) ──────────────────────────
  const existing = await prisma.dailyDigest.findFirst({ where: { date: targetDate } });
  if (existing?.status === 'done' && !body.force) {
    return NextResponse.json({ message: 'Already generated', digestId: existing.id }, { status: 200 });
  }

  // ── Create / reset DailyDigest record ────────────────────────────────────
  const digest = existing
    ? await prisma.dailyDigest.update({ where: { id: existing.id }, data: { status: 'in_progress' } })
    : await prisma.dailyDigest.create({ data: { date: targetDate, status: 'in_progress' } });

  try {
    // ── Step 1: Market data ────────────────────────────────────────────────
    let marketSnapshot: MarketSnapshot | undefined;
    try {
      const mResult = await chatJSON<MarketSnapshot>(buildMarketPrompt(dateStr), { temperature: 0.1 });
      marketSnapshot = mResult;
      await prisma.marketDaily.upsert({
        where: { digestId: digest.id },
        create: {
          digestId: digest.id,
          date: targetDate,
          kospiValue: mResult.kospi.value,    kospiChange: mResult.kospi.change,    kospiDir: mResult.kospi.direction,
          kosdaqValue: mResult.kosdaq.value,  kosdaqChange: mResult.kosdaq.change,  kosdaqDir: mResult.kosdaq.direction,
          usdKrwValue: mResult.usdKrw.value,  usdKrwChange: mResult.usdKrw.change,  usdKrwDir: mResult.usdKrw.direction,
          wtiValue: mResult.wti.value,        wtiChange: mResult.wti.change,        wtiDir: mResult.wti.direction,
          us10yValue: mResult.us10y.value,    us10yChange: mResult.us10y.change,    us10yDir: mResult.us10y.direction,
          btcUsdValue: mResult.btcUsd.value,  btcUsdChange: mResult.btcUsd.change,  btcUsdDir: mResult.btcUsd.direction,
        },
        update: {
          kospiValue: mResult.kospi.value,    kospiChange: mResult.kospi.change,
          kosdaqValue: mResult.kosdaq.value,  kosdaqChange: mResult.kosdaq.change,
          usdKrwValue: mResult.usdKrw.value,  usdKrwChange: mResult.usdKrw.change,
          wtiValue: mResult.wti.value,        wtiChange: mResult.wti.change,
          us10yValue: mResult.us10y.value,    us10yChange: mResult.us10y.change,
          btcUsdValue: mResult.btcUsd.value,  btcUsdChange: mResult.btcUsd.change,
        },
      });
    } catch (err) {
      console.error('[generate] market step failed:', err);
    }

    // ── Step 2: Collect articles (RSS or pre-collected) ───────────────────
    const articlesByCategory: Map<CategoryKey, RawArticle[]> = body.preCollectedArticles
      ? new Map(Object.entries(body.preCollectedArticles) as [CategoryKey, RawArticle[]][])
      : await collectByCategory(12);

    // ── Step 3: Category LLM calls (sequential — rate-limit safe) ──────────
    // Running sequentially avoids hammering the Anthropic API rate limit
    // and gives each category the full 60s timeout budget.
    type SettledResult = { status: 'fulfilled'; value: LLMCategoryResult } | { status: 'rejected'; reason: unknown };
    const categoryResults: SettledResult[] = [];

    for (const catKey of CATEGORIES) {
      const articles = articlesByCategory.get(catKey) ?? [];
      if (articles.length === 0) {
        console.warn(`[generate] ${catKey}: 0 RSS articles — LLM will use training-data fallback`);
      }
      const koreanLabel = toCategoryLabel(catKey);
      const msgs = buildCategoryPrompt(dateStr, koreanLabel, articles, marketSnapshot);

      let settled: SettledResult = { status: 'rejected', reason: new Error('not started') };
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const value = await chatJSON<LLMCategoryResult>(msgs, { temperature: 0.3, maxTokens: 4096 });
          settled = { status: 'fulfilled', value };
          break;
        } catch (err) {
          if (attempt === 1) {
            settled = { status: 'rejected', reason: err };
          } else {
            console.warn(`[generate] ${catKey} attempt 1 failed, retrying:`, err);
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
      }
      categoryResults.push(settled);
      console.log(`[generate] ${catKey}: ${settled.status}`);
    }

    // ── Step 4: Persist category briefings + news items ───────────────────
    const successfulCategories: LLMCategoryResult[] = [];

    for (let i = 0; i < CATEGORIES.length; i++) {
      const result = categoryResults[i];
      const catKey = CATEGORIES[i];

      if (result.status === 'rejected') {
        console.error(`[generate] category ${catKey} failed:`, result.reason);
        continue;
      }

      const llmCat = result.value;
      successfulCategories.push(llmCat);

      // Upsert CategoryBriefing
      const briefing = await prisma.categoryBriefing.upsert({
        where: { digestId_category: { digestId: digest.id, category: catKey } },
        create: { digestId: digest.id, category: catKey, summary: llmCat.summary, newsCount: llmCat.items.length },
        update: { summary: llmCat.summary, newsCount: llmCat.items.length },
      });

      // Delete old items for this category then bulk-create
      await prisma.newsItem.deleteMany({
        where: { digestId: digest.id, category: catKey },
      });

      const itemsToCreate = llmCat.items.slice(0, 10).map((item, idx) => ({
        digestId: digest.id,
        categoryBriefingId: briefing.id,
        category: catKey,
        newsOrder: idx + 1,
        title:       item.title       ?? '',
        urgency:     item.urgency     ?? 'note',
        fact:        item.fact        ?? '',
        impact:      item.impact      ?? '',
        action:      item.action      ?? '',
        contextTags: item.contextTags ?? [],
        source:      item.source      ?? '',
        sourceUrl:   item.sourceUrl   ?? '',
        isTop3: false,
        relatedData: [],
        contextLinks: [],
        upcomingEvents: [],
      }));

      await prisma.newsItem.createMany({ data: itemsToCreate });

      // Update context tag history
      for (const tag of llmCat.items.flatMap((it) => it.contextTags)) {
        await prisma.contextTagHistory.upsert({
          where: { tag },
          create: { tag, count: 1, lastSeenDate: targetDate },
          update: { count: { increment: 1 }, lastSeenDate: targetDate },
        });
      }
    }

    // ── Step 5: TOP 3 selection ───────────────────────────────────────────
    if (successfulCategories.length > 0) {
      try {
        const top3Input = successfulCategories.map((c) => ({
          category: c.category as Category,
          items: c.items.map((it) => ({
            title: it.title,
            urgency: it.urgency,
            fact: it.fact,
            impact: it.impact,
            action: it.action,
          })),
        }));

        const top3Result = await chatJSON<{ top3: LLMTop3Item[] }>(
          buildTop3Prompt(dateStr, top3Input),
          { temperature: 0.2, maxTokens: 2048 },
        );

        // Mark TOP 3 items in the DB
        for (const topItem of top3Result.top3.slice(0, 3)) {
          await prisma.newsItem.updateMany({
            where: {
              digestId: digest.id,
              title: topItem.title,
            },
            data: {
              isTop3: true,
              top3Rank: topItem.rank,
              relatedData: topItem.relatedData ?? [],
              contextLinks: topItem.contextLinks ?? [],
              upcomingEvents: topItem.upcomingEvents ?? [],
            },
          });
        }
      } catch (err) {
        console.error('[generate] top3 step failed:', err);
      }
    }

    // ── Finalise ─────────────────────────────────────────────────────────
    await prisma.dailyDigest.update({ where: { id: digest.id }, data: { status: 'done' } });

    return NextResponse.json({ digestId: digest.id, date: dateStr, status: 'done' });
  } catch (err) {
    await prisma.dailyDigest.update({ where: { id: digest.id }, data: { status: 'failed' } });
    console.error('[generate] fatal error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
