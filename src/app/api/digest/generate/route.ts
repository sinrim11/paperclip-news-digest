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
import { collectByCategory, clusterArticles } from '@/lib/news-collector';
import { fetchRealMarketData } from '@/lib/market-fetcher';
import { buildCategoryPrompt, buildTop3Prompt } from '@/lib/prompts/daily-digest';
import {
  CATEGORIES,
  toCategoryLabel,
  type CategoryKey,
  type Category,
  type MarketSnapshot,
  type LLMCategoryResult,
  type LLMTop3Item,
  type RawArticle,
  type RawCluster,
} from '@/lib/types';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as {
    date?: string;
    force?: boolean;
    preCollectedArticles?: Record<string, RawArticle[]>;
  };
  const dateStr = body.date ?? new Date().toISOString().slice(0, 10);
  const targetDate = new Date(dateStr);
  targetDate.setUTCHours(0, 0, 0, 0);

  // ── Guard: skip if already done (unless forced) ──────────────────────────
  // CMP-131: only consider non-archived digests as "existing"
  const existing = await prisma.dailyDigest.findFirst({ where: { date: targetDate, archived: false } });
  if (existing?.status === 'done' && !body.force) {
    return NextResponse.json({ message: 'Already generated', digestId: existing.id }, { status: 200 });
  }

  // ── Create / reset DailyDigest record ────────────────────────────────────
  const digest = existing
    ? await prisma.dailyDigest.update({ where: { id: existing.id }, data: { status: 'in_progress' } })
    : await prisma.dailyDigest.create({ data: { date: targetDate, status: 'in_progress' } });

  try {
    // ── Step 1: Market data (live from Yahoo Finance) ─────────────────────
    let marketSnapshot: MarketSnapshot | undefined;
    try {
      const mResult = await fetchRealMarketData(dateStr);
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
          nasdaqValue: mResult.nasdaq.value,  nasdaqChange: mResult.nasdaq.change,  nasdaqDir: mResult.nasdaq.direction,
        },
        update: {
          kospiValue: mResult.kospi.value,    kospiChange: mResult.kospi.change,    kospiDir: mResult.kospi.direction,
          kosdaqValue: mResult.kosdaq.value,  kosdaqChange: mResult.kosdaq.change,  kosdaqDir: mResult.kosdaq.direction,
          usdKrwValue: mResult.usdKrw.value,  usdKrwChange: mResult.usdKrw.change,  usdKrwDir: mResult.usdKrw.direction,
          wtiValue: mResult.wti.value,        wtiChange: mResult.wti.change,        wtiDir: mResult.wti.direction,
          us10yValue: mResult.us10y.value,    us10yChange: mResult.us10y.change,    us10yDir: mResult.us10y.direction,
          btcUsdValue: mResult.btcUsd.value,  btcUsdChange: mResult.btcUsd.change,  btcUsdDir: mResult.btcUsd.direction,
          nasdaqValue: mResult.nasdaq.value,  nasdaqChange: mResult.nasdaq.change,  nasdaqDir: mResult.nasdaq.direction,
        },
      });
    } catch (err) {
      console.error('[generate] market step failed:', err);
    }

    // ── Step 2: Collect and cluster articles ─────────────────────────────
    const clustersByCategory: Map<CategoryKey, RawCluster[]> = body.preCollectedArticles
      ? new Map(
          Object.entries(body.preCollectedArticles).map(([cat, arts]) => [
            cat as CategoryKey,
            clusterArticles(arts as RawArticle[], 12),
          ]),
        )
      : await collectByCategory(12);

    // ── Step 3: Category LLM calls (sequential — rate-limit safe) ──────────
    // Running sequentially avoids hammering the Anthropic API rate limit
    // and gives each category the full 60s timeout budget.
    type SettledResult = { status: 'fulfilled'; value: LLMCategoryResult } | { status: 'rejected'; reason: unknown };
    const categoryResults: SettledResult[] = [];

    for (const catKey of CATEGORIES) {
      const clusters = clustersByCategory.get(catKey) ?? [];
      if (clusters.length === 0) {
        console.warn(`[generate] ${catKey}: 0 clusters — LLM will use training-data fallback`);
      }
      const multiCount = clusters.filter((c) => c.sourceCount >= 2).length;
      console.log(`[generate] ${catKey}: ${clusters.length} clusters (${multiCount} multi-source)`);
      const koreanLabel = toCategoryLabel(catKey);
      const msgs = buildCategoryPrompt(dateStr, koreanLabel, clusters, marketSnapshot);

      let settled: SettledResult = { status: 'rejected', reason: new Error('not started') };
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const value = await chatJSON<LLMCategoryResult>(msgs, { temperature: 0.3, maxTokens: 12288 });
          if (value?.items?.length > 0) {
            settled = { status: 'fulfilled', value };
            break;
          }
          console.warn(`[generate] ${catKey} attempt ${attempt + 1}: 0 items returned, retrying`);
        } catch (err) {
          console.warn(`[generate] ${catKey} attempt ${attempt + 1} failed:`, err);
        }
        if (attempt < 2) await new Promise((r) => setTimeout(r, 3000));
        else settled = { status: 'rejected', reason: new Error(`${catKey}: all 3 attempts failed or empty`) };
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

      // Delete old items for this category then bulk-create
      await prisma.newsItem.deleteMany({
        where: { digestId: digest.id, category: catKey },
      });

      // Build cluster lookup by normalised title prefix for fast matching
      const catClusters = clustersByCategory.get(catKey) ?? [];
      const clusterMap = new Map<string, RawCluster>();
      for (const c of catClusters) {
        clusterMap.set(c.title.trim().toLowerCase(), c);
      }

      // Sort LLM items by urgency; dedup by title
      const urgencyOrder: Record<string, number> = { breaking: 0, watch: 1, note: 2 };
      const seenTitles = new Set<string>();
      const dedupedItems = llmCat.items.filter((item) => {
        const key = (item.title ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (seenTitles.has(key)) return false;
        seenTitles.add(key);
        return true;
      });
      dedupedItems.sort((a, b) => (urgencyOrder[a.urgency] ?? 2) - (urgencyOrder[b.urgency] ?? 2));
      const finalItems = dedupedItems.slice(0, 10);

      // Upsert CategoryBriefing
      const briefing = await prisma.categoryBriefing.upsert({
        where: { digestId_category: { digestId: digest.id, category: catKey } },
        create: { digestId: digest.id, category: catKey, summary: llmCat.summary, newsCount: finalItems.length },
        update: { summary: llmCat.summary, newsCount: finalItems.length },
      });

      const itemsToCreate = finalItems.map((item, idx) => {
        // Match LLM item back to original cluster (exact then prefix-20)
        const itemTitleKey = (item.title ?? '').trim().toLowerCase();
        let cluster = clusterMap.get(itemTitleKey);
        if (!cluster) {
          for (const [k, c] of clusterMap.entries()) {
            if (k.slice(0, 20) === itemTitleKey.slice(0, 20)) { cluster = c; break; }
          }
        }

        return {
          digestId: digest.id,
          categoryBriefingId: briefing.id,
          category: catKey,
          newsOrder: idx + 1,
          title:            item.title        ?? '',
          urgency:          item.urgency      ?? 'note',
          fact:             item.fact         ?? '',
          impact:           item.impact       ?? '',
          action:           item.action       ?? '',
          contextTags:      item.contextTags  ?? [],
          source:           item.source       ?? '',
          sourceUrl:        item.sourceUrl    ?? '',
          isTop3: false,
          relatedData: [],
          contextLinks: [],
          upcomingEvents: [],
          // Cluster-sourced metadata (authoritative)
          sourceCount:      cluster?.sourceCount          ?? 1,
          sourceList:       cluster?.sourceList           ?? [],
          // LLM-generated consensus/conflict (from merged-content analysis)
          consensusFacts:   item.consensusFacts           ?? null,
          conflictingFacts: item.conflictingFacts         ?? null,
          // GitHub Trending passthrough
          isGithubTrending: cluster?.isGithubTrending     ?? false,
          githubStarsDelta: cluster?.githubStarsDelta     ?? null,
          githubLanguage:   cluster?.githubLanguage       ?? null,
        };
      });

      await prisma.newsItem.createMany({ data: itemsToCreate });

      // Update context tag history
      for (const tag of llmCat.items.flatMap((it) => it.contextTags ?? []).filter(Boolean)) {
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
        // Fetch all persisted items so we can match by DB id instead of title
        const allDbItems = await prisma.newsItem.findMany({
          where: { digestId: digest.id },
          select: { id: true, title: true, category: true },
          orderBy: [{ category: 'asc' }, { newsOrder: 'asc' }],
        });

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

        let top3Result: { top3: LLMTop3Item[] } | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            top3Result = await chatJSON<{ top3: LLMTop3Item[] }>(
              buildTop3Prompt(dateStr, top3Input),
              { temperature: 0.2, maxTokens: 8192 },
            );
            if (top3Result?.top3?.length > 0) break;
            console.warn(`[generate] top3 attempt ${attempt + 1}: empty top3 array, retrying`);
            top3Result = null;
          } catch (err) {
            console.warn(`[generate] top3 attempt ${attempt + 1} failed:`, err);
            if (attempt < 2) await new Promise((r) => setTimeout(r, 3000));
          }
        }

        if (!top3Result?.top3?.length) {
          console.error('[generate] top3: all attempts returned empty — skipping');
        }

        // Match TOP 3 items by closest title (LLM may slightly alter titles)
        for (const topItem of (top3Result?.top3 ?? []).slice(0, 3)) {
          const normalizedTop = topItem.title.trim().toLowerCase();
          const match = allDbItems.find(
            (db) => db.title.trim().toLowerCase() === normalizedTop,
          ) ?? allDbItems.find(
            (db) => normalizedTop.includes(db.title.trim().toLowerCase().slice(0, 15))
              || db.title.trim().toLowerCase().includes(normalizedTop.slice(0, 15)),
          );

          if (match) {
            await prisma.newsItem.update({
              where: { id: match.id },
              data: {
                isTop3: true,
                top3Rank: topItem.rank,
                relatedData: topItem.relatedData ?? [],
                contextLinks: topItem.contextLinks ?? [],
                upcomingEvents: topItem.upcomingEvents ?? [],
              },
            });
          } else {
            console.warn(`[generate] top3: no DB match for "${topItem.title}"`);
          }
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
