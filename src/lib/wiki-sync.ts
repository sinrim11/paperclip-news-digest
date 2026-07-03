/**
 * Wiki sync module — called after digest generation to auto-update the wiki.
 *
 * Usage (from code):
 *   import { syncDigestToWiki } from '@/lib/wiki-sync';
 *   await syncDigestToWiki(digestId);
 *
 * Usage (CLI):
 *   npx tsx scripts/wiki-export.ts --date 2026-04-17
 */

import { PrismaClient } from '@prisma/client';
import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';

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

function buildDailyDigestPage(
  dateStr: string,
  market: any | null,
  briefings: any[],
  newsItems: any[],
): string {
  const lines: string[] = [];

  lines.push('---');
  lines.push(`title: "일일 뉴스 다이제스트 ${dateStr}"`);
  lines.push(`created: ${dateStr}`);
  lines.push(`updated: ${new Date().toISOString().slice(0, 10)}`);
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
  for (const briefing of briefings.sort((a: any, b: any) => a.category.localeCompare(b.category))) {
    const catLabel = CATEGORY_LABEL[briefing.category] ?? briefing.category;
    const catItems = newsItems
      .filter((n: any) => n.category === briefing.category && !n.isGithubTrending)
      .sort((a: any, b: any) => a.newsOrder - b.newsOrder);
    const trendingItems = newsItems
      .filter((n: any) => n.category === briefing.category && n.isGithubTrending);

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

// ─── Update index with new daily digest entry ────────────────────────────────

function updateIndex(dateStr: string, newsCount: number, top3Titles: string[]): void {
  const indexPath = join(WIKI, 'index.md');
  if (!existsSync(indexPath)) return;

  let content = readFileSync(indexPath, 'utf-8');
  const entry = `- [[${dateStr}]] — ${newsCount}건${top3Titles.length > 0 ? ` — TOP: ${top3Titles.map(t => t.slice(0, 30)).join(', ')}` : ''}`;

  // Check if entry already exists
  if (content.includes(`[[${dateStr}]]`)) {
    // Replace existing entry
    content = content.replace(new RegExp(`- \\[\\[${dateStr}\\]\\].*`, 'g'), entry);
  } else {
    // Insert after "## Daily Digests" marker
    content = content.replace(
      /(## Daily Digests\n)/,
      `$1${entry}\n`,
    );
  }

  // Update total pages count
  const pageCount = (content.match(/\[\[/g) ?? []).length;
  content = content.replace(
    /Total pages: \d+/,
    `Total pages: ${pageCount}`,
  );
  content = content.replace(
    /Last updated: \d{4}-\d{2}-\d{2}/,
    `Last updated: ${new Date().toISOString().slice(0, 10)}`,
  );

  writeFileSync(indexPath, content, 'utf-8');
}

// ─── Update entity pages for new tags ────────────────────────────────────────

function updateEntityPages(newsItems: any[], dateStr: string): number {
  let created = 0;

  // Count tag occurrences across these items
  const tagItems = new Map<string, any[]>();
  for (const item of newsItems) {
    for (const tag of (item.contextTags ?? [])) {
      const key = tag.toLowerCase().trim();
      if (!key || key.length < 2) continue;
      if (!tagItems.has(key)) tagItems.set(key, []);
      tagItems.get(key)!.push(item);
    }
  }

  for (const [tag, items] of tagItems.entries()) {
    const slug = tag.replace(/[^a-zA-Z0-9가-힣_-]/g, '-').replace(/-+/g, '-').toLowerCase();
    const entityPath = join(WIKI, 'entities', `${slug}.md`);

    if (existsSync(entityPath)) {
      // Append new references to existing entity page
      let content = readFileSync(entityPath, 'utf-8');
      const today = new Date().toISOString().slice(0, 10);
      content = content.replace(/updated: \d{4}-\d{2}-\d{2}/, `updated: ${today}`);

      for (const item of items) {
        const entryLine = `- **${dateStr}** ${URGENCY_EMOJI[item.urgency] ?? ''} ${item.title}`;
        if (!content.includes(item.title.slice(0, 30))) {
          // Add before "## 관련 키워드" or at end of "## 관련 뉴스"
          const insertPoint = content.indexOf('## 관련 키워드');
          if (insertPoint > 0) {
            content = content.slice(0, insertPoint) +
              `${entryLine}\n  - ${item.fact}\n  - → [[${dateStr}]]\n\n` +
              content.slice(insertPoint);
          }
        }
      }
      writeFileSync(entityPath, content, 'utf-8');
    }
    // New entity pages only created during bulk export or lint
  }

  return created;
}

// ─── Category page builder (inline version) ─────────────────────────────────

const CAT_SLUGS: Record<string, string> = {
  GLOBAL: 'global', STOCKS: 'stocks', AI: 'ai', POLICY: 'policy', REALESTATE: 'realestate',
};
const CAT_ICONS: Record<string, string> = {
  GLOBAL: '[GLOBAL]', STOCKS: '▲', AI: '[AI]', POLICY: '[POLICY]', REALESTATE: '[REAL]',
};

function syncCategoryPages(
  dateStr: string,
  market: any | null,
  briefings: any[],
  newsItems: any[],
): void {
  const categories = [...new Set(newsItems.map((n: any) => n.category as string))];

  for (const catKey of categories) {
    const slug = CAT_SLUGS[catKey] ?? catKey.toLowerCase();
    const icon = CAT_ICONS[catKey] ?? '[FACT]';
    const catLabel = CATEGORY_LABEL[catKey] ?? catKey;
    const catDir = join(WIKI, 'categories', slug);
    if (!existsSync(catDir)) mkdirSync(catDir, { recursive: true });

    const briefing = briefings.find((b: any) => b.category === catKey);
    const items = newsItems.filter((n: any) => n.category === catKey);
    if (items.length === 0) continue;

    const regular = items.filter((n: any) => !n.isGithubTrending).sort((a: any, b: any) => a.newsOrder - b.newsOrder);
    const trending = items.filter((n: any) => n.isGithubTrending);

    const lines: string[] = [];
    lines.push('---');
    lines.push(`title: "${catLabel} — ${dateStr}"`);
    lines.push(`created: ${dateStr}`);
    lines.push(`updated: ${new Date().toISOString().slice(0, 10)}`);
    lines.push(`type: daily-digest`);
    lines.push(`category: ${catKey}`);
    lines.push(`tags: [${slug}, daily-digest]`);
    lines.push('---');
    lines.push('');
    lines.push(`# ${icon} ${catLabel} — ${dateStr}`);
    lines.push('');
    if (briefing) { lines.push(`> ${briefing.summary}`); lines.push(''); }

    // Market context for stocks/global
    if (market && (catKey === 'STOCKS' || catKey === 'GLOBAL')) {
      lines.push('## [DATA] 시장 지표');
      lines.push('');
      lines.push('| 지표 | 값 | 변동 |');
      lines.push('|------|-----|------|');
      const inds = catKey === 'STOCKS'
        ? [
            { n: 'KOSPI', v: market.kospiValue, c: market.kospiChange, d: market.kospiDir },
            { n: 'KOSDAQ', v: market.kosdaqValue, c: market.kosdaqChange, d: market.kosdaqDir },
            { n: 'NASDAQ', v: market.nasdaqValue, c: market.nasdaqChange, d: market.nasdaqDir },
          ]
        : [
            { n: 'USD/KRW', v: market.usdKrwValue, c: market.usdKrwChange, d: market.usdKrwDir },
            { n: 'WTI', v: market.wtiValue, c: market.wtiChange, d: market.wtiDir },
          ];
      for (const i of inds) {
        if (i.v != null) {
          const e = i.d === 'up' ? '▲' : i.d === 'down' ? '▼' : '→';
          lines.push(`| ${i.n} | ${typeof i.v === 'number' ? i.v.toLocaleString() : i.v} | ${i.c ?? '-'} ${e} |`);
        }
      }
      lines.push('');
    }

    // News items
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
      if (item.contextTags?.length) lines.push(`- [TAG] ${item.contextTags.map((t: string) => `[[${t}]]`).join(', ')}`);
      lines.push('');
    }

    if (trending.length > 0) {
      lines.push('## [HOT] GitHub Trending');
      lines.push('');
      for (const item of trending) {
        lines.push(`- **${item.title}**`);
        if (item.githubStarsDelta) lines.push(`  - * +${item.githubStarsDelta} stars | ${item.githubLanguage ?? ''}`);
        lines.push(`  - [FACT] ${item.fact}`);
        lines.push(`  - [GitHub](${item.sourceUrl})`);
        lines.push('');
      }
    }

    // Navigation
    lines.push('---');
    const prev = new Date(dateStr); prev.setDate(prev.getDate() - 1);
    const next = new Date(dateStr); next.setDate(next.getDate() + 1);
    lines.push(`← [[categories/${slug}/${prev.toISOString().slice(0, 10)}|전일]] | [[categories/${slug}/index|${catLabel} 목록]] | [[categories/${slug}/${next.toISOString().slice(0, 10)}|다음]] →`);
    lines.push(`[DATE] [[daily-digests/${dateStr}|전체 다이제스트]]`);

    writeFileSync(join(catDir, `${dateStr}.md`), lines.join('\n'), 'utf-8');
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function syncDigestToWiki(digestId: string, prismaClient?: any): Promise<{ path: string; itemCount: number }> {
  const prisma = prismaClient ?? new PrismaClient();

  try {
    const digest = await prisma.dailyDigest.findUnique({
      where: { id: digestId },
      include: {
        marketDaily: true,
        categoryBriefings: true,
        newsItems: {
          orderBy: [{ category: 'asc' }, { newsOrder: 'asc' }],
        },
      },
    });

    if (!digest) throw new Error(`Digest ${digestId} not found`);

    const dateStr = digest.date.toISOString().slice(0, 10);
    const page = buildDailyDigestPage(
      dateStr,
      digest.marketDaily,
      digest.categoryBriefings,
      digest.newsItems,
    );

    const outPath = join(WIKI, 'daily-digests', `${dateStr}.md`);
    writeFileSync(outPath, page, 'utf-8');

    // Update index
    const top3 = digest.newsItems.filter((n: any) => n.isTop3).sort((a: any, b: any) => (a.top3Rank ?? 99) - (b.top3Rank ?? 99));
    updateIndex(dateStr, digest.newsItems.length, top3.map((t: any) => t.title));

    // Update entity pages
    updateEntityPages(digest.newsItems, dateStr);

    // Sync category pages
    syncCategoryPages(dateStr, digest.marketDaily, digest.categoryBriefings, digest.newsItems);

    // Append to log
    const logEntry = `\n## [${new Date().toISOString().slice(0, 10)}] ingest | Daily digest ${dateStr}
- Auto-synced ${digest.newsItems.length} news items
- TOP 3: ${top3.map((t: any) => t.title.slice(0, 40)).join(', ') || 'none'}
`;
    appendFileSync(join(WIKI, 'log.md'), logEntry, 'utf-8');

    console.log(`[wiki-sync] ${dateStr}: ${digest.newsItems.length} items → ${outPath}`);

    return { path: outPath, itemCount: digest.newsItems.length };
  } finally {
    if (!prismaClient) await prisma.$disconnect();
  }
}
