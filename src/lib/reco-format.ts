/**
 * 매물 추천 텔레그램 메시지 포맷 (send-recommendations.ts · daily-recommend.ts 공유).
 * 사용자 지정 형식: 매물 단위 분할·이모지·명확한 개행·선정 근거·객관 근거 병기.
 */

export interface RecoView {
  rank: number;
  name: string;
  gu: string;
  dong: string;
  buildYear?: number | null;
  household?: number | null;
  far?: number | null; // 용적률 %
  lastTradeDate?: string; // "MM-DD"
  lastTradeManwon?: number;
  areaText: string;
  medianManwon: number;
  priceRangeText?: string;
  tradeCount?: number;
  scenario?: string;
  budgetLabel?: string;
  station?: string;
  catalyst?: string;
  school?: string;
  amenities?: string;
  living?: string;
  reasons: string[];
  cautions?: string[];
  complexNo?: string;
  sources?: string[];
  // 갭투자 트랙(비규제)
  jeonseManwon?: number;
  gapManwon?: number;
  jeonseRatioPct?: number;
  gapCoverable?: boolean;
  nonRegulated?: boolean;
  // 스트레치+ 트랙
  overComfortManwon?: number;
  monthlyPayAddManwon?: number;
  monthsToReach?: number | null;
  // 지역 규제 상태(가드레일 1 — 출처 URL 동반)
  regulationLabel?: string;
  regulationSources?: string[];
}

const eok = (manwon: number) => (manwon / 10000).toFixed(2).replace(/\.?0+$/, '') + '억';

/** 규제 상태 1줄 — 근거 URL은 매일 동일해 소음이라 생략(웹 /regions·/guide에 상세). */
function regulationLines(r: RecoView): string[] {
  return r.regulationLabel ? [`🧾 ${r.regulationLabel.split(' — ')[0]}`] : [];
}

/** 단지 제원 한 줄(2026-08-29) — 준공·세대수·용적률·전용면적. 투자 판단의 기본 정보. */
function specLine(r: RecoView): string {
  const parts = [
    r.buildYear ? `🏗 ${r.buildYear}년` : null,
    r.household ? `👥 ${r.household.toLocaleString()}세대` : '👥 세대수 미상', // 모른다는 것도 투자 판단 정보
    r.far != null ? `📐 용적률 ${Math.round(r.far)}%` : null,
    r.areaText,
  ].filter(Boolean);
  return parts.join(' · ');
}

/** 최근 실거래 — 호가·중간값이 아니라 "마지막으로 실제 팔린 날짜와 값". */
function lastTradeLine(r: RecoView): string {
  if (!r.lastTradeDate || r.lastTradeManwon == null) return '🕘 최근 실거래 정보 없음';
  return `🕘 최근 거래 ${r.lastTradeDate.replace('-', '/')} · ${eok(r.lastTradeManwon)}`;
}

/** 근거 다이어트(2026-08-11) — 신호(🔻📈)·피드백(❤️)·부모님찬스(👨‍👩‍👦)·호재(🚧)는 우선 보존, 상위 n개만. */
function topReasons(reasons: string[], n = 4): string[] {
  const hot = reasons.filter((x) => /^(🔻|📈|❤️|👨‍👩‍👦|🚧)/.test(x));
  const rest = reasons.filter((x) => !hot.includes(x));
  return [...hot, ...rest].slice(0, n);
}

/**
 * 호가 신선도 경고 — 스윕이 조용히 0단지로 끝나도 추천은 계속 생성된다
 * (2026-08-20~30 실제로 11일간 그랬고, 묵은 호가가 '오늘의 추천'으로 나갔다).
 * 스윕은 주 5회 도니 3일을 넘으면 뭔가 잘못된 것이다.
 */
export const STALE_QUOTE_DAYS = 3;

export function quoteFreshnessLine(quoteAsOf?: string | null, staleDays?: number | null): string | null {
  if (!quoteAsOf || staleDays == null) return null;
  if (staleDays <= STALE_QUOTE_DAYS) return `💬 호가 기준 ${quoteAsOf}`;
  return `⚠️ 호가 기준 ${quoteAsOf} — <b>${staleDays}일 경과</b>(스윕 중단 중, 실제 호가는 달라졌을 수 있습니다)`;
}

export function header(count: number, asOf: string, quoteAsOf?: string | null, staleDays?: number | null): string {
  const fresh = quoteFreshnessLine(quoteAsOf, staleDays);
  return [
    `🏠 오늘의 매물 추천 · ${asOf}`,
    `${count}건 — 투자우선 기준(전세가율·환금성·신축·호재) · 생애최초 예산 프레임`,
    ...(fresh ? [fresh] : []),
    '매물별로 이어집니다 👇 각 메시지의 👍/🚫 버튼으로 취향을 알려주세요',
  ].join('\n');
}

export function emptyMessage(asOf: string): string {
  return [
    '🏠📊 오늘의 매물 추천',
    `🗓️ ${asOf}`,
    '',
    '📭 오늘은 규칙을 통과한 신규 후보가 없습니다.',
    '(최근 14일 추천분은 쿨다운 — 시장 변화·신저가 발생 시 재등장합니다)',
    '',
    '데이터는 계속 수집 중이며, 변화가 감지되면 바로 알려드립니다.',
  ].join('\n');
}

export function stretchHeader(count: number, asOf: string): string {
  return `➕ 스트레치+ ${count}건 — 예산을 넘지만 사정권(부모님 찬스 포함) · 실행 전 대출 한도 재확인 필수`;
}

export function formatStretchReco(r: RecoView): string {
  const lines: string[] = [];
  lines.push(`➕ ${r.rank}. ${r.name} — ${r.gu} ${r.dong}`);
  lines.push(specLine(r));
  lines.push(`💰 실거래 중간 ${eok(r.medianManwon)}${r.tradeCount ? ` (${r.tradeCount}건)` : ''} · ${lastTradeLine(r).replace('🕘 ', '')}`);
  if (r.overComfortManwon != null) lines.push(`💸 +${eok(r.overComfortManwon)} 더 필요${r.monthlyPayAddManwon != null ? ` · 월 상환 약 +${r.monthlyPayAddManwon}만` : ''}${r.monthsToReach != null ? ` · 적립 ${r.monthsToReach}개월${r.monthsToReach <= 24 ? '✅' : '⚠️'}` : ''}`);
  for (const reason of topReasons(r.reasons, 3)) lines.push(`✅ ${reason}`);
  for (const c of (r.cautions ?? []).slice(0, 1)) lines.push(`⚠️ ${c}`);
  if (r.complexNo) lines.push(`🔗 https://fin.land.naver.com/complexes/${r.complexNo}?tab=article`);
  return lines.join('\n');
}

export function gapHeader(count: number, asOf: string): string {
  return `🔓 참고: 비규제 갭 대안 ${count}건 — 전세 끼고 무대출 매수(즉시임대) · 실행 전 은행·규제 확인`;
}

export function formatGapReco(r: RecoView): string {
  const lines: string[] = [];
  lines.push(`🔓 ${r.rank}. ${r.name} — ${r.gu} ${r.dong} (비규제)`);
  lines.push(specLine(r));
  lines.push(`💰 매매 ${eok(r.medianManwon)} − 전세 ${eok(r.jeonseManwon ?? 0)} = 갭 ${eok(r.gapManwon ?? 0)} · 전세가율 ${r.jeonseRatioPct}%${r.gapCoverable ? ' · 자기자본 내 ✅' : ' ⚠️'}`);
  lines.push(lastTradeLine(r));
  for (const reason of topReasons(r.reasons, 2)) lines.push(`✅ ${reason}`);
  for (const c of (r.cautions ?? []).slice(0, 1)) lines.push(`⚠️ ${c}`);
  if (r.complexNo) lines.push(`🔗 https://fin.land.naver.com/complexes/${r.complexNo}?tab=article`);
  return lines.join('\n');
}

export function formatReco(r: RecoView): string {
  const lines: string[] = [];
  const budget = r.budgetLabel ?? (r.scenario === '현행' ? '생애최초 예산 내 ✅' : '예산 상단 · 대출 최적화 시 🔓');
  lines.push(`🏠 ${r.rank}. ${r.name} — ${r.gu} ${r.dong}`);
  lines.push(specLine(r));
  lines.push(`💰 실거래 중간 ${eok(r.medianManwon)}${r.tradeCount ? ` (${r.tradeCount}건)` : ''} · ${budget}`);
  lines.push(lastTradeLine(r));
  lines.push(...regulationLines(r));
  if (r.station && r.station !== '역세권 정보 확인 필요') lines.push(`🚇 ${r.station}`);
  for (const reason of topReasons(r.reasons)) lines.push(`✅ ${reason}`);
  for (const c of (r.cautions ?? []).slice(0, 2)) lines.push(`⚠️ ${c}`);
  if (r.complexNo) lines.push(`🔗 https://fin.land.naver.com/complexes/${r.complexNo}?tab=article`);
  return lines.join('\n');
}
