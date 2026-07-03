/**
 * Debug script: fetch GLOBAL RSS feeds and print top composite similarity pairs
 * to determine if threshold 0.55 is the right value.
 */
import { collectByCategory } from '../src/lib/news-collector';
import type { RawArticle } from '../src/lib/types';

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[\s\-_,.()\[\]\/]+/).filter((t) => t.length > 1));
}
function jaccardSim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
function extractEntities(text: string): Set<string> {
  const e = new Set<string>();
  for (const m of text.matchAll(/\b[A-Z]{2,6}\b/g)) e.add(m[0]);
  for (const m of text.matchAll(/\b[A-Z][a-z]{2,}\b/g)) e.add(m[0].toLowerCase());
  for (const m of text.matchAll(/\b\d+(?:[.,]\d+)?(?:%|B|M|K|T|x)?\b/g)) { if (m[0].length > 1) e.add(m[0]); }
  for (const m of text.matchAll(/([가-힣]{2,6})(?=은|는|이|가|을|를|의|에|에서|으로|로|와|과|도)/g)) e.add(m[1]);
  return e;
}
function bigramSet(text: string): Set<string> {
  const words = text.slice(0, 300).toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const b = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) b.add(`${words[i]}|${words[i + 1]}`);
  return b;
}
function compositeSim(a: RawArticle, b: RawArticle) {
  const t = jaccardSim(tokenize(a.title), tokenize(b.title));
  const en = jaccardSim(extractEntities(a.title + ' ' + a.content), extractEntities(b.title + ' ' + b.content));
  const bg = jaccardSim(bigramSet(a.content), bigramSet(b.content));
  return { composite: t*0.40 + en*0.35 + bg*0.25, t, en, bg };
}

async function main() {
const raw = await collectByCategory(20);
for (const cat of ['GLOBAL','STOCKS','AI'] as const) {
  const clusters = raw.get(cat) ?? [];
  // Get raw articles from clusters
  const arts: RawArticle[] = clusters.flatMap(c => c.articles);
  console.log(`\n=== ${cat}: ${arts.length} articles ===`);
  // Print top 5 highest-sim pairs
  const pairs: { sim: number; t: number; en: number; bg: number; a: string; b: string }[] = [];
  for (let i = 0; i < Math.min(arts.length, 20); i++) {
    for (let j = i+1; j < Math.min(arts.length, 20); j++) {
      const s = compositeSim(arts[i], arts[j]);
      pairs.push({ sim: s.composite, t: s.t, en: s.en, bg: s.bg, a: `[${arts[i].source}] ${arts[i].title.slice(0,40)}`, b: `[${arts[j].source}] ${arts[j].title.slice(0,40)}` });
    }
  }
  pairs.sort((a,b) => b.sim - a.sim);
  for (const p of pairs.slice(0,5)) {
    console.log(`  sim=${p.sim.toFixed(3)} (t=${p.t.toFixed(2)} en=${p.en.toFixed(2)} bg=${p.bg.toFixed(2)})`);
    console.log(`    A: ${p.a}`);
    console.log(`    B: ${p.b}`);
  }
}
}
main().catch(console.error);
