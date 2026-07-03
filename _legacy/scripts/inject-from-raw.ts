/**
 * scripts/inject-from-raw.ts
 *
 * Reads a pre-collected raw JSON file and feeds it to the local
 * /api/digest/generate endpoint (bypassing live RSS collection).
 *
 * Usage:
 *   npx tsx scripts/inject-from-raw.ts 2026-04-13
 *   npx tsx scripts/inject-from-raw.ts 2026-04-14
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import http from 'node:http';

const CATEGORY_MAP: Record<string, string> = {
  '글로벌': 'GLOBAL',
  '증권': 'STOCKS',
  'AI': 'AI',
  '정부정책': 'POLICY',
  '부동산': 'REALESTATE',
};

interface RawJsonItem {
  title: string;
  url: string;
  published_date?: string;
  summary?: string;
  full_content?: string;
  category: string;
  source_name?: string;
  image_url?: string;
  source_count?: number;
}

interface RawArticle {
  title: string;
  content: string;
  url: string;
  source: string;
  category: string; // CategoryKey
  publishedAt?: string;
}

async function main() {
  const dateArg = process.argv[2];
  if (!dateArg) {
    console.error('Usage: npx tsx scripts/inject-from-raw.ts <YYYY-MM-DD>');
    process.exit(1);
  }

  // Derive the file name from the date (strip dashes for the filename)
  const fileSuffix = dateArg.replace(/-/g, '');
  const rawPath = join(process.cwd(), 'output', `raw_${fileSuffix}.json`);

  console.log(`[inject] Reading ${rawPath}...`);
  const raw: RawJsonItem[] = JSON.parse(readFileSync(rawPath, 'utf-8'));
  console.log(`[inject] Loaded ${raw.length} raw articles`);

  // Group by CategoryKey
  const byCategory: Record<string, RawArticle[]> = {};

  for (const item of raw) {
    const catKey = CATEGORY_MAP[item.category] ?? 'GLOBAL';
    const article: RawArticle = {
      title: item.title,
      content: (item.full_content ?? item.summary ?? '').slice(0, 3000),
      url: item.url,
      source: item.source_name ?? '알 수 없음',
      category: catKey,
      publishedAt: item.published_date,
    };
    if (!byCategory[catKey]) byCategory[catKey] = [];
    byCategory[catKey].push(article);
  }

  console.log('[inject] Category distribution:', Object.fromEntries(
    Object.entries(byCategory).map(([k, v]) => [k, v.length])
  ));

  const apiUrl = `http://localhost:3200/api/digest/generate`;
  console.log(`[inject] POSTing to ${apiUrl} for date=${dateArg}...`);

  // Use node:http to avoid undici's 30s headers timeout on slow Ollama pipeline
  const payload = JSON.stringify({ date: dateArg, force: true, preCollectedArticles: byCategory });
  const url = new URL(apiUrl);

  const { statusCode, body: responseBody } = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
    const req = http.request(
      { hostname: url.hostname, port: Number(url.port), path: url.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 900_000 },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 500, body: data }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout after 15min')); });
    req.write(payload);
    req.end();
  });

  if (statusCode >= 200 && statusCode < 300) {
    console.log(`[inject] ✅ SUCCESS for ${dateArg}:`, responseBody);
  } else {
    console.error(`[inject] ❌ FAILED for ${dateArg} (${statusCode}):`, responseBody);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[inject] Fatal error:', err);
  process.exit(1);
});
