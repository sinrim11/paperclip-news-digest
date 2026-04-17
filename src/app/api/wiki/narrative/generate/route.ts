/**
 * POST /api/wiki/narrative/generate
 *
 * Generates a weekly narrative WikiEntry from ledger data via LM Studio.
 * Input: { weekStart: "YYYY-MM-DD", weekEnd: "YYYY-MM-DD" }
 * Constraint: reads ledger entries ONLY — never previous narratives.
 */

import { NextResponse } from 'next/server';
import { writeNarrativeEntry } from '@/lib/wiki-db';

export async function POST(req: Request) {
  let weekStart: string | undefined;
  let weekEnd: string | undefined;

  try {
    const body = await req.json().catch(() => ({})) as { weekStart?: string; weekEnd?: string };
    weekStart = body.weekStart;
    weekEnd   = body.weekEnd;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!weekStart || !weekEnd) {
    // Default to current ISO week (Mon–Sun)
    const now = new Date();
    const day = now.getUTCDay(); // 0=Sun
    const diffToMon = (day === 0 ? -6 : 1 - day);
    const mon = new Date(now);
    mon.setUTCDate(now.getUTCDate() + diffToMon);
    mon.setUTCHours(0, 0, 0, 0);
    const sun = new Date(mon);
    sun.setUTCDate(mon.getUTCDate() + 6);

    weekStart = mon.toISOString().slice(0, 10);
    weekEnd   = sun.toISOString().slice(0, 10);
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || !/^\d{4}-\d{2}-\d{2}$/.test(weekEnd)) {
    return NextResponse.json({ error: 'weekStart/weekEnd must be YYYY-MM-DD' }, { status: 400 });
  }
  if (weekStart > weekEnd) {
    return NextResponse.json({ error: 'weekStart must be <= weekEnd' }, { status: 400 });
  }

  const body = await writeNarrativeEntry(weekStart, weekEnd);

  if (!body) {
    return NextResponse.json(
      { message: 'No ledger data found for this week — narrative skipped', weekStart, weekEnd },
      { status: 200 },
    );
  }

  return NextResponse.json({ weekStart, weekEnd, narrative: body });
}
