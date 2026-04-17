/**
 * Wiki → Ledger dry-run
 *
 * Scans existing wiki/entities/*.md files and prints what would be created
 * as WikiEntry(ledger) rows. Does NOT write to the database.
 *
 * Usage:
 *   npx tsx scripts/wiki-ledger-dryrun.ts [--dir wiki/entities]
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(process.cwd());
const DEFAULT_DIR = join(ROOT, 'wiki', 'entities');

interface LedgerRow {
  entityName: string;
  entityType: string;
  metricKey: string;
  metricValue: string | number;
  refDate: string;
  sourceUrl: string | null;
  title: string;
}

function parseEntityPage(filePath: string, fileName: string): LedgerRow[] {
  const content = readFileSync(filePath, 'utf-8');
  const rows: LedgerRow[] = [];

  // Extract entity name from frontmatter title or filename
  const titleMatch = content.match(/^title:\s*"?([^"\n]+)"?/m);
  const entityName = titleMatch ? titleMatch[1].trim() : fileName.replace(/\.md$/, '');

  // Extract created date for fallback
  const createdMatch = content.match(/^created:\s*(\d{4}-\d{2}-\d{2})/m);
  const updatedMatch = content.match(/^updated:\s*(\d{4}-\d{2}-\d{2})/m);
  const baseDate = updatedMatch?.[1] ?? createdMatch?.[1] ?? new Date().toISOString().slice(0, 10);

  // Extract tags for entityType inference
  const tagsMatch = content.match(/^tags:\s*\[([^\]]+)\]/m);
  const tags = tagsMatch ? tagsMatch[1].split(',').map((t) => t.trim()) : [];
  const entityType = inferEntityType(entityName, tags);

  // 등장 횟수 (mention count)
  const mentionMatch = content.match(/등장\s*횟수.*?(\d+)회/);
  if (mentionMatch) {
    rows.push({
      entityName,
      entityType,
      metricKey: 'mentions',
      metricValue: parseInt(mentionMatch[1], 10),
      refDate: baseDate,
      sourceUrl: null,
      title: `${entityName} | mentions | ${baseDate}`,
    });
  }

  // Per-date news entries: "- **YYYY-MM-DD** ..."
  const dateNewsRe = /- \*\*((\d{4}-\d{2}-\d{2}))\*\*\s+(.+)/g;
  const dateMentions = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = dateNewsRe.exec(content)) !== null) {
    const date = m[1];
    dateMentions.set(date, (dateMentions.get(date) ?? 0) + 1);
  }

  // Extract source URLs from news entries: "-> [[YYYY-MM-DD]]" or "[source](url)"
  const urlRe = /\[.*?\]\((https?:\/\/[^\s)]+)\)/g;
  const sourceUrls: string[] = [];
  while ((m = urlRe.exec(content)) !== null) {
    sourceUrls.push(m[1]);
  }

  // Emit per-date mention rows
  for (const [date, count] of dateMentions.entries()) {
    rows.push({
      entityName,
      entityType,
      metricKey: 'daily_mentions',
      metricValue: count,
      refDate: date,
      sourceUrl: sourceUrls[0] ?? null,
      title: `${entityName} | daily_mentions | ${date}`,
    });
  }

  // Source count from "N곳" pattern
  const sourceCountMatch = content.match(/(\d+)곳\s*공통/);
  if (sourceCountMatch) {
    rows.push({
      entityName,
      entityType,
      metricKey: 'sourceCount',
      metricValue: parseInt(sourceCountMatch[1], 10),
      refDate: baseDate,
      sourceUrl: null,
      title: `${entityName} | sourceCount | ${baseDate}`,
    });
  }

  return rows;
}

function inferEntityType(name: string, tags: string[]): string {
  const lower = name.toLowerCase();
  const tagStr = tags.join(' ').toLowerCase();
  if (/kospi|kosdaq|nasdaq|s&p|nikkei|dow/.test(lower)) return 'index';
  if (/openai|anthropic|google|meta|apple|samsung|nvidia|microsoft|amazon|tesla/.test(lower)) return 'company';
  if (/btc|eth|usd|krw|wti|oil|gold/.test(lower)) return 'asset';
  if (tagStr.includes('ai') || tagStr.includes('tech')) return 'company';
  return 'entity';
}

function formatRow(row: LedgerRow, idx: number): string {
  return `[${String(idx + 1).padStart(3, '0')}] ${row.refDate} | ${row.entityName.padEnd(20)} | ${row.metricKey.padEnd(15)} | ${String(row.metricValue).padStart(6)} | ${row.sourceUrl ?? '(no url)'}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dirArgIdx = args.indexOf('--dir');
const entityDir = dirArgIdx >= 0 ? resolve(args[dirArgIdx + 1]) : DEFAULT_DIR;

if (!existsSync(entityDir)) {
  console.error(`[dryrun] Directory not found: ${entityDir}`);
  process.exit(1);
}

const files = readdirSync(entityDir).filter((f) => f.endsWith('.md'));
console.log(`[dryrun] Scanning ${files.length} entity pages in ${entityDir}\n`);

const allRows: LedgerRow[] = [];
const entitySummary: Array<{ entity: string; rowCount: number }> = [];

for (const file of files.sort()) {
  const rows = parseEntityPage(join(entityDir, file), file);
  allRows.push(...rows);
  if (rows.length > 0) {
    entitySummary.push({ entity: file.replace(/\.md$/, ''), rowCount: rows.length });
  }
}

console.log('='.repeat(90));
console.log('LEDGER DRY-RUN — rows that would be written to WikiEntry(ledger)');
console.log('='.repeat(90));
console.log(`${'#'.padEnd(5)} ${'Date'.padEnd(12)} ${'Entity'.padEnd(22)} ${'Metric'.padEnd(17)} ${'Value'.padStart(6)}  Source URL`);
console.log('-'.repeat(90));

for (let i = 0; i < allRows.length; i++) {
  console.log(formatRow(allRows[i], i));
}

console.log('-'.repeat(90));
console.log(`\nSummary: ${allRows.length} ledger rows from ${entitySummary.length} entities\n`);

console.log('Entity breakdown:');
for (const { entity, rowCount } of entitySummary) {
  console.log(`  ${entity.padEnd(30)} ${rowCount} rows`);
}

console.log('\n[dryrun] No DB writes performed. Run wiki-db writeLedgerEntries() to persist.');
