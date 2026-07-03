/**
 * DB → Wiki bulk export script.
 *
 * Reads all completed DailyDigests from PostgreSQL and generates
 * wiki markdown pages in the llm-wiki format.
 *
 * Usage: npx tsx scripts/wiki-export.ts [--date YYYY-MM-DD]
 *   No args = export ALL done digests
 *   --date  = export single date
 */

import { PrismaClient } from '@prisma/client';
import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();
const WIKI = join(process.cwd(), 'wiki');

const CATEGORY_LABEL: Record<string, string> = {
  GLOBAL: '글로벌',
  STOCKS: '증권',
  AI: 'AI',
  POLICY: '정치',
  REALESTATE: '부동산',
};

const URGENCY_EMOJI: Record<string, string> = {
  breaking: '[!]',
  watch: '[~]',
  note: '[i]',
};

const DIRECTION_EMOJI: Record<string, string> = {
  up: '▲',
  down: '▼',
  flat: '→',
};

// ─── Entity extraction helpers ───────────────────────────────────────────────

function extractEntitiesFromNews(items: any[]): Map<string, { count: number; dates: Set<string>; categories: Set<string> }> {
  const entities = new Map<string, { count: number; dates: Set<string>; categories: Set<string> }>();

  for (const item of items) {
    const tags = item.contextTags ?? [];
    for (const tag of tags) {
      const key = tag.toLowerCase().trim();
      if (!key || key.length < 2) continue;
      if (!entities.has(key)) {
        entities.set(key, { count: 0, dates: new Set(), categories: new Set() });
      }
      const e = entities.get(key)!;
      e.count++;
      e.dates.add(item.digest?.date?.toISOString().slice(0, 10) ?? '');
      e.categories.add(item.category);
    }
  }
  return entities;
}

// ─── Daily digest page builder ───────────────────────────────────────────────

function buildDailyDigestPage(
  dateStr: string,
  market: any | null,
  briefings: any[],
  newsItems: any[],
): string {
  const lines: string[] = [];

  // Frontmatter
  lines.push('---');
  lines.push(`title: "일일 뉴스 다이제스트 ${dateStr}"`);
  lines.push(`created: ${dateStr}`);
  lines.push(`updated: ${dateStr}`);
  lines.push('type: daily-digest');
  lines.push(`tags: [daily-digest, ${briefings.map(b => CATEGORY_LABEL[b.category]?.toLowerCase() ?? b.category.toLowerCase()).join(', ')}]`);
  lines.push('---');
  lines.push('');
  lines.push(`# [NEWS] 일일 뉴스 다이제스트 — ${dateStr}`);
  lines.push('');

  // Market snapshot
  if (market) {
    lines.push('## [DATA] 시장 지표');
    lines.push('');
    lines.push('| 지표 | 값 | 변동 | 방향 |');
    lines.push('|------|-----|------|------|');
    const indicators = [
      { name: 'KOSPI', v: market.kospiValue, c: market.kospiChange, d: market.kospiDir },
      { name: 'KOSDAQ', v: market.kosdaqValue, c: market.kosdaqChange, d: market.kosdaqDir },
      { name: 'USD/KRW', v: market.usdKrwValue, c: market.usdKrwChange, d: market.usdKrwDir },
      { name: 'WTI', v: market.wtiValue, c: market.wtiChange, d: market.wtiDir },
      { name: 'US 10Y', v: market.us10yValue, c: market.us10yChange, d: market.us10yDir },
      { name: 'BTC/USD', v: market.btcUsdValue, c: market.btcUsdChange, d: market.btcUsdDir },
      { name: 'NASDAQ', v: market.nasdaqValue, c: market.nasdaqChange, d: market.nasdaqDir },
    ];
    for (const ind of indicators) {
      if (ind.v != null) {
        const dir = DIRECTION_EMOJI[ind.d ?? 'flat'] ?? '→';
        lines.push(`| ${ind.name} | ${typeof ind.v === 'number' ? ind.v.toLocaleString() : ind.v} | ${ind.c ?? '-'} | ${dir} |`);
      }
    }
    lines.push('');
  }

  // TOP 3
  const top3 = newsItems.filter(n => n.isTop3).sort((a, b) => (a.top3Rank ?? 99) - (b.top3Rank ?? 99));
  if (top3.length > 0) {
    lines.push('## [TOP] TOP 3 하이라이트');
    lines.push('');
    for (const item of top3) {
      lines.push(`### ${item.top3Rank ?? '?'}. ${item.title}`);
      lines.push(`- **카테고리**: ${CATEGORY_LABEL[item.category] ?? item.category} | **긴급도**: ${URGENCY_EMOJI[item.urgency] ?? ''} ${item.urgency}`);
      lines.push(`- [FACT] **팩트**: ${item.fact}`);
      lines.push(`- [IMPACT] **임팩트**: ${item.impact}`);
      lines.push(`- [ACTION] **액션**: ${item.action}`);
      if (item.relatedData?.length) lines.push(`- [DATA] 관련 데이터: ${item.relatedData.join(' | ')}`);
      if (item.contextLinks?.length) lines.push(`- [LINK] 연관 뉴스: ${item.contextLinks.join(', ')}`);
      if (item.upcomingEvents?.length) lines.push(`- [DATE] 후속 이벤트: ${item.upcomingEvents.join(', ')}`);
      if (item.contextTags?.length) lines.push(`- [TAG] 태그: ${item.contextTags.map((t: string) => `[[${t}]]`).join(', ')}`);
      lines.push('');
    }
  }

  // Category sections
  for (const briefing of briefings.sort((a, b) => a.category.localeCompare(b.category))) {
    const catLabel = CATEGORY_LABEL[briefing.category] ?? briefing.category;
    const catItems = newsItems
      .filter(n => n.category === briefing.category && !n.isGithubTrending)
      .sort((a, b) => a.newsOrder - b.newsOrder);
    const trendingItems = newsItems
      .filter(n => n.category === briefing.category && n.isGithubTrending);

    lines.push(`## ${catLabel}`);
    lines.push('');
    lines.push(`> ${briefing.summary}`);
    lines.push('');

    for (const item of catItems) {
      const urg = URGENCY_EMOJI[item.urgency] ?? '';
      lines.push(`### ${urg} ${item.title}`);
      lines.push(`- [FACT] ${item.fact}`);
      lines.push(`- [IMPACT] ${item.impact}`);
      lines.push(`- [ACTION] ${item.action}`);
      if (item.sourceCount > 1) {
        lines.push(`- [NEWS] 다중출처 (${item.sourceCount}곳): ${item.sourceList?.join(', ') ?? item.source}`);
        if (item.consensusFacts) lines.push(`  - [OK] 공통사실: ${item.consensusFacts}`);
        if (item.conflictingFacts) lines.push(`  - [!!] 이견: ${item.conflictingFacts}`);
      } else {
        lines.push(`- [NEWS] 출처: [${item.source}](${item.sourceUrl})`);
      }
      if (item.contextTags?.length) {
        lines.push(`- [TAG] ${item.contextTags.map((t: string) => `[[${t}]]`).join(', ')}`);
      }
      lines.push('');
    }

    if (trendingItems.length > 0) {
      lines.push(`### [HOT] GitHub Trending (AI/ML)`);
      lines.push('');
      for (const item of trendingItems) {
        lines.push(`- **${item.title}**`);
        if (item.githubStarsDelta) lines.push(`  - * +${item.githubStarsDelta} stars today | ${item.githubLanguage ?? ''}`);
        lines.push(`  - [FACT] ${item.fact}`);
        lines.push(`  - [GitHub](${item.sourceUrl})`);
        lines.push('');
      }
    }
  }

  // Navigation
  lines.push('---');
  lines.push('');
  const prevDate = new Date(dateStr);
  prevDate.setDate(prevDate.getDate() - 1);
  const nextDate = new Date(dateStr);
  nextDate.setDate(nextDate.getDate() + 1);
  lines.push(`← [[${prevDate.toISOString().slice(0, 10)}]] | [[index]] | [[${nextDate.toISOString().slice(0, 10)}]] →`);

  return lines.join('\n');
}

// ─── Entity page builder ─────────────────────────────────────────────────────

function buildEntityPage(
  tag: string,
  info: { count: number; dates: Set<string>; categories: Set<string> },
  relatedItems: any[],
): string {
  const lines: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const sortedDates = [...info.dates].sort();

  lines.push('---');
  lines.push(`title: "${tag}"`);
  lines.push(`created: ${sortedDates[0] ?? today}`);
  lines.push(`updated: ${today}`);
  lines.push('type: entity');
  lines.push(`tags: [${[...info.categories].map(c => CATEGORY_LABEL[c]?.toLowerCase() ?? c.toLowerCase()).join(', ')}]`);
  lines.push(`sources: [${sortedDates.map(d => `daily-digests/${d}`).join(', ')}]`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${tag}`);
  lines.push('');
  lines.push(`- **등장 횟수**: ${info.count}회 (${sortedDates.length}일)`);
  lines.push(`- **카테고리**: ${[...info.categories].map(c => CATEGORY_LABEL[c] ?? c).join(', ')}`);
  lines.push(`- **기간**: ${sortedDates[0]} ~ ${sortedDates[sortedDates.length - 1]}`);
  lines.push('');
  lines.push('## 관련 뉴스');
  lines.push('');

  // Show up to 10 most relevant items
  const relevant = relatedItems
    .filter(item => (item.contextTags ?? []).some((t: string) => t.toLowerCase().trim() === tag))
    .slice(0, 10);

  for (const item of relevant) {
    const date = item.digest?.date?.toISOString().slice(0, 10) ?? '';
    lines.push(`- **${date}** ${URGENCY_EMOJI[item.urgency] ?? ''} ${item.title}`);
    lines.push(`  - ${item.fact}`);
    lines.push(`  - → [[${date}]]`);
  }
  lines.push('');

  // Cross-references to other frequent tags that co-occur
  const coTags = new Set<string>();
  for (const item of relevant) {
    for (const t of (item.contextTags ?? [])) {
      const k = t.toLowerCase().trim();
      if (k !== tag && k.length >= 2) coTags.add(k);
    }
  }
  if (coTags.size > 0) {
    lines.push('## 관련 키워드');
    lines.push('');
    lines.push([...coTags].slice(0, 15).map(t => `[[${t}]]`).join(', '));
  }

  return lines.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dateArg = args.includes('--date') ? args[args.indexOf('--date') + 1] : null;

  const where: any = { status: 'done' };
  if (dateArg) {
    const d = new Date(dateArg);
    d.setUTCHours(0, 0, 0, 0);
    where.date = d;
  }

  const digests = await prisma.dailyDigest.findMany({
    where,
    include: {
      marketDaily: true,
      categoryBriefings: true,
      newsItems: {
        include: { digest: { select: { date: true } } },
        orderBy: [{ category: 'asc' }, { newsOrder: 'asc' }],
      },
    },
    orderBy: { date: 'asc' },
  });

  console.log(`Found ${digests.length} digests to export`);

  const allNewsItems: any[] = [];
  const indexEntries: string[] = [];

  for (const digest of digests) {
    const dateStr = digest.date.toISOString().slice(0, 10);
    console.log(`Exporting ${dateStr}...`);

    const page = buildDailyDigestPage(
      dateStr,
      digest.marketDaily,
      digest.categoryBriefings,
      digest.newsItems,
    );

    const outPath = join(WIKI, 'daily-digests', `${dateStr}.md`);
    writeFileSync(outPath, page, 'utf-8');
    console.log(`  → ${outPath} (${digest.newsItems.length} items)`);

    allNewsItems.push(...digest.newsItems);

    const top3 = digest.newsItems.filter(n => n.isTop3).sort((a, b) => (a.top3Rank ?? 99) - (b.top3Rank ?? 99));
    const top3Preview = top3.length > 0
      ? ` — TOP: ${top3.map(t => t.title.slice(0, 30)).join(', ')}`
      : '';
    indexEntries.push(`- [[${dateStr}]] — ${digest.newsItems.length}건${top3Preview}`);
  }

  // Build entity pages for frequently occurring tags (3+ appearances)
  const entities = extractEntitiesFromNews(allNewsItems);
  const entityPages: string[] = [];

  for (const [tag, info] of entities.entries()) {
    if (info.count >= 3 || info.dates.size >= 2) {
      const slug = tag.replace(/[^a-zA-Z0-9가-힣_-]/g, '-').replace(/-+/g, '-').toLowerCase();
      const page = buildEntityPage(tag, info, allNewsItems);
      const outPath = join(WIKI, 'entities', `${slug}.md`);
      writeFileSync(outPath, page, 'utf-8');
      entityPages.push(`- [[${slug}]] — ${tag} (${info.count}회, ${info.dates.size}일)`);
    }
  }

  console.log(`Generated ${entityPages.length} entity pages`);

  // Update index.md
  const indexContent = `# Wiki Index

> 뉴스 다이제스트 지식베이스. 모든 위키 페이지를 타입별로 정리.
> Last updated: ${new Date().toISOString().slice(0, 10)} | Total pages: ${digests.length + entityPages.length}

## Daily Digests
${indexEntries.join('\n')}

## Weekly Digests
<!-- 주간 다이제스트 — 추후 자동 생성 -->

## Entities
${entityPages.join('\n')}

## Concepts
<!-- 주제, 트렌드, 정책 개념 — 충분한 데이터 축적 후 자동 생성 -->

## Comparisons
<!-- 비교 분석 -->

## Queries
<!-- 저장된 질의 결과 -->
`;
  writeFileSync(join(WIKI, 'index.md'), indexContent, 'utf-8');

  // Append to log
  const logEntry = `\n## [${new Date().toISOString().slice(0, 10)}] ingest | Bulk DB export
- Exported ${digests.length} daily digests (${allNewsItems.length} news items)
- Generated ${entityPages.length} entity pages
- Date range: ${digests[0]?.date.toISOString().slice(0, 10)} ~ ${digests[digests.length - 1]?.date.toISOString().slice(0, 10)}
- Source: PostgreSQL news_digest DB
`;
  appendFileSync(join(WIKI, 'log.md'), logEntry, 'utf-8');

  console.log('Done! Wiki updated.');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
