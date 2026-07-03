// ─── Dedup Pipeline (Phase 1-B) ──────────────────────────────────────────────
// Deterministic duplicate detection without LLM.
// Two stages:
//   1. URL normalization dedup (exact match after canonicalisation)
//   2. Title n-gram Jaccard similarity dedup (threshold 0.82)
// Outputs DedupResult that carries consensusFacts/conflictingFacts and
// a 7-day rolling duplicate-rate metric.

import type { RawArticle } from './types';

// ─── URL normalisation ────────────────────────────────────────────────────────

/**
 * Canonicalise a URL so that minor variations of the same page collide:
 *   - strip all query parameters
 *   - lowercase scheme + host
 *   - remove "www." prefix
 *   - remove trailing slash from the path
 *   - strip URL fragments (#…)
 */
export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    // Not a valid URL — return lowercased original as best effort
    return raw.trim().toLowerCase();
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  return `${url.protocol.toLowerCase()}//${host}${path}`;
}

// ─── Title similarity (character bigram Jaccard) ─────────────────────────────

function charBigrams(text: string): Set<string> {
  const s = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const bg = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) bg.add(s.slice(i, i + 2));
  return bg;
}

export function titleSimilarity(a: string, b: string): number {
  const ba = charBigrams(a);
  const bb = charBigrams(b);
  if (ba.size === 0 || bb.size === 0) return 0;
  let inter = 0;
  for (const t of ba) if (bb.has(t)) inter++;
  return inter / (ba.size + bb.size - inter);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DedupGroup {
  /** The article with the most content — used as the cluster representative */
  representative: RawArticle;
  /** All articles in this duplicate group (including the representative) */
  members: RawArticle[];
  normalizedUrl: string;
  sourceList: string[];
  /** Facts present in every member's title/content */
  consensusFacts: string;
  /** Facts where sources differ (numbers, names) — null when only 1 source */
  conflictingFacts: string | null;
}

export interface DedupResult {
  /** One entry per distinct story after dedup */
  groups: DedupGroup[];
  /** Flat list of representative articles (convenience) */
  dedupedArticles: RawArticle[];
  totalInput: number;
  duplicatesRemoved: number;
  /** Fraction of input articles that were duplicates (0–1) */
  duplicateRate: number;
}

// ─── Consensus / conflicting fact extraction (deterministic) ─────────────────

function extractConsensusFacts(members: RawArticle[]): string {
  // Use title tokens shared by ALL members as the consensus signal.
  if (members.length === 1) return members[0].title;
  const tokenSets = members.map((a) =>
    new Set(a.title.toLowerCase().split(/[\s\-,.()\[\]\/]+/).filter((t) => t.length > 1)),
  );
  const first = tokenSets[0];
  const shared: string[] = [];
  for (const token of first) {
    if (tokenSets.every((s) => s.has(token))) shared.push(token);
  }
  return shared.length > 0 ? shared.join(' ') : members[0].title;
}

function extractConflictingFacts(members: RawArticle[]): string | null {
  if (members.length <= 1) return null;
  // Detect numeric tokens that differ across sources — a proxy for factual conflict.
  const numRe = /\b\d[\d,.]*(?:%|bp|bps|B|M|K|T|억|조|만|달러|원|위안)?\b/g;
  const allNums = members.map((a) => new Set((a.title + ' ' + a.content.slice(0, 200)).match(numRe) ?? []));
  const first = allNums[0];
  const onlyInFirst: string[] = [];
  for (const n of first) {
    if (!allNums.slice(1).every((s) => s.has(n))) onlyInFirst.push(n);
  }
  if (onlyInFirst.length === 0) return null;
  return `수치 불일치: ${onlyInFirst.slice(0, 5).join(', ')}`;
}

// ─── Core dedup ───────────────────────────────────────────────────────────────

/** Title-similarity threshold for treating two articles as duplicates (0.80-0.85 range) */
export const DEDUP_THRESHOLD = 0.80;

function buildGroup(members: RawArticle[]): DedupGroup {
  const rep = [...members].sort((a, b) => b.content.length - a.content.length)[0];
  return {
    representative: rep,
    members,
    normalizedUrl: normalizeUrl(rep.url),
    sourceList: [...new Set(members.map((a) => a.source))],
    consensusFacts: extractConsensusFacts(members),
    conflictingFacts: extractConflictingFacts(members),
  };
}

/**
 * Deduplicate a list of raw articles.
 *
 * Stage 1 — URL dedup: articles with the same normalised URL collapse
 *   into one group.
 * Stage 2 — Title dedup: within groups not yet merged, articles whose
 *   titles score ≥ DEDUP_THRESHOLD collapse further.
 *
 * Cross-source duplicates (same story, different sources) are intentionally
 * preserved as separate groups so the downstream clustering step can surface
 * multi-source coverage.  Only same-source near-duplicates are collapsed.
 */
export function dedupArticles(articles: RawArticle[]): DedupResult {
  const total = articles.length;

  // ── Stage 1: URL dedup ──────────────────────────────────────────────────
  const urlMap = new Map<string, RawArticle[]>();
  for (const a of articles) {
    const key = normalizeUrl(a.url);
    if (!urlMap.has(key)) urlMap.set(key, []);
    urlMap.get(key)!.push(a);
  }

  // Each URL bucket becomes a candidate group; pick richest representative.
  const urlGroups: RawArticle[][] = [...urlMap.values()];

  // ── Stage 2: Title dedup (same-source only) ────────────────────────────
  // For each URL-group representative, check if a prior group's title is
  // near-identical AND shares the same source — if so, merge.
  const merged: RawArticle[][] = [];

  for (const group of urlGroups) {
    const rep = [...group].sort((a, b) => b.content.length - a.content.length)[0];
    let absorbed = false;

    for (const existing of merged) {
      const existingRep = existing[0];
      // Only collapse same-source near-duplicates to avoid false positives.
      if (existingRep.source !== rep.source) continue;
      if (titleSimilarity(existingRep.title, rep.title) >= DEDUP_THRESHOLD) {
        existing.push(...group);
        absorbed = true;
        break;
      }
    }

    if (!absorbed) merged.push(group);
  }

  const groups = merged.map(buildGroup);
  const dedupedArticles = groups.map((g) => g.representative);
  const duplicatesRemoved = total - groups.length;

  return {
    groups,
    dedupedArticles,
    totalInput: total,
    duplicatesRemoved,
    duplicateRate: total > 0 ? duplicatesRemoved / total : 0,
  };
}

// ─── 7-day rolling duplicate rate ────────────────────────────────────────────

/**
 * Compute the duplicate rate over a sliding window of `windowDays` days.
 * Articles without `publishedAt` are treated as published now.
 *
 * Returns a value in [0, 1].  Target: < 0.02 (2 %).
 */
export function computeRollingDuplicateRate(
  articles: RawArticle[],
  windowDays = 7,
): number {
  const now = Date.now();
  const cutoff = now - windowDays * 24 * 60 * 60 * 1000;

  const windowed = articles.filter((a) => {
    const ts = a.publishedAt ? new Date(a.publishedAt).getTime() : now;
    return ts >= cutoff;
  });

  if (windowed.length === 0) return 0;
  return dedupArticles(windowed).duplicateRate;
}
