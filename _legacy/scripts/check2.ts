import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const d = await p.dailyDigest.findFirst({ where: { id: 'cmo1p0woa0000406ioon4iq72' }, include: { newsItems: { select: { category: true, sourceCount: true } } } });
  if (!d) { console.log('digest not found'); return; }
  console.log('digest:', d.id, d.status, d.date);
  const byCat: Record<string, number[]> = {};
  for (const i of d.newsItems) { (byCat[i.category] ??= []).push(i.sourceCount ?? 1); }
  for (const [cat, counts] of Object.entries(byCat)) {
    console.log(cat, 'multi:', counts.filter(c=>c>=2).length, '/', counts.length, '— counts:', counts.join(','));
  }
}
main().catch(console.error).finally(() => p.$disconnect());
