// 일회성 백필: 최근 14일 발송 단지의 "이미 알린 신저가"를 기록해 재등장 반복 즉시 차단
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const now = Date.now();
  const cooldownSince = new Date(now - 14 * 86_400_000).toISOString().slice(0, 10);
  const windowSince = new Date(now - 14 * 86_400_000);
  const sent = await prisma.sentRecommendation.findMany({
    where: { sentDate: { gte: cooldownSince }, scenario: { not: '스트레치+' }, signalLowManwon: null },
    orderBy: { sentDate: 'desc' },
  });
  const doneKeys = new Set<string>();
  let updated = 0;
  for (const s of sent) {
    if (doneKeys.has(s.complexKey)) continue;
    doneKeys.add(s.complexKey);
    const [lawdCd, dong, aptName] = s.complexKey.split('|');
    const low = await prisma.aptTrade.aggregate({
      where: { lawdCd, dong, aptName, dealDate: { gte: windowSince } },
      _min: { dealAmount: true },
    });
    if (low._min.dealAmount == null) continue;
    await prisma.sentRecommendation.update({ where: { id: s.id }, data: { signalLowManwon: low._min.dealAmount } });
    updated++;
    console.log(`${s.complexKey} → 알린 저가 ${low._min.dealAmount}만원 기록 (${s.sentDate})`);
  }
  console.log(`백필 완료: ${updated}건`);
}
main().finally(() => prisma.$disconnect());
