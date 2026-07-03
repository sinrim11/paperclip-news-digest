/**
 * POST /api/digest/generate — thin HTTP wrapper.
 * Orchestration lives in src/lib/generate-digest.ts (shared with /api/cron/daily).
 */

import { NextResponse } from 'next/server';
import { generateDailyDigest, type GenerateDigestParams } from '@/lib/generate-digest';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as GenerateDigestParams;
  const { status, payload } = await generateDailyDigest(body);
  return NextResponse.json(payload, { status });
}
