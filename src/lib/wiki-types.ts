/**
 * v4 Phase 0: Wiki 3-way split type definitions.
 *
 * The original flat 180-page LLM-wiki is split into three semantically
 * distinct entry types that map directly to the WikiEntry.entryType Prisma enum.
 */

export type WikiEntryType = 'ledger' | 'narrative' | 'daily_digest';

/**
 * ledger — structured, machine-readable facts.
 * One row per (entity, date, metric) triple. Source URL required.
 */
export interface LedgerEntry {
  entryType: 'ledger';
  title: string;
  entityName: string;
  entityType: string;
  metricKey: string;
  metricValue: string | number;
  sourceUrl: string;
  refDate: string; // ISO date "YYYY-MM-DD"
  tags: string[];
  metadata: Record<string, unknown>;
}

/**
 * narrative — human-readable weekly summaries.
 * Rich prose body. Typically aggregated from ledger entries.
 */
export interface NarrativeEntry {
  entryType: 'narrative';
  title: string;
  body: string;
  weekStart: string; // ISO date "YYYY-MM-DD"
  weekEnd: string;
  tags: string[];
  metadata: Record<string, unknown>;
}

/**
 * daily_digest — cached output of the daily briefing pipeline.
 * One entry per digest date. Body is the rendered markdown/html.
 */
export interface DailyDigestEntry {
  entryType: 'daily_digest';
  title: string;
  body: string;
  refDate: string; // ISO date "YYYY-MM-DD" — the digest date
  tags: string[];
  metadata: Record<string, unknown>;
}

export type WikiEntry = LedgerEntry | NarrativeEntry | DailyDigestEntry;

/** Discriminated union helper */
export function isLedger(e: WikiEntry): e is LedgerEntry {
  return e.entryType === 'ledger';
}
export function isNarrative(e: WikiEntry): e is NarrativeEntry {
  return e.entryType === 'narrative';
}
export function isDailyDigest(e: WikiEntry): e is DailyDigestEntry {
  return e.entryType === 'daily_digest';
}
