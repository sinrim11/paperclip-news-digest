import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { choice, rationale, personaName, evalDate, snapshotA, snapshotB, scoresB } = body;

  if (!choice || !['A', 'B'].includes(choice)) {
    return NextResponse.json({ error: 'choice must be A or B' }, { status: 400 });
  }
  if (!rationale || rationale.trim().length < 10) {
    return NextResponse.json({ error: '이유는 최소 10자 이상 입력해야 합니다' }, { status: 400 });
  }

  const record = await prisma.aBEvaluation.create({
    data: {
      evalDate: new Date(evalDate),
      personaName: personaName ?? '미지정',
      choice,
      rationale: rationale.trim(),
      snapshotA: snapshotA ?? [],
      snapshotB: snapshotB ?? [],
      scoresB: scoresB ?? {},
    },
  });

  // Check consecutive B streak
  const recent = await prisma.aBEvaluation.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { choice: true },
  });
  const consecutiveB = recent.length === 3 && recent.every((r) => r.choice === 'B');

  return NextResponse.json({ id: record.id, consecutiveB });
}
