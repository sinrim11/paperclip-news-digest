/**
 * GET /api/cron/daily  (also POST for backward compat)
 * Triggered at 07:00 KST every day (cron: "0 22 * * *" UTC).
 * Generates today's digest and sends a Slack notification.
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
  // Use KST (UTC+9) — cron fires at 22:00 UTC = 07:00 KST next day,
  // so raw UTC date would be yesterday's date. Must offset to get KST date.
  const kst = new Date();
  kst.setTime(kst.getTime() + 9 * 60 * 60 * 1000);
  const today = kst.toISOString().slice(0, 10);

  const res = await fetch(`${baseUrl}/api/digest/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: today }),
  });

  const data = await res.json() as {
    digestId?: string;
    message?: string;
    market?: { kospi?: { value?: number; change?: string }; usdKrw?: { value?: number } };
    top3?: Array<{ title?: string; urgency?: string }>;
  };

  if (res.ok) {
    const marketLine = data.market?.kospi
      ? `📊 KOSPI ${data.market.kospi.value} (${data.market.kospi.change})  ·  USD/KRW ${data.market.usdKrw?.value}`
      : '';
    const top3Lines = (data.top3 ?? [])
      .slice(0, 3)
      .map((item, i) => `${i + 1}. ${item.title ?? ''}`)
      .join('\n');

    await sendSlack(
      [
        `🔥 *오늘의 핵심 3선* (${today})`,
        marketLine,
        top3Lines || '다이제스트 생성 완료',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  return NextResponse.json(data, { status: res.status });
}

// Spec requires GET (Vercel Cron / GitHub Actions / external schedulers use GET)
export const GET = POST;
