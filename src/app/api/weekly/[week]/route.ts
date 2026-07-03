/**
 * GET /api/weekly/[week]
 * Returns a weekly briefing + its daily digest list.
 *
 * Accepts two formats for the [week] param:
 *   - ISO week  : "2026-W16"     (Monday of that ISO week)
 *   - Plain date: "2026-04-13"   (treated as week-start directly)
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/** Convert ISO week string "YYYY-Www" to the Monday Date of that week. */
function parseISOWeek(s: string): Date | null {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(s);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const weekNum = parseInt(m[2], 10);
  // Jan 4 is always in ISO week 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = jan4.getUTCDay(); // 0=Sun
  const mondayW1 = new Date(jan4.getTime() - (dow === 0 ? 6 : dow - 1) * 86_400_000);
  return new Date(mondayW1.getTime() + (weekNum - 1) * 7 * 86_400_000);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ week: string }> },
) {
  const { week } = await params;
  // Try ISO week format first, then plain date
  let weekStart = parseISOWeek(week) ?? new Date(week);

  if (isNaN(weekStart.getTime())) {
    return NextResponse.json({ error: 'Invalid week parameter (use YYYY-Www or YYYY-MM-DD)' }, { status: 400 });
  }

  weekStart.setUTCHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart.getTime() + 6 * 86_400_000);
  weekEnd.setUTCHours(0, 0, 0, 0);

  const [weekly, dailyDigests] = await Promise.all([
    prisma.weeklyDigest.findFirst({ where: { weekStart } }),
    prisma.dailyDigest.findMany({
      where: { date: { gte: weekStart, lte: weekEnd } },
      orderBy: { date: 'asc' },
      select: { id: true, date: true, status: true },
    }),
  ]);

  if (!weekly) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    ...weekly,
    dailyDigests: dailyDigests.map((d) => ({
      id: d.id,
      date: d.date.toISOString().slice(0, 10),
      status: d.status,
    })),
  });
}
