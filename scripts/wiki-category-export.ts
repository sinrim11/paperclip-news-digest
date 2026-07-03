/**
 * Wiki category pages generator.
 *
 * Creates:
 *   wiki/categories/{category}/index.md    — 카테고리 총괄 인덱스
 *   wiki/categories/{category}/YYYY-MM-DD.md — 카테고리별 일일 페이지
 *
 * Usage:
 *   npx tsx scripts/wiki-category-export.ts          # 전체 재생성
 *   npx tsx scripts/wiki-category-export.ts --date 2026-04-17  # 특정 날짜만
 */

import { PrismaClient } from '@prisma/client';
import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();
const WIKI = join(process.cwd(), 'wiki');

type CatKey = 'GLOBAL' | 'STOCKS' | 'AI' | 'POLICY' | 'REALESTATE';

const CAT_META: Record<CatKey, { label: string; slug: string; icon: string; desc: string }> = {
  GLOBAL:     { label: '글로벌',  slug: 'global',     icon: '[GLOBAL]', desc: '글로벌 뉴스 — BBC, Guardian, Reuters, AP, Al Jazeera' },
  STOCKS:     { label: '증권',    slug: 'stocks',     icon: '▲', desc: '증권/금융 뉴스 — Bloomberg, CNBC, FT, MarketWatch, Reuters' },
  AI:         { label: 'AI',      slug: 'ai',         icon: '[AI]', desc: 'AI/기술 뉴스 — TechCrunch, Verge, ArXiv, HackerNews, GitHub Trending' },
  POLICY:     { label: '정치',    slug: 'policy',     icon: '[POLICY]', desc: '정치 뉴스 — 연합뉴스, KBS, 조선, 한겨레, 경향, MBC' },
  REALESTATE: { label: '부동산',  slug: 'realestate', icon: '[REAL]', desc: '부동산 뉴스 — 매경, 한경, 연합, 이데일리, 뉴스핌' },
};

const URGENCY_EMOJI: Record<string, string> = { breaking: '[!]', watch: '[~]', note: '[i]' };

// ─── Build per-category daily page ───────────────────────────────────────────

function buildCategoryDailyPage(
  catKey: CatKey,
  dateStr: string,
  briefing: any,
  newsItems: any[],
  market: any | null,
): string {
  const meta = CAT_META[catKey];
  const lines: string[] = [];

  // Frontmatter
  lines.push('---');
  lines.push(`title: "${meta.label} — ${dateStr}"`);
  lines.push(`created: ${dateStr}`);
  lines.push(`updated: ${dateStr}`);
  lines.push(`type: daily-digest`);
  lines.push(`category: ${catKey}`);
  lines.push(`tags: [${meta.slug}, daily-digest]`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${meta.icon} ${meta.label} — ${dateStr}`);
  lines.push('');

  // Briefing summary
  if (briefing) {
    lines.push(`> ${briefing.summary}`);
    lines.push('');
  }

  // Market context (for STOCKS/GLOBAL)
  if (market && (catKey === 'STOCKS' || catKey === 'GLOBAL')) {
    lines.push('## [DATA] 시장 지표');
    lines.push('');
    const indicators: { name: string; v: any; c: any; d: any }[] = [];
    if (catKey === 'STOCKS') {
      indicators.push(
        { name: 'KOSPI', v: market.kospiValue, c: market.kospiChange, d: market.kospiDir },
        { name: 'KOSDAQ', v: market.kosdaqValue, c: market.kosdaqChange, d: market.kosdaqDir },
        { name: 'NASDAQ', v: market.nasdaqValue, c: market.nasdaqChange, d: market.nasdaqDir },
        { name: 'BTC/USD', v: market.btcUsdValue, c: market.btcUsdChange, d: market.btcUsdDir },
      );
    } else {
      indicators.push(
        { name: 'USD/KRW', v: market.usdKrwValue, c: market.usdKrwChange, d: market.usdKrwDir },
        { name: 'WTI', v: market.wtiValue, c: market.wtiChange, d: market.wtiDir },
        { name: 'US 10Y', v: market.us10yValue, c: market.us10yChange, d: market.us10yDir },
      );
    }
    lines.push('| 지표 | 값 | 변동 |');
    lines.push('|------|-----|------|');
    for (const ind of indicators) {
      if (ind.v != null) {
        const emoji = ind.d === 'up' ? '▲' : ind.d === 'down' ? '▼' : '→';
        lines.push(`| ${ind.name} | ${typeof ind.v === 'number' ? ind.v.toLocaleString() : ind.v} | ${ind.c ?? '-'} ${emoji} |`);
      }
    }
    lines.push('');
  }

  // News items
  const regular = newsItems.filter(n => !n.isGithubTrending).sort((a, b) => a.newsOrder - b.newsOrder);
  const trending = newsItems.filter(n => n.isGithubTrending);

  if (regular.length > 0) {
    lines.push(`## 뉴스 (${regular.length}건)`);
    lines.push('');

    for (const item of regular) {
      const urg = URGENCY_EMOJI[item.urgency] ?? '';
      const top3Mark = item.isTop3 ? ` * TOP${item.top3Rank ?? ''}` : '';
      lines.push(`### ${urg} ${item.title}${top3Mark}`);
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

      if (item.isTop3) {
        if (item.relatedData?.length) lines.push(`- [DATA] 관련 데이터: ${item.relatedData.join(' | ')}`);
        if (item.contextLinks?.length) lines.push(`- [LINK] 연관 뉴스: ${item.contextLinks.join(', ')}`);
        if (item.upcomingEvents?.length) lines.push(`- [DATE] 후속 이벤트: ${item.upcomingEvents.join(', ')}`);
      }

      if (item.contextTags?.length) {
        lines.push(`- [TAG] ${item.contextTags.map((t: string) => `[[${t}]]`).join(', ')}`);
      }
      lines.push('');
    }
  }

  // GitHub Trending (AI only)
  if (trending.length > 0) {
    lines.push('## [HOT] GitHub Trending');
    lines.push('');
    for (const item of trending) {
      lines.push(`- **${item.title}**`);
      if (item.githubStarsDelta) lines.push(`  - * +${item.githubStarsDelta} stars today | ${item.githubLanguage ?? ''}`);
      lines.push(`  - [FACT] ${item.fact}`);
      lines.push(`  - [GitHub](${item.sourceUrl})`);
      lines.push('');
    }
  }

  // Navigation
  lines.push('---');
  lines.push('');
  const prev = new Date(dateStr); prev.setDate(prev.getDate() - 1);
  const next = new Date(dateStr); next.setDate(next.getDate() + 1);
  const prevStr = prev.toISOString().slice(0, 10);
  const nextStr = next.toISOString().slice(0, 10);
  lines.push(`← [[categories/${meta.slug}/${prevStr}|${prevStr}]] | [[categories/${meta.slug}/index|${meta.label} 목록]] | [[categories/${meta.slug}/${nextStr}|${nextStr}]] →`);
  lines.push('');
  lines.push(`[DATE] 전체 일일 다이제스트: [[daily-digests/${dateStr}|${dateStr}]]`);

  return lines.join('\n');
}

// ─── Build category index page ───────────────────────────────────────────────

function buildCategoryIndexPage(
  catKey: CatKey,
  dailyEntries: { date: string; newsCount: number; breakingCount: number; summary: string }[],
): string {
  const meta = CAT_META[catKey];
  const lines: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  lines.push('---');
  lines.push(`title: "${meta.label} — 카테고리 인덱스"`);
  lines.push(`created: ${dailyEntries[0]?.date ?? today}`);
  lines.push(`updated: ${today}`);
  lines.push('type: concept');
  lines.push(`tags: [${meta.slug}, category-index]`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${meta.icon} ${meta.label}`);
  lines.push('');
  lines.push(meta.desc);
  lines.push('');
  lines.push(`## 일일 뉴스 (${dailyEntries.length}일)`);
  lines.push('');
  lines.push('| 날짜 | 건수 | [!] | 요약 |');
  lines.push('|------|------|-----|------|');

  // Reverse chronological
  for (const entry of [...dailyEntries].reverse()) {
    const summary = entry.summary.length > 60 ? entry.summary.slice(0, 60) + '…' : entry.summary;
    lines.push(`| [[categories/${meta.slug}/${entry.date}\\|${entry.date}]] | ${entry.newsCount} | ${entry.breakingCount} | ${summary} |`);
  }

  lines.push('');

  // Frequent tags for this category
  lines.push('## 주요 키워드');
  lines.push('');
  lines.push('> 이 카테고리에서 자주 등장하는 태그 (entity 페이지 링크)');
  lines.push('');

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
        orderBy: [{ category: 'asc' }, { newsOrder: 'asc' }],
      },
    },
    orderBy: { date: 'asc' },
  });

  console.log(`Processing ${digests.length} digests...`);

  // Track per-category stats for index pages
  const catStats: Record<CatKey, { date: string; newsCount: number; breakingCount: number; summary: string }[]> = {
    GLOBAL: [], STOCKS: [], AI: [], POLICY: [], REALESTATE: [],
  };

  const catKeys = Object.keys(CAT_META) as CatKey[];

  for (const digest of digests) {
    const dateStr = digest.date.toISOString().slice(0, 10);

    for (const catKey of catKeys) {
      const briefing = digest.categoryBriefings.find(b => b.category === catKey);
      const items = digest.newsItems.filter(n => n.category === catKey);

      if (items.length === 0 && !briefing) continue;

      // Ensure directory
      const catDir = join(WIKI, 'categories', CAT_META[catKey].slug);
      if (!existsSync(catDir)) mkdirSync(catDir, { recursive: true });

      // Build and write category daily page
      const page = buildCategoryDailyPage(catKey, dateStr, briefing, items, digest.marketDaily);
      const outPath = join(catDir, `${dateStr}.md`);
      writeFileSync(outPath, page, 'utf-8');

      const breakingCount = items.filter(n => n.urgency === 'breaking').length;
      catStats[catKey].push({
        date: dateStr,
        newsCount: items.length,
        breakingCount,
        summary: briefing?.summary ?? '',
      });

      console.log(`  ${catKey}/${dateStr}: ${items.length} items`);
    }
  }

  // Build category index pages
  for (const catKey of catKeys) {
    if (catStats[catKey].length === 0) continue;

    const catDir = join(WIKI, 'categories', CAT_META[catKey].slug);
    if (!existsSync(catDir)) mkdirSync(catDir, { recursive: true });

    // Collect frequent tags for this category
    const tagCounts = new Map<string, number>();
    for (const digest of digests) {
      for (const item of digest.newsItems.filter(n => n.category === catKey)) {
        for (const tag of (item.contextTags ?? [])) {
          const k = tag.toLowerCase().trim();
          tagCounts.set(k, (tagCounts.get(k) ?? 0) + 1);
        }
      }
    }
    const topTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    let indexPage = buildCategoryIndexPage(catKey, catStats[catKey]);
    indexPage += topTags.map(([tag, count]) => `- [[${tag}]] (${count}회)`).join('\n');
    indexPage += '\n';

    writeFileSync(join(catDir, 'index.md'), indexPage, 'utf-8');
    console.log(`${catKey} index: ${catStats[catKey].length} days, ${topTags.length} tags`);
  }

  // Update main wiki index to include category links
  const mainIndexPath = join(WIKI, 'index.md');
  if (existsSync(mainIndexPath)) {
    let idx = readFileSync(mainIndexPath, 'utf-8');

    // Add/replace Categories section
    const catSection = `## Categories
${catKeys.map(k => {
  const meta = CAT_META[k];
  const stats = catStats[k];
  const total = stats.reduce((s, e) => s + e.newsCount, 0);
  return `- ${meta.icon} [[categories/${meta.slug}/index|${meta.label}]] — ${stats.length}일, ${total}건`;
}).join('\n')}
`;

    if (idx.includes('## Categories')) {
      idx = idx.replace(/## Categories[\s\S]*?(?=\n## )/, catSection + '\n');
    } else {
      // Insert before ## Entities
      idx = idx.replace('## Entities', catSection + '\n## Entities');
    }

    // Update total page count
    const totalPages = digests.length
      + Object.values(catStats).reduce((s, arr) => s + arr.length, 0)
      + catKeys.length; // index pages
    idx = idx.replace(/Total pages: \d+/, `Total pages: ${totalPages + 36}`); // +36 entities

    writeFileSync(mainIndexPath, idx, 'utf-8');
  }

  // Append to log
  const totalCatPages = Object.values(catStats).reduce((s, arr) => s + arr.length, 0);
  appendFileSync(join(WIKI, 'log.md'),
    `\n## [${new Date().toISOString().slice(0, 10)}] ingest | Category pages generated
- ${totalCatPages} category daily pages across 5 categories
- ${catKeys.length} category index pages created
- Structure: wiki/categories/{slug}/YYYY-MM-DD.md
`, 'utf-8');

  console.log(`\nDone! ${totalCatPages} category pages + ${catKeys.length} index pages`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
