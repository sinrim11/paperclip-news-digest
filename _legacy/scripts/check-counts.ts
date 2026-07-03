import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const d = await p.dailyDigest.findFirst({ where: { id: 'cmo1p0woa0000406ioon4iq72' } });
  const items = await p.newsItem.findMany({
    where: { digestId: d!.id, category: 'REALESTATE' },
    select: { title: true, sourceCount: true, sourceUrl: true, sourceList: true }
  });
  for (const i of items) {
    console.log(`sc=${i.sourceCount} url=${i.sourceUrl?.slice(0,60)}`);
    console.log(`  title=${i.title.slice(0,50)}`);
  }
}
main().catch(console.error).finally(() => p.$disconnect());
