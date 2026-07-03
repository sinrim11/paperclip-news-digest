import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const d = await p.dailyDigest.findFirst({ where: { archived: false }, orderBy: { createdAt: 'desc' } });
  console.log('digest:', d?.id, d?.status, d?.createdAt);
  const items = await p.newsItem.findMany({ where: { digestId: d!.id }, select: { category: true, sourceCount: true } });
  const byCat: Record<string, number[]> = {};
  for (const i of items) { (byCat[i.category] ??= []).push(i.sourceCount ?? 1); }
  for (const [cat, counts] of Object.entries(byCat)) {
    console.log(cat, 'multi:', counts.filter(c=>c>=2).length, '/', counts.length, '— counts:', counts.join(','));
  }
}
main().catch(console.error).finally(() => p.$disconnect());
