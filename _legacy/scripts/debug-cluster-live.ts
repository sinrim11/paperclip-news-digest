import { collectByCategory } from '../src/lib/news-collector';
async function main() {
  const clusters = await collectByCategory(12);
  for (const [cat, cs] of clusters.entries()) {
    const multi = cs.filter(c => c.sourceCount >= 2);
    console.log(`${cat}: ${cs.length} clusters, ${multi.length} multi-source`);
    for (const c of multi.slice(0, 3)) {
      console.log(`  [${c.sourceCount} srcs: ${c.sourceList.join(', ')}] ${c.title.slice(0, 60)}`);
      console.log(`    url=${c.url}`);
      for (const a of c.articles) console.log(`    art.url=${a.url} src=${a.source}`);
    }
  }
}
main().catch(console.error);
