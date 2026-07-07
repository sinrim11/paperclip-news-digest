/**
 * profiles.ts — 투자분석 프로필 저장소(다중 사용자·지인 지원).
 *
 * 저장: config/profiles/<id>.json (gitignored — 재무정보 커밋 금지, 원격 repo PUBLIC).
 * 활성: 쿠키 'invest_profile' (브라우저별). 없거나 무효 → default(소유자, reader-profile.json 파생).
 * 보안: id는 /^[a-z0-9][a-z0-9_-]{0,31}$/ + resolve prefix 검증(경로 인젝션 차단). 원자 쓰기(tmp+rename).
 * firstTimeBuyer=false 프로필은 params/model을 조정한 사본으로 반환(LTV 보너스·취득세 감면 제거).
 * 전제: 무주택자만 모델링(유주택 취득세 중과·LTV 0 미지원).
 */
import { readFileSync, writeFileSync, readdirSync, renameSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { loadPolicyParams, loadReaderFinances, type PolicyParams, type ReaderFinances } from './tracker';
import { loadInvestmentModel, type InvestmentModel } from './investment-model';
import { DEFAULT_WORK, type WorkPlace, type Lifestyle } from './commute';

export const PROFILE_COOKIE = 'invest_profile';
export const DEFAULT_ID = 'default';
const DIR = () => join(process.cwd(), 'config', 'profiles');
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export interface ProfileFinances {
  annualIncome: number; // 연소득 세전(원, DSR)
  usableCapital: number; // 가용 자기자본(원)
  monthlyHomeSaving: number; // 월 매수펀드 적립(원) — 미입력 시 실수령−생활비−기존대출로 자동 산출
  monthlyIncomeNet: number; // 월 실수령(원, 캐리 점수)
  monthlyExpense: number; // 월 생활비(원, 고정비 포함 총지출 — 저축·연금 제외)
  monthlyFixedCosts: number; // 월 고정비(원 — 보험·통신·관리비 등, 생활비에 포함되는 내역·참고용)
  existingLoanMonthly: number; // 기존 대출 월 상환액(원/월) — DSR 한도·보유부담 차감
  jeonseDepositSelf: number; // 현 전세 본인 보증금(원, versus)
  jeonseLoanInterestMonthly: number; // 현 전세대출이자(원/월, versus)
  firstTimeBuyer: boolean; // 생애최초(LTV 70%·취득세 감면)
}
export interface InvestorProfile {
  id: string; name: string; updatedAt: string; finances: ProfileFinances;
  work?: WorkPlace | null; // 출근지(통근 점수 기준). 없으면 DEFAULT_WORK
  purpose?: 'invest' | 'live'; // 투자우선(통근·상권 가중 0) | 실거주우선(weightsLive 적용)
  lifestyle?: Lifestyle; // 라이프스타일(2-C) — 학군 개인효용/가격형성 이원 가중. 미지정 시 family(현행 동일)
}

export function validId(id: string): boolean {
  return ID_RE.test(id) && id !== DEFAULT_ID;
}

function fileOf(id: string): string {
  if (!validId(id)) throw new Error(`잘못된 프로필 id: ${id}`);
  const p = resolve(DIR(), `${id}.json`);
  if (!p.startsWith(resolve(DIR()) + '/')) throw new Error('경로 이탈 차단');
  return p;
}

/** 소유자 기본 프로필 — reader-profile.json에서 파생(파일 생성 없음) */
export function defaultProfile(): InvestorProfile | null {
  const fin = loadReaderFinances();
  if (!fin) return null;
  const fixedSum = Object.values(fin.cashflow?.fixedCosts ?? {}).reduce((s, v) => s + v, 0);
  return {
    id: DEFAULT_ID,
    name: '기본(소유자)',
    updatedAt: '',
    finances: {
      annualIncome: fin.annualIncome,
      usableCapital: fin.usableCapital,
      monthlyHomeSaving: fin.cashflow?.monthlyHomeSaving ?? 0,
      monthlyIncomeNet: fin.cashflow?.monthlyIncomeNet ?? 0,
      monthlyExpense: fin.cashflow?.monthlyExpense ?? 0,
      monthlyFixedCosts: fin.cashflow?.monthlyFixedCosts ?? Math.max(0, fixedSum - (fin.jeonseLoanInterestMonthly ?? 0)),
      existingLoanMonthly: fin.existingLoanMonthly ?? 0,
      jeonseDepositSelf: fin.jeonseDepositSelf ?? 0,
      jeonseLoanInterestMonthly: fin.jeonseLoanInterestMonthly ?? 0,
      firstTimeBuyer: fin.firstTimeBuyer ?? true,
    },
    work: fin.work ?? DEFAULT_WORK,
    purpose: fin.purpose ?? 'invest',
    lifestyle: fin.lifestyle ?? 'single', // 소유자 = 비혼 1인가구(reader-profile 기본)
  };
}

/** 소유자 재무 수정 — reader-profile.json에서 모델이 소비하는 필드만 외과적 patch(나머지 상세·주석 보존, 원자 쓰기) */
export function patchOwnerFinances(pf: ProfileFinances, work?: WorkPlace | null, purpose?: 'invest' | 'live'): void {
  const path = join(process.cwd(), 'config', 'reader-profile.json');
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  if (!raw?.finances) throw new Error('reader-profile.json 구조 오류(finances 없음)');
  const f = raw.finances;
  f.annualIncome = pf.annualIncome;
  f.usableCapital = pf.usableCapital;
  f.jeonseDepositSelf = pf.jeonseDepositSelf;
  f.jeonseLoanInterestMonthly = pf.jeonseLoanInterestMonthly;
  f.existingLoanMonthly = pf.existingLoanMonthly;
  f.firstTimeBuyer = pf.firstTimeBuyer;
  if (work) f.work = work;
  if (purpose) f.purpose = purpose;
  f.cashflow = f.cashflow ?? {};
  f.cashflow.monthlyIncomeNet = pf.monthlyIncomeNet;
  f.cashflow.monthlyExpense = pf.monthlyExpense;
  f.cashflow.monthlyFixedCosts = pf.monthlyFixedCosts;
  f.cashflow.monthlyHomeSaving = pf.monthlyHomeSaving;
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n');
  renameSync(tmp, path);
}

export function loadProfile(id: string): InvestorProfile | null {
  try {
    const p = JSON.parse(readFileSync(fileOf(id), 'utf-8')) as InvestorProfile;
    return p?.finances ? { ...p, id } : null;
  } catch {
    return null;
  }
}

export function listProfiles(): InvestorProfile[] {
  const out: InvestorProfile[] = [];
  const def = defaultProfile();
  if (def) out.push(def);
  try {
    for (const f of readdirSync(DIR()).sort()) {
      if (!f.endsWith('.json')) continue;
      const id = f.slice(0, -5);
      if (!validId(id)) continue;
      const p = loadProfile(id);
      if (p) out.push(p);
    }
  } catch { /* 디렉토리 없음 = 커스텀 프로필 없음 */ }
  return out;
}

/** 재무 필드 공통 검증(saveProfile·patchOwnerFinances 앞단에서 호출) */
export function validateFinances(f: ProfileFinances): void {
  for (const [k, v] of Object.entries({ annualIncome: f.annualIncome, usableCapital: f.usableCapital, monthlyHomeSaving: f.monthlyHomeSaving, monthlyIncomeNet: f.monthlyIncomeNet, monthlyExpense: f.monthlyExpense, monthlyFixedCosts: f.monthlyFixedCosts, existingLoanMonthly: f.existingLoanMonthly, jeonseDepositSelf: f.jeonseDepositSelf, jeonseLoanInterestMonthly: f.jeonseLoanInterestMonthly })) {
    if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 1e12) throw new Error(`${k} 값이 유효하지 않습니다 (0 이상 숫자)`);
  }
}

export function saveProfile(p: InvestorProfile): void {
  const path = fileOf(p.id); // validId 포함
  validateFinances(p.finances);
  if (!p.name?.trim()) throw new Error('프로필 이름 필수');
  mkdirSync(DIR(), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify({ ...p, updatedAt: new Date().toISOString() }, null, 2));
  renameSync(tmp, path); // 원자 교체(torn write 방지)
}

export function deleteProfile(id: string): void {
  try { unlinkSync(fileOf(id)); } catch { /* 이미 없음 */ }
}

/** 커스텀 프로필 → computeInvestment용 ReaderFinances (cashflow 중첩 매핑 필수) */
export function toReaderFinances(p: InvestorProfile): ReaderFinances {
  const f = p.finances;
  return {
    annualIncome: f.annualIncome,
    usableCapital: f.usableCapital,
    jeonseDepositSelf: f.jeonseDepositSelf,
    jeonseLoanInterestMonthly: f.jeonseLoanInterestMonthly,
    existingLoanMonthly: f.existingLoanMonthly, // DSR·보유부담 차감
    cashflow: { monthlyHomeSaving: f.monthlyHomeSaving, monthlyIncomeNet: f.monthlyIncomeNet, monthlyExpense: f.monthlyExpense, monthlyFixedCosts: f.monthlyFixedCosts },
    existingDebt: { creditLoan: 0, creditLineLimit: 0, creditLineUsed: 0 }, // 마통 해지 전제와 정합
  };
}

export interface ResolvedContext {
  profile: InvestorProfile;
  isDefault: boolean;
  fin: ReaderFinances;
  params: PolicyParams;
  model: InvestmentModel;
  work: WorkPlace; // 출근지(통근 계산 기준)
  purposeLive: boolean; // 실거주 목적 → 통근·상권 가중 반영
  lifestyle: Lifestyle; // 학군 이원 가중(2-C) — 커스텀 프로필 미지정 시 family(현행 동일)
}

/** 쿠키 값 → 분석 컨텍스트. 무효/부재 시 default. firstTimeBuyer=false면 params/model 조정 사본. */
export function resolveContext(cookieVal: string | undefined | null): ResolvedContext | null {
  const params = loadPolicyParams();
  const model = loadInvestmentModel();
  if (!params || !model) return null;
  let profile: InvestorProfile | null = null;
  if (cookieVal && cookieVal !== DEFAULT_ID && validId(cookieVal)) profile = loadProfile(cookieVal);
  const isDefault = !profile;
  if (!profile) profile = defaultProfile();
  if (!profile) return null;
  // default는 원본 reader-profile 전체 사용(existingDebt 등 부가 필드 보존)
  const fin = isDefault ? (loadReaderFinances() as ReaderFinances) : toReaderFinances(profile);
  const ftb = profile.finances.firstTimeBuyer;
  const params2: PolicyParams = ftb ? params : { ...params, ltv: { ...params.ltv, firstTimeBonus: 0 } };
  const model2: InvestmentModel = ftb ? model : { ...model, firstTimeAcqTaxReliefManwon: 0 };
  return {
    profile, isDefault, fin, params: params2, model: model2,
    work: profile.work ?? DEFAULT_WORK,
    purposeLive: profile.purpose === 'live',
    lifestyle: profile.lifestyle ?? 'family',
  };
}
