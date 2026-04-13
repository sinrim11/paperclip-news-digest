// ─── Core domain types for the News Digest system ───────────────────────────

// DB-level enum values (ASCII, Prisma-compatible)
export type CategoryKey = 'GLOBAL' | 'STOCKS' | 'AI' | 'POLICY' | 'REALESTATE';

// Human-readable display labels
export const CATEGORY_LABEL: Record<CategoryKey, string> = {
  GLOBAL: '글로벌',
  STOCKS: '증권',
  AI: 'AI',
  POLICY: '정치',
  REALESTATE: '부동산',
};

// Legacy alias used throughout prompts (human-facing Korean label)
export type Category = '글로벌' | '증권' | 'AI' | '정치' | '부동산';

export const CATEGORIES: CategoryKey[] = ['GLOBAL', 'STOCKS', 'AI', 'POLICY', 'REALESTATE'];

/** Map Korean prompt output back to DB enum key */
export function toCategoryKey(label: string): CategoryKey {
  const map: Record<string, CategoryKey> = {
    '글로벌': 'GLOBAL',
    '증권': 'STOCKS',
    'AI': 'AI',
    '정치': 'POLICY',
    '정부정책': 'POLICY', // legacy label — keep for backward compat with old DB data / LLM output
    '부동산': 'REALESTATE',
  };
  return map[label] ?? 'GLOBAL';
}

export function toCategoryLabel(key: CategoryKey): Category {
  return CATEGORY_LABEL[key] as Category;
}

export type Urgency = 'breaking' | 'watch' | 'note';
export type DigestStatus = 'pending' | 'in_progress' | 'done' | 'failed';

// ─── Market snapshot ─────────────────────────────────────────────────────────

export interface MarketIndicator {
  value: number;
  change: string;
  direction: 'up' | 'down' | 'flat';
}

export interface MarketSnapshot {
  date: string;
  kospi: MarketIndicator;
  kosdaq: MarketIndicator;
  usdKrw: MarketIndicator;
  wti: MarketIndicator;
  us10y: MarketIndicator;
  btcUsd: MarketIndicator;
}

// ─── News item (3-line summary) ───────────────────────────────────────────────

export interface NewsItem {
  id?: string;
  digestDate: string;
  category: CategoryKey;
  newsOrder: number;
  title: string;
  urgency: Urgency;
  fact: string;
  impact: string;
  action: string;
  contextTags: string[];
  source: string;
  sourceUrl: string;
  isTop3: boolean;
  top3Rank?: number;
  relatedData?: string[];
  contextLinks?: string[];
  upcomingEvents?: string[];
}

// ─── Category briefing ───────────────────────────────────────────────────────

export interface CategoryBriefing {
  category: CategoryKey;
  summary: string;
  newsItems: NewsItem[];
}

// ─── Raw RSS article ─────────────────────────────────────────────────────────

export interface RawArticle {
  title: string;
  content: string;
  url: string;
  source: string;
  category: CategoryKey;
  publishedAt?: string;
}

// ─── LLM structured output (prompts use Korean labels) ───────────────────────

export interface LLMNewsItem {
  title: string;
  urgency: Urgency;
  fact: string;
  impact: string;
  action: string;
  contextTags: string[];
  source: string;
  sourceUrl: string;
}

export interface LLMCategoryResult {
  category: string; // Korean label from LLM
  summary: string;
  items: LLMNewsItem[];
}

export interface LLMTop3Item extends LLMNewsItem {
  rank: number;
  category: string;
  relatedData: string[];
  contextLinks: string[];
  upcomingEvents: string[];
}

// ─── Weekly digest ───────────────────────────────────────────────────────────

export interface WeeklyDigestContent {
  weekStart: string;
  weekEnd: string;

  // Phase 4 full spec fields
  executive_summary?: string;
  market_weekly?: {
    summary: string;
    kospi?: Record<string, unknown>;
    kosdaq?: Record<string, unknown>;
    usdKrw?: Record<string, unknown>;
  };
  category_summaries?: Array<{
    category: string;
    summary: string;
    progression: string;
    highlight: string;
  }>;
  weekly_top5?: Array<{
    rank: number;
    title: string;
    category: string;
    fact: string;
    impact: string;
    action: string;
    weekly_progression: string;
    current_status: string;
  }>;
  trend_analysis?: {
    new_issues: string[];
    escalated_issues: string[];
    resolved_issues: string[];
    sector_strength: Record<string, string>;
    cross_category_chains: Array<{ chain: string; description: string }>;
  };
  context_evolution?: Array<{
    tag: string;
    weeklyCount: number;
    statusChange: string;
    nextWeekOutlook: string;
  }>;
  next_week_watchlist?: {
    scheduled_events: Array<{ date: string; event: string; impact: string }>;
    ongoing_monitors: string[];
    investment_checklist: string[];
  };

  // Legacy / simplified fields (kept for backward compat with existing frontend)
  headline?: string;
  categoryRecaps?: Array<{
    category: string;
    summary: string;
    keyItems: string[];
  }>;
  topTrends?: Array<{
    tag: string;
    count: number;
    description: string;
  }>;
  outlook?: string;
}
