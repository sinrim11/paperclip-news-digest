import { collectByCategory } from '../src/lib/news-collector';
import type { RawArticle } from '../src/lib/types';
const STOP = new Set(['AI','US','UK','EU','UN','WHO','NATO','IMF','GDP','CEO','IT','IPO','PE','VC']);
function tok(t: string) { return new Set(t.toLowerCase().split(/[\s\-_,.()\[\]\/]+/).filter(w => w.length > 1)); }
function jac(a: Set<string>, b: Set<string>) { if (!a.size || !b.size) return 0; let i=0; for (const t of a) if (b.has(t)) i++; return i/(a.size+b.size-i); }
function ent(text: string) {
  const e = new Set<string>();
  for (const m of text.matchAll(/\b[A-Z]{2,6}\b/g)) if (!STOP.has(m[0])) e.add(m[0]);
  for (const m of text.matchAll(/\b[A-Z][a-z]{3,}\b/g)) e.add(m[0].toLowerCase());
  for (const m of text.matchAll(/([가-힣]{2,6})(?=은|는|이|가|을|를|의|에|에서|으로|로|와|과|도)/g)) e.add(m[1]);
  return e;
}
async function main() {
  const raw = await collectByCategory(12);
  const arts: RawArticle[] = (raw.get('REALESTATE') ?? []).flatMap(c => c.articles);
  console.log('REALESTATE:', arts.map(a => `[${a.source.slice(0,6)}] ${a.title.slice(0,45)}`).join('\n'));
  const pairs = [];
  for (let i=0; i<arts.length; i++)
    for (let j=i+1; j<arts.length; j++)
      if (arts[i].source !== arts[j].source) {
        const t = jac(tok(arts[i].title), tok(arts[j].title));
        const en = jac(ent(arts[i].title), ent(arts[j].title));
        pairs.push({ c: t*0.40+en*0.35, t, en, a: arts[i].title.slice(0,45), b: arts[j].title.slice(0,45) });
      }
  pairs.sort((a,b) => b.c-a.c);
  console.log('\nTop 8 cross-source pairs:');
  for (const p of pairs.slice(0,8))
    console.log(`  c=${p.c.toFixed(3)} t=${p.t.toFixed(2)} en=${p.en.toFixed(2)}\n    ${p.a}\n    ${p.b}`);
}
main().catch(console.error);
