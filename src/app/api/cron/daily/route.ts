/**
 * POST /api/cron/daily
 * Called by the scheduler (or manually) to generate today's digest.
 * Delegates to /api/digest/generate.
 */

import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const host = req.headers.get('host') ?? 'localhost:3000';
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
  const baseUrl = process.env.NEXTAUTH_URL ?? `${protocol}://${host}`;

  const today = new Date().toISOString().slice(0, 10);

  const res = await fetch(`${baseUrl}/api/digest/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: today }),
  });

  const data = await res.json() as unknown;
  return NextResponse.json(data, { status: res.status });
}
