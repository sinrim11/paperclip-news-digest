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
}

const eok = (manwon: number) => (manwon / 10000).toFixed(2).replace(/\.?0+$/, '') + '억';

export function header(count: number, asOf: string): string {
  return [
    '🏠📊 오늘의 매물 추천',
    `🗓️ ${asOf} · 총 ${count}건`,
    '',
    '💡 기준: 투자우선 — 신축프리미엄·전세가율·환금성·시세방어·개발호재 종합',
    '📌 예산: 2년 적립 자기자본권 기준 (생애최초 LTV70%·마통 해지 — 상세는 매물별 표기)',
    '🎯 전략: Path A — 서울/경기 준신축 실거주 후 2년 뒤 임대전환(생애최초 활용)',
    '🧭 장세: 공급절벽發 완만상승·초양극화 — 서남·동북권 중저가가 강세',
    '',
    '아래 매물별로 이어서 보냅니다 👇',
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
  return [
    '➕ 스트레치+ — 조금 더 보태면 사정권',
    `🗓️ ${asOf} · ${count}건`,
    '',
    '💡 오늘 자기자본권을 넘지만 스윕 상한 이내인 구간 — 메인 추천과 분리된 참고 트랙입니다.',
    '📌 각 매물에 "+얼마 더" · 월 상환 증가분 · 조달 개월(월 적립 기준)을 표기합니다.',
    '⚠️ 실행 전 대출 한도(LTV·DSR·정책한도) 재확인 필수 — 점수는 참고자료이며 판단은 본인이 합니다.',
    '',
  ].join('\n');
}

export function formatStretchReco(r: RecoView): string {
  const lines: string[] = [];
  lines.push(`➕ ${r.rank}. ${r.name}`);
  lines.push(`📍 ${r.gu} ${r.dong}`);
  lines.push('━━━━━━━━━━━━━━');
  const spec = [r.buildYear ? `${r.buildYear}년` : '연식미상', r.areaText].filter(Boolean);
  lines.push(`🏢 ${spec.join(' · ')}${r.tradeCount ? ` · 최근 ${r.tradeCount}건` : ''}`);
  lines.push(`💰 실거래 중간 ${eok(r.medianManwon)}${r.priceRangeText ? ` (범위 ${r.priceRangeText})` : ''}`);
  if (r.overComfortManwon != null) lines.push(`💸 더 보태면: +${eok(r.overComfortManwon)} (오늘 자기자본권 초과분)`);
  if (r.monthlyPayAddManwon != null) lines.push(`📈 월 상환 증가분: 약 +${r.monthlyPayAddManwon}만/월`);
  lines.push(`⏳ 조달: ${r.monthsToReach != null ? `월 적립 유지 시 약 ${r.monthsToReach}개월 뒤 도달${r.monthsToReach <= 24 ? ' ✅(2년 내)' : ' ⚠️(2년 초과)'}` : '월 적립액 미설정 — 판정 불가'}`);
  if (r.station && r.station !== '역세권 정보 확인 필요') lines.push(`🚇 ${r.station}`);
  if (r.catalyst) lines.push(`🚧 호재: ${r.catalyst}`);
  lines.push('');
  lines.push('📈 선정 근거');
  for (const reason of r.reasons) lines.push(`  ✅ ${reason}`);
  if (r.cautions?.length) {
    lines.push('');
    lines.push('⚠️ 유의점');
    for (const c of r.cautions) lines.push(`  • ${c}`);
  }
  if (r.complexNo) lines.push(`\n🔗 네이버: https://fin.land.naver.com/complexes/${r.complexNo}?tab=article`);
  return lines.join('\n');
}

export function gapHeader(count: number, asOf: string): string {
  return [
    '🔓 참고: 비규제 갭 대안 (Path B)',
    `🗓️ ${asOf} · ${count}건`,
    '',
    '💡 메인은 Path A(실거주→임대) 선택. 아래는 참고용 — 안양 만안(유일 비규제)에서 전세 끼고 무대출 매수 시 즉시임대 가능한 대안.',
    '⚠️ 1주택 되면 현 전세대출 회수·생애최초 소진 리스크 — 실행 전 은행/규제 확인.',
    '',
  ].join('\n');
}

export function formatGapReco(r: RecoView): string {
  const lines: string[] = [];
  lines.push(`🔓 ${r.rank}. ${r.name}`);
  lines.push(`📍 ${r.gu} ${r.dong} · 비규제`);
  lines.push('━━━━━━━━━━━━━━');
  const spec = [r.buildYear ? `${r.buildYear}년` : '연식미상', r.areaText].filter(Boolean);
  lines.push(`🏢 ${spec.join(' · ')}${r.tradeCount ? ` · 최근 ${r.tradeCount}건` : ''}`);
  lines.push(`💰 매매 ${eok(r.medianManwon)} − 전세 ${eok(r.jeonseManwon ?? 0)} = 갭 ${eok(r.gapManwon ?? 0)}`);
  lines.push(`📊 전세가율 ${r.jeonseRatioPct}% · ${r.gapCoverable ? '갭 자기자본 내 ✅' : '갭 자기자본 초과분 필요 ⚠️'}`);
  if (r.station && r.station !== '역세권 정보 확인 필요') lines.push(`🚇 ${r.station}`);
  lines.push('');
  lines.push('📈 선정 근거');
  for (const reason of r.reasons) lines.push(`  ✅ ${reason}`);
  if (r.cautions?.length) {
    lines.push('');
    lines.push('⚠️ 유의점');
    for (const c of r.cautions) lines.push(`  • ${c}`);
  }
  if (r.complexNo) lines.push(`\n🔗 네이버: https://fin.land.naver.com/complexes/${r.complexNo}?tab=article`);
  return lines.join('\n');
}

export function formatReco(r: RecoView): string {
  const lines: string[] = [];
  const budget = r.budgetLabel ?? (r.scenario === '현행' ? '생애최초 예산(8억) 내 ✅' : '8~9억 · 대출 최적화 시 🔓');
  lines.push(`🏠 ${r.rank}. ${r.name}`);
  lines.push(`📍 ${r.gu} ${r.dong}`);
  lines.push('━━━━━━━━━━━━━━');
  const spec = [r.buildYear ? `${r.buildYear}년` : '연식미상', r.household ? `${r.household.toLocaleString()}세대` : null, r.areaText].filter(Boolean);
  lines.push(`🏢 ${spec.join(' · ')}`);
  lines.push(`💰 실거래 중간 ${eok(r.medianManwon)}${r.priceRangeText ? ` (범위 ${r.priceRangeText})` : ''}${r.tradeCount ? ` · 최근 ${r.tradeCount}건 거래` : ''}`);
  lines.push(`🎯 예산: ${budget}`);
  if (r.station) lines.push(`🚇 ${r.station}`);
  if (r.catalyst) lines.push(`🚧 호재: ${r.catalyst}`);
  if (r.school) lines.push(`🏫 학군: ${r.school}`);
  if (r.amenities) lines.push(`🛒 편의: ${r.amenities}`);
  if (r.living) lines.push(`🏡 거주: ${r.living}`);
  lines.push('');
  lines.push('📈 선정 근거');
  for (const reason of r.reasons) lines.push(`  ✅ ${reason}`);
  if (r.cautions?.length) {
    lines.push('');
    lines.push('⚠️ 유의점');
    for (const c of r.cautions) lines.push(`  • ${c}`);
  }
  if (r.complexNo) {
    lines.push('');
    lines.push(`🔗 네이버: https://fin.land.naver.com/complexes/${r.complexNo}?tab=article`);
  }
  if (r.sources?.length) lines.push(`📚 근거: ${r.sources.slice(0, 3).join(' · ')}`);
  return lines.join('\n');
}
