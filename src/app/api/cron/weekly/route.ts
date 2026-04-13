/**
 * GET /api/cron/weekly  (also POST for backward compat)
 * Triggered every Sunday at 20:00 KST (cron: "0 11 * * 0" UTC).
 * Generates the weekly digest and sends a Slack notification.
 *
 * Authentication: Authorization: Bearer <CRON_SECRET>
 */

import { NextResponse } from 'next/server';
import { sendSlack } from '@/lib/slack';

function verifyCronSecret(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true; // not set → open (dev mode)
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${cronSecret}`;
}

export async function POST(req: Request) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const host = req.headers.get('host') ?? 'localhost:3000';
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
  const baseUrl = process.env.NEXTAUTH_URL ?? `${protocol}://${host}`;

  // weekStart = most recent Monday
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday
  const daysBack = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now.getTime() - daysBack * 86_400_000);
  weekStart.setUTCHours(0, 0, 0, 0);
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  const res = await fetch(`${baseUrl}/api/weekly/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weekStart: weekStartStr }),
  });

  const data = await res.json() as {
    weeklyId?: string;
    message?: string;
    weekStart?: string;
    // Phase 4 content surfaced by generate route
    executive_summary?: string;
    weekly_top5?: Array<{ rank?: number; title?: string }>;
  };

  if (res.ok) {
    const summaryLine = data.executive_summary
      ? `> ${data.executive_summary.slice(0, 200)}`
      : '';
    const top5Lines = (data.weekly_top5 ?? [])
      .slice(0, 5)
      .map((item, i) => `${i + 1}. ${item.title ?? ''}`)
      .join('\n');

    await sendSlack(
      [
        `📊 *주간 브리핑* (${weekStartStr} 주간)`,
        summaryLine,
        top5Lines || '주간 브리핑 생성 완료',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  return NextResponse.json(data, { status: res.status });
}

// Spec requires GET (Vercel Cron / GitHub Actions / external schedulers use GET)
export const GET = POST;
