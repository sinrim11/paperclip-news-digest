/**
 * POST /api/ab/rerank  — trigger LLM batched persona-conditional rerank (CMP-147)
 * GET  /api/ab/rerank  — read stored PersonaRankResult records for a date
 *
 * Shadow mode: does not modify the existing digest pipeline.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { runPersonaRerank } from '@/lib/persona-reranker';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as {
    date?: string;
    force?: boolean;
    hardDeadlineMinutesFromNow?: number;
  };

  const kst = new Date();
  kst.setTime(kst.getTime() + 9 * 60 * 60 * 1000);
  const dateStr = body.date ?? kst.toISOString().slice(0, 10);
  const force = body.force ?? false;

  // Check for existing results unless forced
  if (!force) {
    const digest = await prisma.dailyDigest.findFirst({
      where: { date: new Date(dateStr), archived: false },
      select: { id: true },
    });
    if (digest) {
      const existing = await prisma.personaRankResult.findMany({
        where: { digestId: digest.id },
        select: { personaId: true, updatedAt: true },
      });
      if (existing.length >= 3) {
        return NextResponse.json({
          message: 'Already reranked. Use force=true to re-run.',
          date: dateStr,
          personas: existing.map((r) => ({ personaId: r.personaId, updatedAt: r.updatedAt })),
        });
      }
    }
  }

  // Hard deadline: 03:45 KST by default, or custom offset
  let hardDeadline: Date | undefined;
  if (body.hardDeadlineMinutesFromNow !== undefined) {
    hardDeadline = new Date(Date.now() + body.hardDeadlineMinutesFromNow * 60_000);
  } else {
    // Default: 03:45 KST today = 18:45 UTC
    const now = new Date();
    const hardStop = new Date(now);
    hardStop.setUTCHours(18, 45, 0, 0);
    // If already past 18:45 UTC, set to 30 min from now (test/manual run)
    hardDeadline = now < hardStop ? hardStop : new Date(now.getTime() + 30 * 60_000);
  }

  try {
    const results = await runPersonaRerank({ digestDate: dateStr, hardDeadline });
    return NextResponse.json({ date: dateStr, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const kst = new Date();
  kst.setTime(kst.getTime() + 9 * 60 * 60 * 1000);
  const dateStr = searchParams.get('date') ?? kst.toISOString().slice(0, 10);

  const digest = await prisma.dailyDigest.findFirst({
    where: { date: new Date(dateStr), archived: false },
    select: { id: true },
  });

  if (!digest) {
    return NextResponse.json({ error: `No digest found for ${dateStr}` }, { status: 404 });
  }

  const results = await prisma.personaRankResult.findMany({
    where: { digestId: digest.id },
    orderBy: { personaId: 'asc' },
  });

  return NextResponse.json({ date: dateStr, count: results.length, results });
}
