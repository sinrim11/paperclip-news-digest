/**
 * POST /api/cron/weekly
 * Called every Monday to generate the previous week's digest.
 */

import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const host = req.headers.get('host') ?? 'localhost:3000';
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
  const baseUrl = process.env.NEXTAUTH_URL ?? `${protocol}://${host}`;

  // weekStart = last Monday
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday
  const daysBack = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now.getTime() - daysBack * 86_400_000);
  weekStart.setUTCHours(0, 0, 0, 0);

  const res = await fetch(`${baseUrl}/api/weekly/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weekStart: weekStart.toISOString().slice(0, 10) }),
  });

  const data = await res.json() as unknown;
  return NextResponse.json(data, { status: res.status });
}
