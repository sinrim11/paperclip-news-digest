import { collectByCategory } from '../src/lib/news-collector';
import type { RawArticle } from '../src/lib/types';

const ENTITY_STOP_ABBRS = new Set(['AI', 'US', 'UK', 'EU', 'UN', 'WHO', 'NATO', 'IMF', 'GDP', 'CEO', 'IT', 'IPO', 'PE', 'VC']);
function tokenize(t: string) { return new Set(t.toLowerCase().split(/[\s\-_,.()\[\]\/]+/).filter(w => w.length > 1)); }
function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0; let i=0; for (const t of a) if (b.has(t)) i++; return i/(a.size+b.size-i);
}
function extractEntities(text: string) {
  const e = new Set<string>();
  for (const m of text.matchAll(/\b[A-Z]{2,6}\b/g)) if (!ENTITY_STOP_ABBRS.has(m[0])) e.add(m[0]);
  for (const m of text.matchAll(/\b[A-Z][a-z]{3,}\b/g)) e.add(m[0].toLowerCase());
  for (const m of text.matchAll(/\b\d+(?:[.,]\d+)?(?:%|bp|bps|B|M|K|T|x)?\b/g)) if (m[0].length > 1) e.add(m[0]);
  return e;
}
async function main() {
  const raw = await collectByCategory(12);
  const arts: RawArticle[] = (raw.get('STOCKS') ?? []).flatMap(c => c.articles);
  console.log('STOCKS articles:', arts.map(a => `[${a.source.slice(0,8)}] ${a.title.slice(0,50)}`).join('\n'));
  const pairs = [];
  for (let i=0; i<arts.length; i++)
    for (let j=i+1; j<arts.length; j++)
      if (arts[i].source !== arts[j].source) {
        const t = jaccard(tokenize(arts[i].title), tokenize(arts[j].title));
        const en = jaccard(extractEntities(arts[i].title), extractEntities(arts[j].title));
        pairs.push({ c: t*0.40+en*0.35, t, en, a: `[${arts[i].source.slice(0,8)}] ${arts[i].title.slice(0,40)}`, b: `[${arts[j].source.slice(0,8)}] ${arts[j].title.slice(0,40)}` });
      }
  pairs.sort((a,b) => b.c-a.c);
  console.log('\nTop 5 cross-source pairs:');
  for (const p of pairs.slice(0,5)) console.log(`  c=${p.c.toFixed(3)} t=${p.t.toFixed(2)} en=${p.en.toFixed(2)}\n    ${p.a}\n    ${p.b}`);
}
main().catch(console.error);
