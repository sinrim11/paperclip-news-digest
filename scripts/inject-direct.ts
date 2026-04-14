/**
 * scripts/inject-direct.ts
 *
 * Direct injection — reads raw JSON, calls Ollama, writes to DB via Prisma.
 * Bypasses the HTTP layer to avoid UND_ERR_HEADERS_TIMEOUT on slow Ollama calls.
 *
 * Usage:
 *   node_modules/.bin/tsx --env-file=.env.local scripts/inject-direct.ts 2026-04-14
 *   node_modules/.bin/tsx --env-file=.env.local scripts/inject-direct.ts 2026-04-14 STOCKS,POLICY,REALESTATE
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { chatJSON } from '../src/lib/llm';
import { buildCategoryPrompt, buildTop3Prompt } from '../src/lib/prompts/daily-digest';
import {
  CATEGORIES,
  toCategoryLabel,
  type CategoryKey,
  type LLMCategoryResult,
  type LLMTop3Item,
  type Category,
} from '../src/lib/types';

const prisma = new PrismaClient();

const CATEGORY_MAP: Record<string, CategoryKey> = {
  '글로벌': 'GLOBAL',
  '증권': 'STOCKS',
  'AI': 'AI',
  '정부정책': 'POLICY',
  '부동산': 'REALESTATE',
};

interface RawJsonItem {
  title: string;
  url: string;
  published_date?: string;
  summary?: string;
  full_content?: string;
  category: string;
  source_name?: string;
}

interface RawArticle {
  title: string;
  content: string;
  url: string;
  source: string;
  category: CategoryKey;
}

async function main() {
  const dateArg = process.argv[2];
  if (!dateArg) {
    console.error('Usage: inject-direct.ts <YYYY-MM-DD> [CAT1,CAT2,...]');
    process.exit(1);
  }

  // Optional: comma-separated list of CategoryKeys to process
  const targetCats: CategoryKey[] | null = process.argv[3]
    ? (process.argv[3].split(',') as CategoryKey[])
    : null;

  const targetDate = new Date(dateArg);
  targetDate.setUTCHours(0, 0, 0, 0);

  const fileSuffix = dateArg.replace(/-/g, '');
  const rawPath = join(process.cwd(), 'output', `raw_${fileSuffix}.json`);

  console.log(`[direct] Reading ${rawPath}...`);
  const raw: RawJsonItem[] = JSON.parse(readFileSync(rawPath, 'utf-8'));
  console.log(`[direct] Loaded ${raw.length} raw articles`);

  // Group by CategoryKey
  const byCategory: Record<string, RawArticle[]> = {};
  for (const item of raw) {
    const catKey = CATEGORY_MAP[item.category] ?? 'GLOBAL';
    if (!byCategory[catKey]) byCategory[catKey] = [];
    byCategory[catKey].push({
      title: item.title,
      content: (item.full_content ?? item.summary ?? '').slice(0, 3000),
      url: item.url,
      source: item.source_name ?? '알 수 없음',
      category: catKey as CategoryKey,
    });
  }

  console.log('[direct] Category distribution:', Object.fromEntries(
    Object.entries(byCategory).map(([k, v]) => [k, v.length])
  ));

  // Find or create digest
  let digest = await prisma.dailyDigest.findFirst({ where: { date: targetDate } });
  if (!digest) {
    console.log('[direct] Creating new DailyDigest...');
    digest = await prisma.dailyDigest.create({ data: { date: targetDate, status: 'in_progress' } });
  } else {
    console.log(`[direct] Found digest ${digest.id}, status: ${digest.status}`);
    await prisma.dailyDigest.update({ where: { id: digest.id }, data: { status: 'in_progress' } });
  }

  const categoriesToProcess = targetCats ?? CATEGORIES;
  console.log(`[direct] Processing categories: ${categoriesToProcess.join(', ')}`);

  const successfulCategories: LLMCategoryResult[] = [];

  for (const catKey of categoriesToProcess) {
    const articles = byCategory[catKey] ?? [];
    console.log(`\n[direct] === ${catKey} (${articles.length} articles) ===`);

    const koreanLabel = toCategoryLabel(catKey);
    const msgs = buildCategoryPrompt(dateArg, koreanLabel, articles);

    let result: LLMCategoryResult | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        console.log(`[direct] ${catKey}: calling Ollama (attempt ${attempt + 1})...`);
        result = await chatJSON<LLMCategoryResult>(msgs, { temperature: 0.3, maxTokens: 4096 });
        console.log(`[direct] ${catKey}: OK — ${result.items?.length ?? 0} items`);
        break;
      } catch (err) {
        if (attempt === 1) {
          console.error(`[direct] ${catKey}: FAILED after 2 attempts:`, err);
        } else {
          console.warn(`[direct] ${catKey}: attempt 1 failed, retrying in 3s...`, String(err));
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }

    if (!result) continue;
    successfulCategories.push(result);

    // Upsert CategoryBriefing
    const briefing = await prisma.categoryBriefing.upsert({
      where: { digestId_category: { digestId: digest.id, category: catKey } },
      create: { digestId: digest.id, category: catKey, summary: result.summary ?? '', newsCount: result.items?.length ?? 0 },
      update: { summary: result.summary ?? '', newsCount: result.items?.length ?? 0 },
    });

    // Delete old items for this category, then bulk-create
    await prisma.newsItem.deleteMany({ where: { digestId: digest.id, category: catKey } });

    const items = (result.items ?? []).slice(0, 10).map((item, idx) => ({
      digestId: digest!.id,
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

    await prisma.newsItem.createMany({ data: items });
    console.log(`[direct] ${catKey}: saved ${items.length} items to DB`);
  }

  // TOP3 selection if we have categories
  if (successfulCategories.length > 0) {
    try {
      console.log('\n[direct] Running TOP3 selection...');
      const top3Input = successfulCategories.map((c) => ({
        category: c.category as Category,
        items: c.items.map((it) => ({
          title: it.title, urgency: it.urgency,
          fact: it.fact, impact: it.impact, action: it.action,
        })),
      }));

      const top3Result = await chatJSON<{ top3: LLMTop3Item[] }>(
        buildTop3Prompt(dateArg, top3Input),
        { temperature: 0.2, maxTokens: 2048 },
      );

      for (const topItem of (top3Result.top3 ?? []).slice(0, 3)) {
        await prisma.newsItem.updateMany({
          where: { digestId: digest.id, title: topItem.title },
          data: {
            isTop3: true,
            top3Rank: topItem.rank,
            relatedData: topItem.relatedData ?? [],
            contextLinks: topItem.contextLinks ?? [],
            upcomingEvents: topItem.upcomingEvents ?? [],
          },
        });
      }
      console.log(`[direct] TOP3 selection done (${top3Result.top3?.length ?? 0} items marked)`);
    } catch (err) {
      console.error('[direct] TOP3 step failed (non-fatal):', err);
    }
  }

  // Mark digest done
  await prisma.dailyDigest.update({ where: { id: digest.id }, data: { status: 'done' } });
  console.log('\n[direct] ✅ Done! Digest marked as done.');

  // Print final DB state
  const cats = await prisma.categoryBriefing.findMany({
    where: { digestId: digest.id },
    include: { _count: { select: { newsItems: true } } },
  });
  console.log('[direct] Final category summary:');
  for (const c of cats) {
    console.log(`  ${c.category}: ${c._count.newsItems} items`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[direct] Fatal error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
