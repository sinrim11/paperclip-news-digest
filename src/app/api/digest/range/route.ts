import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  if (!from || !to) {
    return NextResponse.json({ error: 'from and to query params required' }, { status: 400 });
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
  }

  fromDate.setUTCHours(0, 0, 0, 0);
  toDate.setUTCHours(23, 59, 59, 999);

  const digests = await prisma.dailyDigest.findMany({
    where: { date: { gte: fromDate, lte: toDate }, status: 'done' },
    orderBy: { date: 'desc' },
    include: {
      marketDaily: true,
      categoryBriefings: true,
      newsItems: { where: { isTop3: true }, orderBy: { top3Rank: 'asc' } },
    },
  });

  return NextResponse.json(digests);
}
