import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import type { CategoryKey } from '@/lib/types';

const VALID_CATEGORIES = ['GLOBAL', 'STOCKS', 'AI', 'POLICY', 'REALESTATE'];
const VALID_URGENCIES = ['breaking', 'watch', 'note'];
const MAX_LIMIT = 50;

/**
 * GET /api/digest/search
 * Query params:
 *   q        — keyword (searches title, fact, impact, action)
 *   category — filter by CategoryKey enum value
 *   urgency  — filter by urgency level
 *   from     — start date YYYY-MM-DD (inclusive)
 *   to       — end date YYYY-MM-DD (inclusive)
 *   limit    — page size (default 20, max 50)
 *   page     — 1-based page number (default 1)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const q = searchParams.get('q')?.trim() ?? '';
  const category = searchParams.get('category');
  const urgency = searchParams.get('urgency');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), MAX_LIMIT);
  const page = Math.max(parseInt(searchParams.get('page') ?? '1', 10), 1);

  if (!q && !category && !urgency && !from && !to) {
    return NextResponse.json({ error: 'At least one search parameter required' }, { status: 400 });
  }

  if (category && !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: `Invalid category: ${category}` }, { status: 400 });
  }
  if (urgency && !VALID_URGENCIES.includes(urgency)) {
    return NextResponse.json({ error: `Invalid urgency: ${urgency}` }, { status: 400 });
  }

  // ── Date range filter via join on DailyDigest ─────────────────────────────
  const digestWhere: Record<string, unknown> = { status: 'done', archived: false };
  if (from || to) {
    const dateFilter: Record<string, Date> = {};
    if (from) {
      const d = new Date(from);
      if (isNaN(d.getTime())) return NextResponse.json({ error: 'Invalid from date' }, { status: 400 });
      d.setUTCHours(0, 0, 0, 0);
      dateFilter.gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (isNaN(d.getTime())) return NextResponse.json({ error: 'Invalid to date' }, { status: 400 });
      d.setUTCHours(23, 59, 59, 999);
      dateFilter.lte = d;
    }
    digestWhere.date = dateFilter;
  }

  // ── NewsItem where clause ─────────────────────────────────────────────────
  const itemWhere: Record<string, unknown> = {
    archived: false,
    digest: digestWhere,
  };

  if (category) itemWhere.category = category as CategoryKey;
  if (urgency) itemWhere.urgency = urgency;

  if (q) {
    itemWhere.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { fact: { contains: q, mode: 'insensitive' } },
      { impact: { contains: q, mode: 'insensitive' } },
      { action: { contains: q, mode: 'insensitive' } },
      { contextTags: { hasSome: [q] } },
    ];
  }

  const [total, items] = await Promise.all([
    prisma.newsItem.count({ where: itemWhere }),
    prisma.newsItem.findMany({
      where: itemWhere,
      orderBy: [
        { digest: { date: 'desc' } },
        { urgency: 'asc' },
        { newsOrder: 'asc' },
      ],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        digest: { select: { date: true, status: true } },
      },
    }),
  ]);

  return NextResponse.json({
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
    items: items.map((item) => ({
      ...item,
      digestDate: item.digest.date.toISOString().slice(0, 10),
    })),
  });
}
