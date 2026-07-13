/**
 * 매물 페르소나 프리셋(G2-5·G3) — /listings 동적 조회와 gen-persona-recos(사전 생성) 공유.
 * 전부 기존 계산 필드의 결정적 필터+정렬 재조합(LLM·신규 수집 없음). 점수는 참고자료 원칙:
 * metric()이 페르소나별 핵심 원천 수치를 문자열로 노출해 검증 경로를 제공한다.
 */

export interface PersonaRow {
  price: number; // 만원
  area: number | null;
  elapsedYear: number | null;
  household: number;
  jeonseRatioPct: number;
  tradeCount: number;
  cm?: { totalMin: number } | null;
  am?: { score: number } | null;
  a: { totalScore: number; base: { roeAnnualPct: number } };
}

export interface PersonaDef {
  label: string;
  desc: string;
  filter?: (r: PersonaRow) => boolean;
  sort: (a: PersonaRow, b: PersonaRow) => number;
  /** 페르소나별 핵심 원천 수치(검증용 표기) */
  metric: (r: PersonaRow) => string;
}

export const LISTING_PERSONAS: Record<string, PersonaDef> = {
  commute: {
    label: '🚇 출퇴근 우선',
    desc: '통근 총 소요시간 오름차순(카카오 실경로/근사) — 통근 계산 불가 매물 제외',
    filter: (r) => r.cm != null,
    sort: (a, b) => (a.cm!.totalMin - b.cm!.totalMin) || b.a.totalScore - a.a.totalScore,
    metric: (r) => `통근 ~${r.cm?.totalMin ?? '?'}분`,
  },
  invest: {
    label: '📈 투자수익 우선',
    desc: '기본 시나리오 연 ROE 내림차순 · 동률 시 전세가율(임대전환 용이) 순 — 전세가율 95%+(역전세·깡통 위험)는 제외',
    filter: (r) => r.jeonseRatioPct < 95,
    sort: (a, b) => (b.a.base.roeAnnualPct - a.a.base.roeAnnualPct) || b.jeonseRatioPct - a.jeonseRatioPct,
    metric: (r) => `ROE ${r.a.base.roeAnnualPct.toFixed(1)}%/년 · 전세가율 ${r.jeonseRatioPct}%`,
  },
  newbuild: {
    label: '🏗️ 신축 우선',
    desc: '10년 이내 준신축만 · 연식 오름차순 — 감가방어·임대선호',
    filter: (r) => r.elapsedYear != null && r.elapsedYear <= 10,
    sort: (a, b) => ((a.elapsedYear ?? 99) - (b.elapsedYear ?? 99)) || b.a.totalScore - a.a.totalScore,
    metric: (r) => `${r.elapsedYear}년차 · ${r.household.toLocaleString()}세대`,
  },
  environ: {
    label: '🌳 주거환경 우선',
    desc: '상권·역세권 실측 점수 내림차순 · 동률 시 대단지 순 — 실측 없는 매물 제외',
    filter: (r) => r.am != null,
    sort: (a, b) => (b.am!.score - a.am!.score) || b.household - a.household,
    metric: (r) => `상권·역세권 ${r.am?.score ?? '?'}점 · ${r.household.toLocaleString()}세대`,
  },
  value: {
    label: '💎 가성비',
    desc: '전용 ㎡당 가격 오름차순 — 종합점수 45+ · 실거래 3건+ 검증분만(싼 이유는 리스크 카드에서 확인)',
    filter: (r) => r.area != null && r.a.totalScore >= 45 && r.tradeCount >= 3,
    sort: (a, b) => a.price / (a.area ?? 1) - b.price / (b.area ?? 1),
    metric: (r) => `㎡당 ${Math.round(r.price / (r.area ?? 1)).toLocaleString()}만 · 실거래 ${r.tradeCount}건`,
  },
};
