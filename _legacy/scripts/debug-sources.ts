import { collectByCategory } from '../src/lib/news-collector';
async function main() {
  const raw = await collectByCategory(12);
  for (const cat of ['REALESTATE', 'STOCKS'] as const) {
    const arts = (raw.get(cat) ?? []).flatMap(c => c.articles);
    const bySrc: Record<string, number> = {};
    for (const a of arts) bySrc[a.source] = (bySrc[a.source] ?? 0) + 1;
    console.log(`${cat} (${arts.length} total):`, bySrc);
  }
}
main().catch(console.error);
