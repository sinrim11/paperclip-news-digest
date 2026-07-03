/**
 * scripts/run-pipeline.ts
 *
 * Standalone daily-digest pipeline.
 * Reads pre-collected raw JSON → Ollama LLM → PostgreSQL.
 * No Next.js server needed.
 *
 * Usage:
 *   npx tsx scripts/run-pipeline.ts 2026-04-13
 *   npx tsx scripts/run-pipeline.ts 2026-04-14
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient, Category } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Config ──────────────────────────────────────────────────────────────────

const LLM_BASE = (process.env.LLM_BASE_URL ?? 'http://localhost:1234/v1').replace(/\/$/, '');
const LLM_MODEL = process.env.LLM_MODEL ?? 'supergemma4-26b-uncensored-mlx-v2';

// ─── Category mappings ────────────────────────────────────────────────────────

const CATEGORY_KR_TO_KEY: Record<string, string> = {
  '글로벌': 'GLOBAL',
  '증권': 'STOCKS',
  'AI': 'AI',
  '정부정책': 'POLICY',
  '부동산': 'REALESTATE',
};

const CATEGORY_KEY_TO_KR: Record<string, string> = {
  GLOBAL: '글로벌',
  STOCKS: '증권',
  AI: 'AI',
  POLICY: '정부정책',
  REALESTATE: '부동산',
};

const ALL_KEYS: Category[] = ['GLOBAL', 'STOCKS', 'AI', 'POLICY', 'REALESTATE'];

// ─── LLM helpers ──────────────────────────────────────────────────────────────

async function callLLMJSON<T>(messages: Array<{ role: string; content: string }>, temp = 0.3): Promise<T> {
  const body = {
    model: LLM_MODEL,
    messages,
    temperature: temp,
    max_tokens: 6144,
    stream: false,
  };

  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000), // 3 min per call
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`LLM error ${res.status}: ${t}`);
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  const raw = data.choices?.[0]?.message?.content ?? '';

  // Strip markdown fences
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned) as T;
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildMarketPrompt(date: string) {
  return [
    {
      role: 'system',
      content: '당신은 금융 데이터 분석가입니다. 주어진 날짜의 주요 시장 지표를 JSON 형식으로 반환합니다. 순수 JSON만 출력하세요.',
    },
    {
      role: 'user',
      content: `오늘 날짜: ${date}

다음 시장 지표의 최근 수준을 JSON으로 반환하세요.
학습 데이터 기준으로 합리적인 추정치를 제공하세요 (실시간 데이터 없음).

출력 형식 (순수 JSON, 추가 설명 없음):
{
  "date": "${date}",
  "kospi": { "value": 0, "change": "0%", "direction": "flat" },
  "kosdaq": { "value": 0, "change": "0%", "direction": "flat" },
  "usdKrw": { "value": 0, "change": "0", "direction": "flat" },
  "wti": { "value": 0, "change": "0%", "direction": "flat" },
  "us10y": { "value": 0, "change": "0", "direction": "flat" },
  "btcUsd": { "value": 0, "change": "0%", "direction": "flat" }
}

direction은 "up", "down", "flat" 중 하나입니다.`,
    },
  ];
}

function buildCategoryPrompt(date: string, category: string, articles: Array<{ title: string; content: string; url: string; source: string }>, marketCtx?: string) {
  const marketLine = marketCtx ? `\n마켓 스냅샷: ${marketCtx}` : '';
  const articlesText = articles
    .map((a, i) => `[${i + 1}] 제목: ${a.title}\n출처: ${a.source}\nURL: ${a.url}\n내용: ${a.content || '(내용 없음)'}`)
    .join('\n\n');

  return [
    {
      role: 'system',
      content: `당신은 시니어 뉴스 에디터 겸 투자 애널리스트입니다.
독자는 IT업계 시니어 개발자이면서 적극적 투자자이며, 정책과 부동산에도 관심이 많습니다.
반드시 순수 JSON만 출력하세요. 마크다운, 설명, 코드 블록 없이.`,
    },
    {
      role: 'user',
      content: `오늘 날짜: ${date}${marketLine}
카테고리: ${category}

## 수집된 뉴스 기사 (${articles.length}건)

${articlesText}

## 작업 지시

위 기사들을 분석하여 아래 JSON 구조로 반환하세요.
최대 10건을 선정하되 중복/무관 기사는 제외하세요.

긴급도 기준:
- "breaking": 오늘 즉시 포트폴리오/의사결정 영향 (카테고리당 최대 2건)
- "watch": 1~2주 내 영향 예상
- "note": 알아두면 좋은 배경 지식

맥락 태그(contextTags): 다른 카테고리 뉴스와 연결되는 키워드 (예: "미_관세", "AI_규제")
각 contextTags는 최소 1개 이상 반드시 포함하세요.
summary는 불릿 금지, 2~3문장 산문 총평으로 작성하세요.

출력 형식 (순수 JSON):
{
  "category": "${category}",
  "summary": "카테고리 전체 흐름 2~3문장 총평 (불릿 금지, 산문 필수)",
  "items": [
    {
      "title": "뉴스 제목",
      "urgency": "breaking|watch|note",
      "fact": "📌 무슨 일이 일어났는가 — 수치/날짜/주체 포함 1문장",
      "impact": "💡 왜 중요한가 — 시장/산업/사회 영향 1문장",
      "action": "🎯 독자에게 어떤 의미인가 — 구체적 행동 지침 (~검토/~주시/~대비) 1문장",
      "contextTags": ["tag1", "tag2"],
      "source": "출처명",
      "sourceUrl": "https://..."
    }
  ]
}`,
    },
  ];
}

function buildTop3Prompt(date: string, allItems: Array<{ category: string; title: string; urgency: string; fact: string; impact: string; action: string }>) {
  const itemsText = allItems
    .map((item, i) => `[${i + 1}] [${item.category}] ${item.urgency} "${item.title}"\n팩트: ${item.fact}`)
    .join('\n');

  return [
    {
      role: 'system',
      content: '당신은 시니어 투자 애널리스트입니다. 전체 뉴스 중 오늘 가장 중요한 3건을 선정합니다. 순수 JSON만 출력하세요.',
    },
    {
      role: 'user',
      content: `오늘 날짜: ${date}

## 전체 뉴스 목록

${itemsText}

## 작업 지시

전체 뉴스 중 오늘 반드시 알아야 할 TOP 3를 선정하세요.
반드시 2개 이상의 다른 카테고리에서 선정하세요.

선정 기준 (가중치 순):
1. 내 자산(주식/부동산/연금)에 직접 영향 → 최우선
2. 시장 전체 방향성에 영향 → 우선
3. 향후 1개월 내 중대한 변화 예고 → 높음
4. 산업/기술 패러다임 변화 → 보통

출력 형식 (순수 JSON):
{
  "top3": [
    {
      "rank": 1,
      "category": "카테고리명",
      "title": "뉴스 제목",
      "urgency": "breaking|watch|note",
      "fact": "팩트 1문장",
      "impact": "임팩트 1문장",
      "action": "액션 1문장",
      "contextTags": ["tag1"],
      "source": "출처",
      "sourceUrl": "https://...",
      "relatedData": ["핵심 수치 1", "핵심 수치 2"],
      "contextLinks": ["연관 카테고리 뉴스 제목"],
      "upcomingEvents": ["후속 이벤트 일정"]
    }
  ]
}`,
    },
  ];
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawJsonItem {
  title: string;
  url: string;
  published_date?: string;
  summary?: string;
  full_content?: string;
  category: string;
  source_name?: string;
}

interface LLMItem {
  title: string;
  urgency: string;
  fact: string;
  impact: string;
  action: string;
  contextTags: string[];
  source: string;
  sourceUrl: string;
}

interface LLMCategoryResult {
  category: string;
  summary: string;
  items: LLMItem[];
}

interface LLMTop3Item extends LLMItem {
  rank: number;
  category: string;
  relatedData: string[];
  contextLinks: string[];
  upcomingEvents: string[];
}

interface MarketSnapshot {
  kospi: { value: number; change: string; direction: string };
  kosdaq: { value: number; change: string; direction: string };
  usdKrw: { value: number; change: string; direction: string };
  wti: { value: number; change: string; direction: string };
  us10y: { value: number; change: string; direction: string };
  btcUsd: { value: number; change: string; direction: string };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(dateStr: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[pipeline] Starting pipeline for ${dateStr}`);
  console.log(`${'='.repeat(60)}\n`);

  const targetDate = new Date(`${dateStr}T00:00:00.000Z`);

  // Load raw JSON
  const fileSuffix = dateStr.replace(/-/g, '');
  const rawPath = join(process.cwd(), 'output', `raw_${fileSuffix}.json`);
  const rawItems: RawJsonItem[] = JSON.parse(readFileSync(rawPath, 'utf-8'));
  console.log(`[pipeline] Loaded ${rawItems.length} raw articles from ${rawPath}`);

  // Group by category
  const byCategory: Record<string, Array<{ title: string; content: string; url: string; source: string }>> = {};
  for (const item of rawItems) {
    const key = CATEGORY_KR_TO_KEY[item.category] ?? 'GLOBAL';
    if (!byCategory[key]) byCategory[key] = [];
    byCategory[key].push({
      title: item.title,
      content: (item.full_content ?? item.summary ?? '').slice(0, 2500),
      url: item.url,
      source: item.source_name ?? '알 수 없음',
    });
  }

  for (const key of ALL_KEYS) {
    console.log(`[pipeline]   ${key}: ${byCategory[key]?.length ?? 0} articles`);
  }

  // Guard: upsert DailyDigest
  const existingDigest = await prisma.dailyDigest.findFirst({ where: { date: targetDate } });
  const digest = existingDigest
    ? await prisma.dailyDigest.update({ where: { id: existingDigest.id }, data: { status: 'in_progress' } })
    : await prisma.dailyDigest.create({ data: { date: targetDate, status: 'in_progress' } });
  console.log(`[pipeline] DailyDigest id=${digest.id}`);

  // Step 1: Market data
  let marketSnapshot: MarketSnapshot | undefined;
  let marketCtxLine = '';
  try {
    console.log(`[pipeline] Step 1: Fetching market data...`);
    const mResult = await callLLMJSON<MarketSnapshot>(buildMarketPrompt(dateStr), 0.1);
    marketSnapshot = mResult;
    marketCtxLine = `KOSPI ${mResult.kospi.value} (${mResult.kospi.change}), USD/KRW ${mResult.usdKrw.value}`;
    console.log(`[pipeline]   Market: ${marketCtxLine}`);

    await prisma.marketDaily.upsert({
      where: { digestId: digest.id },
      create: {
        digestId: digest.id,
        date: targetDate,
        kospiValue: mResult.kospi.value,   kospiChange: mResult.kospi.change,   kospiDir: mResult.kospi.direction,
        kosdaqValue: mResult.kosdaq.value, kosdaqChange: mResult.kosdaq.change, kosdaqDir: mResult.kosdaq.direction,
        usdKrwValue: mResult.usdKrw.value, usdKrwChange: mResult.usdKrw.change, usdKrwDir: mResult.usdKrw.direction,
        wtiValue: mResult.wti.value,       wtiChange: mResult.wti.change,       wtiDir: mResult.wti.direction,
        us10yValue: mResult.us10y.value,   us10yChange: mResult.us10y.change,   us10yDir: mResult.us10y.direction,
        btcUsdValue: mResult.btcUsd.value, btcUsdChange: mResult.btcUsd.change, btcUsdDir: mResult.btcUsd.direction,
      },
      update: {
        kospiValue: mResult.kospi.value,   kospiChange: mResult.kospi.change,
        kosdaqValue: mResult.kosdaq.value, kosdaqChange: mResult.kosdaq.change,
        usdKrwValue: mResult.usdKrw.value, usdKrwChange: mResult.usdKrw.change,
        wtiValue: mResult.wti.value,       wtiChange: mResult.wti.change,
        us10yValue: mResult.us10y.value,   us10yChange: mResult.us10y.change,
        btcUsdValue: mResult.btcUsd.value, btcUsdChange: mResult.btcUsd.change,
      },
    });
    console.log(`[pipeline]   MarketDaily saved.`);
  } catch (err) {
    console.error(`[pipeline]   Market step failed (non-fatal):`, err);
  }

  // Step 2: Category LLM (sequential to avoid Ollama overload)
  const successfulCategories: LLMCategoryResult[] = [];

  for (const catKey of ALL_KEYS) {
    const krLabel = CATEGORY_KEY_TO_KR[catKey];
    const articles = byCategory[catKey] ?? [];
    console.log(`\n[pipeline] Step 2: ${catKey} (${krLabel}) — ${articles.length} articles`);

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const msgs = buildCategoryPrompt(dateStr, krLabel, articles, marketCtxLine || undefined);
        const result = await callLLMJSON<LLMCategoryResult>(msgs, 0.3);

        // Validate & fix quality issues inline
        if (!result.items || result.items.length === 0) throw new Error('LLM returned 0 items');

        // Ensure contextTags not empty
        result.items = result.items.map((item) => ({
          ...item,
          contextTags: item.contextTags?.length ? item.contextTags : [krLabel],
          fact: item.fact?.trim() || `${item.title}에 관한 주요 동향이 발생했습니다.`,
          impact: item.impact?.trim() || '시장 및 산업에 중요한 영향을 미칠 수 있습니다.',
          action: item.action?.trim() || '동향을 지속 모니터링하고 대응 전략을 검토하세요.',
          urgency: ['breaking', 'watch', 'note'].includes(item.urgency) ? item.urgency : 'note',
        }));

        successfulCategories.push(result);
        console.log(`[pipeline]   ${catKey}: ${result.items.length} items, summary length=${result.summary?.length ?? 0}`);

        // Upsert CategoryBriefing
        const briefing = await prisma.categoryBriefing.upsert({
          where: { digestId_category: { digestId: digest.id, category: catKey } },
          create: { digestId: digest.id, category: catKey, summary: result.summary, newsCount: result.items.length },
          update: { summary: result.summary, newsCount: result.items.length },
        });

        // Delete old items then bulk-create
        await prisma.newsItem.deleteMany({ where: { digestId: digest.id, category: catKey } });

        await prisma.newsItem.createMany({
          data: result.items.slice(0, 10).map((item, idx) => ({
            digestId: digest.id,
            categoryBriefingId: briefing.id,
            category: catKey,
            newsOrder: idx + 1,
            title: item.title,
            urgency: item.urgency as 'breaking' | 'watch' | 'note',
            fact: item.fact,
            impact: item.impact,
            action: item.action,
            contextTags: item.contextTags,
            source: item.source,
            sourceUrl: item.sourceUrl,
            isTop3: false,
            relatedData: [],
            contextLinks: [],
            upcomingEvents: [],
          })),
        });

        // Context tag history
        for (const tag of result.items.flatMap((it) => it.contextTags)) {
          await prisma.contextTagHistory.upsert({
            where: { tag },
            create: { tag, count: 1, lastSeenDate: targetDate },
            update: { count: { increment: 1 }, lastSeenDate: targetDate },
          });
        }

        console.log(`[pipeline]   ${catKey}: DB write done.`);
        break;
      } catch (err) {
        console.error(`[pipeline]   ${catKey} attempt ${attempt + 1} failed:`, err);
        if (attempt === 1) {
          console.error(`[pipeline]   ${catKey}: giving up after 2 attempts.`);
        } else {
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    }
  }

  // Step 3: TOP 3 selection
  console.log(`\n[pipeline] Step 3: TOP 3 selection (${successfulCategories.length} categories)`);
  if (successfulCategories.length > 0) {
    try {
      const allItems = successfulCategories.flatMap((c) =>
        c.items.map((item) => ({ category: c.category, ...item })),
      );
      const top3Result = await callLLMJSON<{ top3: LLMTop3Item[] }>(buildTop3Prompt(dateStr, allItems), 0.2);

      for (const topItem of top3Result.top3.slice(0, 3)) {
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
        console.log(`[pipeline]   TOP${topItem.rank}: [${topItem.category}] "${topItem.title}"`);
      }
    } catch (err) {
      console.error(`[pipeline]   TOP3 step failed (non-fatal):`, err);
    }
  }

  // Finalize
  await prisma.dailyDigest.update({ where: { id: digest.id }, data: { status: 'done' } });
  console.log(`\n[pipeline] ✅ ${dateStr} pipeline DONE. digestId=${digest.id}`);
}

async function main() {
  const dates = process.argv.slice(2);
  if (dates.length === 0) {
    console.error('Usage: npx tsx scripts/run-pipeline.ts 2026-04-13 [2026-04-14 ...]');
    process.exit(1);
  }

  try {
    for (const date of dates) {
      await run(date);
    }
    console.log('\n[pipeline] All dates complete.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[pipeline] Fatal:', err);
  prisma.$disconnect().finally(() => process.exit(1));
});
