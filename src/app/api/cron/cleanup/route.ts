/**
 * POST /api/cron/cleanup
 * Runs every Sunday at midnight KST (cron: "0 15 * * 0" UTC).
 *
 * 1. Delete DailyDigest records older than 90 days (cascades to NewsItem,
 *    CategoryBriefing, MarketDaily).
 * 2. Delete ContextTagHistory entries not seen in 60+ days.
 *
 * Authentication: Authorization: Bearer <CRON_SECRET>
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

function verifyCronSecret(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${cronSecret}`;
}

export async function POST(req: Request) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();

  // ── 1. Delete DailyDigests older than 90 days (cascades to all children) ──
  const cutoff90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  cutoff90.setUTCHours(0, 0, 0, 0);

  const { count: digestsDeleted } = await prisma.dailyDigest.deleteMany({
    where: { date: { lt: cutoff90 } },
  });

  // ── 2. Delete stale ContextTagHistory (not seen in 60 days) ───────────────
  const cutoff60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  cutoff60.setUTCHours(0, 0, 0, 0);

  const { count: tagsDeleted } = await prisma.contextTagHistory.deleteMany({
    where: { lastSeenDate: { lt: cutoff60 } },
  });

  const result = {
    cleanedAt: now.toISOString(),
    digestsDeleted,
    tagsDeleted,
  };

  console.log('[cleanup]', result);
  return NextResponse.json(result);
}
