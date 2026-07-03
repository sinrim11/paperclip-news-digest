import { collectByCategory } from '../src/lib/news-collector';
import type { RawArticle } from '../src/lib/types';

function tokenize(t: string) { return new Set(t.toLowerCase().split(/[\s\-_,.()\[\]\/]+/).filter(w => w.length > 1)); }
function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let i = 0; for (const t of a) if (b.has(t)) i++;
  return i / (a.size + b.size - i);
}
function entities(text: string) {
  const e = new Set<string>();
  for (const m of text.matchAll(/\b[A-Z]{2,6}\b/g)) e.add(m[0]);
  for (const m of text.matchAll(/\b[A-Z][a-z]{2,}\b/g)) e.add(m[0].toLowerCase());
  for (const m of text.matchAll(/([가-힣]{2,6})(?=은|는|이|가|을|를|의|에|에서|으로|로|와|과|도)/g)) e.add(m[1]);
  return e;
}
function bigrams(t: string) {
  const w = t.slice(0,300).toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const b = new Set<string>();
  for (let i = 0; i < w.length-1; i++) b.add(`${w[i]}|${w[i+1]}`);
  return b;
}
function sim(a: RawArticle, b: RawArticle) {
  const t = jaccard(tokenize(a.title), tokenize(b.title));
  const en = jaccard(entities(a.title+' '+a.content), entities(b.title+' '+b.content));
  const bg = jaccard(bigrams(a.content), bigrams(b.content));
  return { c: t*0.40+en*0.35+bg*0.25, t, en, bg };
}

async function main() {
  const raw = await collectByCategory(12);
  for (const cat of ['REALESTATE', 'STOCKS'] as const) {
    const clusters = raw.get(cat) ?? [];
    const arts: RawArticle[] = clusters.flatMap(c => c.articles);
    console.log(`\n=== ${cat}: ${arts.length} articles ===`);
    const pairs = [];
    for (let i = 0; i < arts.length; i++)
      for (let j = i+1; j < arts.length; j++) {
        const s = sim(arts[i], arts[j]);
        if (arts[i].source !== arts[j].source)
          pairs.push({ ...s, a: `[${arts[i].source.slice(0,12)}] ${arts[i].title.slice(0,35)}`, b: `[${arts[j].source.slice(0,12)}] ${arts[j].title.slice(0,35)}` });
      }
    pairs.sort((a,b) => b.c - a.c);
    for (const p of pairs.slice(0, 5))
      console.log(`  c=${p.c.toFixed(3)} t=${p.t.toFixed(2)} en=${p.en.toFixed(2)} bg=${p.bg.toFixed(2)}\n    ${p.a}\n    ${p.b}`);
  }
}
main().catch(console.error);
