import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  const d = await p.dailyDigest.findFirst({
    where: { archived: false },
    orderBy: { createdAt: 'desc' },
    include: {
      newsItems: { select: { sourceCount: true, consensusFacts: true, category: true, title: true } },
    },
  });
  if (!d) { console.log('no digest found'); return; }
  console.log(`status: ${d.status} | total items: ${d.newsItems.length}`);

  type Stats = { total: number; multi: number; withConsensus: number };
  const byCat: Record<string, Stats> = {};
  for (const n of d.newsItems) {
    const s = byCat[n.category] ?? (byCat[n.category] = { total: 0, multi: 0, withConsensus: 0 });
    s.total++;
    if ((n.sourceCount ?? 1) >= 2) s.multi++;
    if (n.consensusFacts) s.withConsensus++;
  }

  let totalMulti = 0;
  let totalWithConsensus = 0;
  for (const [cat, v] of Object.entries(byCat)) {
    const pct = v.multi > 0 ? Math.round((v.withConsensus / v.multi) * 100) : 0;
    console.log(`${cat}: total=${v.total} multi-source=${v.multi} consensusFacts=${v.withConsensus} (${pct}%)`);
    totalMulti += v.multi;
    totalWithConsensus += v.withConsensus;
  }

  console.log('\n=== VERIFICATION ===');
  const catResults = Object.entries(byCat);
  const crit1 = catResults.every(([, v]) => v.multi >= 2);
  const multiPct = totalMulti > 0 ? Math.round((totalWithConsensus / totalMulti) * 100) : 0;
  const crit2 = multiPct >= 80;
  console.log(`1. Every category has >= 2 multi-source clusters: ${crit1 ? 'PASS' : 'FAIL'}`);
  console.log(`2. consensusFacts coverage >= 80%: ${crit2 ? 'PASS' : 'FAIL'} (${multiPct}%)`);
  console.log(`3. [N곳 공통 보도] prefix in fact — check manually in UI`);
}

main().catch(console.error).finally(() => p.$disconnect());
