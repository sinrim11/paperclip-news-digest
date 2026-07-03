import type { RawArticle } from '../src/lib/types';

const ENTITY_STOP_ABBRS = new Set(['AI', 'US', 'UK', 'EU', 'UN', 'WHO', 'NATO', 'IMF', 'GDP', 'CEO', 'IT', 'IPO', 'PE', 'VC']);
function tokenize(text: string) { return new Set(text.toLowerCase().split(/[\s\-_,.()\[\]\/]+/).filter(t => t.length > 1)); }
function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let i = 0; for (const t of a) if (b.has(t)) i++;
  return i / (a.size + b.size - i);
}
function extractEntities(text: string) {
  const e = new Set<string>();
  for (const m of text.matchAll(/\b[A-Z]{2,6}\b/g)) if (!ENTITY_STOP_ABBRS.has(m[0])) e.add(m[0]);
  for (const m of text.matchAll(/\b[A-Z][a-z]{3,}\b/g)) e.add(m[0].toLowerCase());
  for (const m of text.matchAll(/\b\d+(?:[.,]\d+)?(?:%|bp|bps|B|M|K|T|x)?\b/g)) if (m[0].length > 1) e.add(m[0]);
  for (const m of text.matchAll(/([가-힣]{2,6})(?=은|는|이|가|을|를|의|에|에서|으로|로|와|과|도)/g)) e.add(m[1]);
  return e;
}
function bigrams(t: string) {
  const w = t.slice(0,300).toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const b = new Set<string>(); for (let i=0; i<w.length-1; i++) b.add(`${w[i]}|${w[i+1]}`); return b;
}

const pairs = [
  { a: "No date set for US-Iran talks, as Pakistan pushes to keep diplomacy alive", b: "South Korea's solar power revolution" },
  { a: "South African politician Julius Malema given five-year jail", b: "South African opposition figure Malema sentenced to five years" },
  { a: "Google now lets you explore the web side-by-side with AI Mode", b: "Gemini can now create personalized AI images" },
];

for (const { a, b } of pairs) {
  const tokA = tokenize(a), tokB = tokenize(b);
  const entA = extractEntities(a), entB = extractEntities(b);
  const t = jaccard(tokA, tokB);
  const en = jaccard(entA, entB);
  const composite = t*0.40 + en*0.35;
  console.log(`\nA: ${a.slice(0,60)}`);
  console.log(`B: ${b.slice(0,60)}`);
  console.log(`  t=${t.toFixed(3)} en=${en.toFixed(3)} composite=${composite.toFixed(3)}`);
  console.log(`  entA=[${[...entA].join(',')}]`);
  console.log(`  entB=[${[...entB].join(',')}]`);
}
