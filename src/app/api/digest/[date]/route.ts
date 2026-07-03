import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ date: string }> },
) {
  const { date } = await params;
  const target = new Date(date);

  if (isNaN(target.getTime())) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }

  target.setUTCHours(0, 0, 0, 0);

  const digest = await prisma.dailyDigest.findFirst({
    where: { date: target },
    include: {
      marketDaily: true,
      categoryBriefings: { orderBy: { category: 'asc' } },
      newsItems: { orderBy: [{ category: 'asc' }, { newsOrder: 'asc' }] },
    },
  });

  if (!digest) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(digest);
}
