/**
 * GET /api/cron/rerank  (also POST for backward compat)
 * Triggered at 02:00 KST (17:00 UTC) every day.
 * Hard timeout: 03:45 KST (103 min window).
 * Runs persona-conditional LLM rerank for 3 synthetic personas (A/B/C).
 * Falls back to deterministic ranker results on timeout or LLM error.
 */

import { NextResponse } from 'next/server';
import { runPersonaRerank } from '@/lib/persona-reranker';

const TIMEOUT_MINUTES = 103; // 02:00 → 03:43 KST (2 min buffer before 03:45 hard cutoff)

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

  const hardDeadline = new Date(Date.now() + TIMEOUT_MINUTES * 60 * 1000);

  const kst = new Date();
  kst.setTime(kst.getTime() + 9 * 60 * 60 * 1000);
  const today = kst.toISOString().slice(0, 10);

  try {
    const results = await runPersonaRerank({ digestDate: today, hardDeadline });

    return NextResponse.json({
      date: today,
      personas: results,
      deadlineUtc: hardDeadline.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, date: today }, { status: 500 });
  }
}

export const GET = POST;
