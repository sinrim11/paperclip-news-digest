/**
 * Wiki DB layer — persists WikiEntry rows for the 3-way split.
 *
 * Ledger:      one row per (entity, metric, date). Numbers + source URL ONLY.
 *              No LLM prose. Written from EntityStat rows.
 * Narrative:   weekly prose summary. Written from ledger entries via LM Studio.
 *              Never reads previous narratives (hallucination-echo prevention).
 * DailyDigest: cached markdown output for the daily briefing, one row per date.
 */

import { PrismaClient } from '@prisma/client';
import { chat, type ChatMessage } from '@/lib/llm';

// ── Ledger ────────────────────────────────────────────────────────────────────

/**
 * Convert today's EntityStat rows for a given date into WikiEntry ledger rows.
 * Ledger rule: title = "entity | metric | date", body = "value", sourceUrl required.
 */
export async function writeLedgerEntries(
  statDate: Date,
  prismaClient?: PrismaClient,
): Promise<number> {
  const prisma = prismaClient ?? new PrismaClient();
  const ownPrisma = !prismaClient;

  try {
    const dateOnly = new Date(statDate);
    dateOnly.setUTCHours(0, 0, 0, 0);
    const dateStr = dateOnly.toISOString().slice(0, 10);

    const stats = await prisma.entityStat.findMany({ where: { statDate: dateOnly } });
    if (stats.length === 0) return 0;

    let written = 0;
    for (const stat of stats) {
      const metrics = stat.metrics as Record<string, unknown>;
      const metricKeys: Array<'mentions' | 'sentiment' | 'sourceCount' | 'signals'> =
        ['mentions', 'sentiment', 'sourceCount', 'signals'];

      for (const metricKey of metricKeys) {
        const value = metrics[metricKey];
        if (value === undefined || value === null || value === 0) continue;

        const title = `${stat.entityName} | ${metricKey} | ${dateStr}`;
        const body = String(value);
        const sourceList = (metrics.sourceList ?? []) as string[];

        const existing = await prisma.wikiEntry.findFirst({
          where: { entryType: 'ledger', title, refDate: dateOnly },
        });
        const entryData = {
          entryType: 'ledger' as const,
          title,
          body,
          tags: [stat.entityName, stat.entityType, metricKey],
          sourceUrl: sourceList[0] ?? null,
          refDate: dateOnly,
          metadata: {
            entityName: stat.entityName,
            entityType: stat.entityType,
            metricKey,
            metricValue: value,
            sourceList,
          },
        };
        if (existing) {
          await prisma.wikiEntry.update({ where: { id: existing.id }, data: entryData });
        } else {
          await prisma.wikiEntry.create({ data: entryData });
        }
        written++;
      }
    }

    console.log(`[wiki-db] ledger: ${written} entries written for ${dateStr}`);
    return written;
  } finally {
    if (ownPrisma) await prisma.$disconnect();
  }
}

// ── Daily Digest cache ────────────────────────────────────────────────────────

/**
 * Cache a digest's rendered markdown body into WikiEntry(daily_digest).
 * Idempotent: replaces existing row for same refDate.
 */
export async function writeDailyDigestWikiEntry(
  digestId: string,
  dateStr: string,
  prismaClient?: PrismaClient,
): Promise<void> {
  const prisma = prismaClient ?? new PrismaClient();
  const ownPrisma = !prismaClient;

  try {
    const digest = await prisma.dailyDigest.findUnique({
      where: { id: digestId },
      include: {
        categoryBriefings: true,
        newsItems: { orderBy: [{ category: 'asc' }, { newsOrder: 'asc' }] },
      },
    });
    if (!digest) return;

    const refDate = new Date(dateStr);
    refDate.setUTCHours(0, 0, 0, 0);

    const categories = [...new Set(digest.newsItems.map((n) => n.category))];
    const title = `일일 다이제스트 ${dateStr}`;

    // Body = compact markdown summary (not the full 180-line digest page)
    const lines: string[] = [`# 일일 다이제스트 ${dateStr}`, ''];
    for (const cat of categories) {
      const briefing = digest.categoryBriefings.find((b) => b.category === cat);
      const items = digest.newsItems.filter((n) => n.category === cat);
      if (briefing) lines.push(`## ${cat}: ${briefing.summary}`, '');
      for (const item of items) {
        lines.push(`- [${item.urgency.toUpperCase()}] ${item.title}`);
        lines.push(`  - ${item.fact}`);
        if (item.sourceUrl) lines.push(`  - source: ${item.sourceUrl}`);
      }
      lines.push('');
    }

    const body = lines.join('\n');
    const tags = ['daily-digest', dateStr, ...categories.map((c) => c.toLowerCase())];

    const existing = await prisma.wikiEntry.findFirst({
      where: { entryType: 'daily_digest', refDate },
    });

    if (existing) {
      await prisma.wikiEntry.update({
        where: { id: existing.id },
        data: { body, tags, metadata: { digestId, newsCount: digest.newsItems.length } },
      });
    } else {
      await prisma.wikiEntry.create({
        data: {
          entryType: 'daily_digest',
          title,
          body,
          tags,
          refDate,
          metadata: { digestId, newsCount: digest.newsItems.length },
        },
      });
    }

    console.log(`[wiki-db] daily_digest: cached ${digest.newsItems.length} items for ${dateStr}`);
  } finally {
    if (ownPrisma) await prisma.$disconnect();
  }
}

// ── Narrative ─────────────────────────────────────────────────────────────────

/**
 * Generate a weekly narrative from ledger entries using LM Studio.
 * NEVER reads previous narratives — only ledger rows as input.
 * weekStart / weekEnd: ISO date strings "YYYY-MM-DD"
 */
export async function writeNarrativeEntry(
  weekStart: string,
  weekEnd: string,
  prismaClient?: PrismaClient,
): Promise<string | null> {
  const prisma = prismaClient ?? new PrismaClient();
  const ownPrisma = !prismaClient;

  try {
    const from = new Date(weekStart); from.setUTCHours(0, 0, 0, 0);
    const to = new Date(weekEnd);     to.setUTCHours(23, 59, 59, 999);

    // Load ledger entries for the week — numbers+URLs only, no narrative
    const ledgerRows = await prisma.wikiEntry.findMany({
      where: { entryType: 'ledger', refDate: { gte: from, lte: to } },
      orderBy: [{ refDate: 'asc' }],
    });

    if (ledgerRows.length === 0) {
      console.warn(`[wiki-db] narrative: no ledger rows for ${weekStart}~${weekEnd}`);
      return null;
    }

    // Build a compact ledger table for LM Studio — structured data only
    const ledgerText = ledgerRows
      .map((r) => {
        const meta = r.metadata as Record<string, unknown>;
        const date = r.refDate?.toISOString().slice(0, 10) ?? '';
        return `${date} | ${meta.entityName ?? r.title} | ${meta.metricKey} | ${r.body}${r.sourceUrl ? ` | ${r.sourceUrl}` : ''}`;
      })
      .join('\n');

    // LM Studio call — dynamic import to avoid bundler issues
    const { chatJSON } = await import('@/lib/llm');

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          '당신은 뉴스 데이터 분석가입니다. 아래 수치 데이터만 참고하여 주간 트렌드 요약을 작성하세요. ' +
          '반드시 제공된 데이터에 근거한 사실만 서술하고, 추측이나 이전 지식을 추가하지 마세요.',
      },
      {
        role: 'user',
        content:
          `다음은 ${weekStart}~${weekEnd} 기간의 엔티티 통계 원시 데이터입니다:\n\n` +
          `날짜 | 엔티티 | 지표 | 값 | 출처\n` +
          `${'-'.repeat(60)}\n` +
          ledgerText +
          `\n\n위 데이터를 바탕으로 주간 뉴스 트렌드 요약을 한국어로 작성하세요. ` +
          `반드시 데이터에 있는 수치를 인용하고, 주요 등락·언급 급증 엔티티를 강조하세요. ` +
          `300~500자 이내로 작성하세요.`,
      },
    ];

    const body = await chat(messages, { temperature: 0.3, maxTokens: 1024 });
    if (!body?.trim()) return null;

    const title = `주간 트렌드 내러티브 ${weekStart}~${weekEnd}`;
    const tags = ['narrative', 'weekly', weekStart, weekEnd];

    const existing = await prisma.wikiEntry.findFirst({
      where: {
        entryType: 'narrative',
        refDate: from,
      },
    });

    if (existing) {
      await prisma.wikiEntry.update({
        where: { id: existing.id },
        data: { title, body, tags, metadata: { weekStart, weekEnd, ledgerRowCount: ledgerRows.length } },
      });
    } else {
      await prisma.wikiEntry.create({
        data: {
          entryType: 'narrative',
          title,
          body,
          tags,
          refDate: from,
          metadata: { weekStart, weekEnd, ledgerRowCount: ledgerRows.length },
        },
      });
    }

    console.log(`[wiki-db] narrative: generated for ${weekStart}~${weekEnd} (${ledgerRows.length} ledger rows)`);
    return body;
  } finally {
    if (ownPrisma) await prisma.$disconnect();
  }
}
