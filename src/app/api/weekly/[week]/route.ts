import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(
  _req: Request,
  { params }: { params: { week: string } },
) {
  const weekStart = new Date(params.week);

  if (isNaN(weekStart.getTime())) {
    return NextResponse.json({ error: 'Invalid week date' }, { status: 400 });
  }

  weekStart.setUTCHours(0, 0, 0, 0);

  const weekly = await prisma.weeklyDigest.findFirst({ where: { weekStart } });

  if (!weekly) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(weekly);
}
