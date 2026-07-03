import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  const evals = await prisma.aBEvaluation.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      evalDate: true,
      personaName: true,
      choice: true,
      rationale: true,
      createdAt: true,
    },
  });

  const total = await prisma.aBEvaluation.count();
  const bCount = await prisma.aBEvaluation.count({ where: { choice: 'B' } });
  const aCount = total - bCount;

  // Check consecutive B streak
  const recent = await prisma.aBEvaluation.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { choice: true },
  });
  const consecutiveB = recent.length === 3 && recent.every((r) => r.choice === 'B');

  return NextResponse.json({
    evals: evals.map((e) => ({
      ...e,
      evalDate: e.evalDate.toISOString().slice(0, 10),
      createdAt: e.createdAt.toISOString(),
    })),
    stats: { total, aCount, bCount, consecutiveB },
  });
}
