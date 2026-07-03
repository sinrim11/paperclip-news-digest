/**
 * 매수 트래커 — 예산 계산·트리거 감지·D-day.
 *
 * 데이터 분리 원칙:
 *   config/policy-params.json    — 대출 규제 파라미터 (공개, 커밋됨; 정책 변경 시 이 파일만 갱신)
 *   config/reader-profile.json   — 개인 재무 (gitignored)
 *   config/tracker-triggers.json — 변경점 감지 패턴 (공개, 커밋됨)
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// ─── Config loaders ───────────────────────────────────────────────────────────

export interface PolicyParams {
  asOf: string;
  regime: string;
  ltv: { regulatedBase: number; firstTimeBonus: number; nonRegulated: number };
  loanCapByPrice: Array<{ maxPrice: number | null; cap: number }>;
  dsr: {
    ratio: number;
    stressAddPctRegulated: number;
    stressAddPctOther: number;
    assumedBaseRatePct: number;
    termYears: number;
  };
  landPermitZone: { active: boolean; moveInMonths: number; residenceYears: number };
  easedScenario: { ltv: number; stressAddPct: number };
}

export interface ReaderFinances {
  annualIncome: number;
  usableCapital: number;
  capitalBreakdown?: Record<string, number>;
  jeonseDeposit?: number;
  jeonseExpiry?: string;
  jeonseInsurance?: boolean;
  subscriptionAccountTotal?: number;
}

function readJson<T>(relPath: string): T | null {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), relPath), 'utf-8')) as T;
  } catch {
    return null;
  }
}

export function loadPolicyParams(): PolicyParams | null {
  return readJson<PolicyParams>('config/policy-params.json');
}

export function loadReaderFinances(): ReaderFinances | null {
  const profile = readJson<{ finances?: ReaderFinances }>('config/reader-profile.json');
  return profile?.finances ?? null;
}

// ─── Budget simulation ────────────────────────────────────────────────────────

export interface BudgetScenario {
  label: string;
  ltv: number;
  stressAddPct: number;
  /** 원리금균등 30년, DSR 40% 기준 대출 상한 (스트레스 금리 적용) */
  dsrLoanCap: number;
  /** 실제 대출액 (LTV·DSR·정책한도 중 최소) */
  loan: number;
  /** 최대 매수가 = 가용자본 + loan */
  maxPrice: number;
  binding: 'LTV' | 'DSR' | '정책한도';
}

/** 연이율 ratePct·기간 termYears 원리금균등 월상환액 (원금 1원 기준) */
function monthlyPaymentPerWon(ratePct: number, termYears: number): number {
  const m = ratePct / 100 / 12;
  const n = termYears * 12;
  return (m * Math.pow(1 + m, n)) / (Math.pow(1 + m, n) - 1);
}

function policyLoanCap(price: number, caps: PolicyParams['loanCapByPrice']): number {
  for (const tier of caps) {
    if (tier.maxPrice === null || price <= tier.maxPrice) return tier.cap;
  }
  return caps[caps.length - 1]?.cap ?? Infinity;
}

function solveScenario(
  label: string,
  ltv: number,
  stressAddPct: number,
  params: PolicyParams,
  fin: ReaderFinances,
): BudgetScenario {
  const stressRate = params.dsr.assumedBaseRatePct + stressAddPct;
  const monthlyCap = (fin.annualIncome * params.dsr.ratio) / 12;
  const dsrLoanCap = Math.floor(monthlyCap / monthlyPaymentPerWon(stressRate, params.dsr.termYears));

  // LTV가 구속일 때의 매수가: P = capital / (1 - ltv)
  const pLtv = fin.usableCapital / (1 - ltv);
  const capAtPLtv = Math.min(dsrLoanCap, policyLoanCap(pLtv, params.loanCapByPrice));

  if (ltv * pLtv <= capAtPLtv) {
    return { label, ltv, stressAddPct, dsrLoanCap, loan: Math.floor(ltv * pLtv), maxPrice: Math.floor(pLtv), binding: 'LTV' };
  }
  // DSR 또는 정책한도가 구속
  const maxPrice = fin.usableCapital + capAtPLtv;
  const binding = dsrLoanCap <= policyLoanCap(maxPrice, params.loanCapByPrice) ? 'DSR' : '정책한도';
  return { label, ltv, stressAddPct, dsrLoanCap, loan: capAtPLtv, maxPrice: Math.floor(maxPrice), binding };
}

export function computeBudget(params: PolicyParams, fin: ReaderFinances): BudgetScenario[] {
  return [
    solveScenario('현행 · 일반', params.ltv.regulatedBase, params.dsr.stressAddPctRegulated, params, fin),
    solveScenario(
      '현행 · 생애최초 우대(+10%p)',
      params.ltv.regulatedBase + params.ltv.firstTimeBonus,
      params.dsr.stressAddPctRegulated,
      params,
      fin,
    ),
    solveScenario('완화 가정 (LTV 70%·스트레스 2단계)', params.easedScenario.ltv, params.easedScenario.stressAddPct, params, fin),
  ];
}

// ─── Trigger detection ────────────────────────────────────────────────────────

interface TriggerConfig {
  triggers: Array<{ id: string; label: string; patterns: string[] }>;
}

export interface TriggerHit {
  triggerId: string;
  label: string;
  title: string;
  category: string;
  date?: string;
  sourceUrl?: string;
}

export interface ScannableItem {
  title: string;
  fact: string;
  category: string;
  date?: string;
  sourceUrl?: string;
}

/** '&'로 연결된 단어가 모두 존재하면 매칭 (대소문자 무시) */
function matchesPattern(haystack: string, pattern: string): boolean {
  const lower = haystack.toLowerCase();
  return pattern.split('&').every((term) => lower.includes(term.trim().toLowerCase()));
}

export function detectTriggers(items: ScannableItem[]): TriggerHit[] {
  const cfg = readJson<TriggerConfig>('config/tracker-triggers.json');
  if (!cfg) return [];
  const hits: TriggerHit[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const haystack = `${item.title} ${item.fact}`;
    for (const trigger of cfg.triggers) {
      if (trigger.patterns.some((p) => matchesPattern(haystack, p))) {
        const key = `${trigger.id}|${item.title}`;
        if (!seen.has(key)) {
          seen.add(key);
          hits.push({
            triggerId: trigger.id,
            label: trigger.label,
            title: item.title,
            category: item.category,
            date: item.date,
            sourceUrl: item.sourceUrl,
          });
        }
        break; // 아이템당 첫 매칭 트리거만
      }
    }
  }
  return hits;
}

// ─── D-day ────────────────────────────────────────────────────────────────────

/** KST 기준 target(YYYY-MM-DD)까지 남은 일수 (지났으면 음수) */
export function ddayKST(target: string): number {
  const now = new Date();
  now.setTime(now.getTime() + 9 * 60 * 60 * 1000);
  const today = new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z');
  const t = new Date(target + 'T00:00:00Z');
  return Math.round((t.getTime() - today.getTime()) / 86_400_000);
}

/** 만기일로부터 n개월 전 날짜 (YYYY-MM-DD) */
export function monthsBefore(dateStr: string, months: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

export const formatKRW = (v: number): string => {
  const eok = v / 100_000_000;
  if (eok >= 1) return `${eok.toFixed(eok >= 10 ? 1 : 2).replace(/\.?0+$/, '')}억`;
  return `${Math.round(v / 10_000).toLocaleString()}만원`;
};
