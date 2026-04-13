import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date');

  const where = date
    ? { date: new Date(date) }
    : undefined;

  const market = date
    ? await prisma.marketDaily.findFirst({ where })
    : await prisma.marketDaily.findFirst({ orderBy: { date: 'desc' } });

  if (!market) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(market);
}
