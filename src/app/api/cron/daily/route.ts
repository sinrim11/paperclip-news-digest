/**
 * GET /api/cron/daily  (also POST for backward compat)
 * Triggered at 06:30 KST by launchd (com.news-digest.daily).
 * Generates today's digest via direct function call — NOT an HTTP self-call,
 * which used to die on undici's 300s headersTimeout during long generations —
 * then sends Slack/Telegram notifications with market + TOP3 from the DB.
 *
 * Authentication: Authorization: Bearer <CRON_SECRET>
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generateDailyDigest } from '@/lib/generate-digest';
import { sendSlack } from '@/lib/slack';
import { sendTelegram } from '@/lib/telegram';

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

  // KST 기준 오늘 날짜 (06:30 KST 실행)
  const kst = new Date();
  kst.setTime(kst.getTime() + 9 * 60 * 60 * 1000);
  const today = kst.toISOString().slice(0, 10);

  const { status, payload } = await generateDailyDigest({ date: today });

  if (status === 200) {
    // Notification content comes from the DB (single source of truth)
    const targetDate = new Date(today);
    targetDate.setUTCHours(0, 0, 0, 0);
    const digest = await prisma.dailyDigest.findFirst({
      where: { date: targetDate, archived: false },
      include: {
        marketDaily: true,
        newsItems: {
          where: { isTop3: true },
          orderBy: { top3Rank: 'asc' },
          select: { title: true, top3Rank: true, category: true },
        },
      },
    });

    const m = digest?.marketDaily;
    const marketLine = m?.kospiValue
      ? `📊 KOSPI ${m.kospiValue} (${m.kospiChange ?? ''})  ·  USD/KRW ${m.usdKrwValue ?? '-'}`
      : '';
    const top3Lines = (digest?.newsItems ?? [])
      .slice(0, 3)
      .map((item, i) => `${item.top3Rank ?? i + 1}. [${item.category}] ${item.title}`)
      .join('\n');

    const notifyText = [
      `🔥 오늘의 핵심 3선 (${today})`,
      marketLine,
      top3Lines || '다이제스트 생성 완료',
      `📎 ${process.env.PUBLIC_DASHBOARD_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3200'}`,
    ]
      .filter(Boolean)
      .join('\n');

    await Promise.all([sendSlack(notifyText), sendTelegram(notifyText)]);
  } else {
    await sendTelegram(`⚠️ [뉴스다이제스트] ${today} 생성 실패 — 수동 확인 필요 (${JSON.stringify(payload).slice(0, 150)})`);
  }

  return NextResponse.json(payload, { status });
}

// GET for external schedulers / manual curl
export const GET = POST;
