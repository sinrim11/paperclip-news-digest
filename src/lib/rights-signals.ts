/**
 * rights-signals.ts — 권리 위험 신호와 맞춤 확인사항 (2026-09-12).
 *
 * 성규님 지시: "이 집을 사도 안전한가" — 권리분석.
 *
 * **먼저 선을 긋는다.** 등기부등본은 공공 API가 없다(인터넷등기소는 건당 유료·기관 연계).
 * 근저당이 얼마인지, 가압류가 걸렸는지 우리가 대신 조회해 줄 수 없다. 할 수 있는 척하는 것이
 * 가장 위험하므로, 이 모듈은 두 가지만 한다:
 *   ① 우리가 가진 데이터로 잡히는 **위험 신호**를 모은다(전세가율·이상 저가·점유·규제).
 *   ② 그 신호에 맞춰 **등기부에서 무엇을 볼지**를 구체화한다.
 *
 * 종전 체크리스트는 "등기부등본 — 근저당·가압류" 한 줄이었다. 초보에게는 그 줄을 읽어도
 * 무엇을 어떻게 보라는 건지 알 수 없다. 단지 상황을 넣어 문장으로 만든다.
 */

export type RiskLevel = 'high' | 'watch';

export interface RightsSignal {
  level: RiskLevel;
  label: string;   // 신호 이름(짧게)
  why: string;     // 왜 위험한지
  check: string;   // 그래서 무엇을 확인할지
}

export interface RightsInput {
  jeonseRatioPct?: number | null;  // 전세가율
  gapPct?: number | null;          // 호가 − 실거래 중간 (음수 = 호가가 낮음)
  tradeCount?: number;             // 실거래 표본
  occupancy?: { vacant: number; tenant: number; owner: number }; // 매물 점유 분포
  hugSafeLessor?: boolean | null;  // HUG 안심임대인 등록
  landPermitZone?: boolean;        // 토지거래허가구역
  elapsedYear?: number | null;
}

/**
 * 신호 산출. 임계는 보수적으로 잡는다 — 겁주는 게 목적이 아니라 '확인할 것'을 좁히는 게 목적이다.
 */
export function rightsSignals(input: RightsInput): RightsSignal[] {
  const out: RightsSignal[] = [];
  const { jeonseRatioPct: jr, gapPct, tradeCount, occupancy, hugSafeLessor, landPermitZone, elapsedYear } = input;

  // ① 깡통 위험 — 전세가율이 높으면 매매가 하락 시 보증금이 매매가를 넘는다
  if (jr != null && jr >= 90) {
    out.push({
      level: 'high',
      label: `전세가율 ${jr}%`,
      why: '매매가가 조금만 내려도 보증금이 매매가를 넘어섭니다(깡통).',
      check: '을구 근저당 채권최고액 + 보증금이 매매가의 80%를 넘는지. 넘으면 세입자가 대항력을 행사할 때 매수인이 떠안습니다.',
    });
  } else if (jr != null && jr >= 80) {
    out.push({
      level: 'watch',
      label: `전세가율 ${jr}%`,
      why: '세 끼고 사면 자기자본이 적게 들지만 하방이 얇습니다.',
      check: '보증금 반환 여력 — 근저당 + 보증금 합계가 매매가 대비 얼마인지.',
    });
  }

  // ② 이상 저가 — 급매일 수도, 권리 하자일 수도. 둘을 구분하는 건 등기부다
  if (gapPct != null && gapPct <= -15) {
    out.push({
      level: 'high',
      label: `호가가 실거래보다 ${Math.abs(gapPct)}% 낮음`,
      why: '급매일 수도 있지만, 층·향으로 설명되지 않는 저가는 권리 문제인 경우가 있습니다.',
      check: '갑구 — 소유자와 매도인이 같은지, 최근 소유권 이전이 잦았는지. 을구 — 가압류·가처분·신탁 등기 여부. 경매 진행 중이면 등기부에 임의경매개시결정이 보입니다.',
    });
  }

  // ③ 세 낀 매물 — 대항력 있는 임차인은 매수인이 승계한다
  if (occupancy && occupancy.tenant > 0) {
    out.push({
      level: 'watch',
      label: `세 낀 매물 ${occupancy.tenant}건`,
      why: '전입신고 + 확정일자를 갖춘 임차인은 매수인이 그대로 떠안습니다. 실입주 시점도 만기에 묶입니다.',
      check: '임대차계약서 만기·보증금·전입신고일. 전입일이 근저당 설정일보다 빠르면 대항력이 있어 경매 시에도 보증금을 먼저 가져갑니다.',
    });
  }

  // ④ HUG 안심임대인 — 전세 낀 매물의 보증금 안전 참고(있으면 가점, 없다고 위험은 아님)
  if (hugSafeLessor === true) {
    out.push({
      level: 'watch',
      label: 'HUG 안심임대인 등록',
      why: '보증금 반환보증 가입 이력이 있는 임대인입니다.',
      check: '승계 시 보증이 유지되는지 — 매수인 명의로 재가입이 필요할 수 있습니다.',
    });
  }

  // ⑤ 토허구역 — 권리라기보다 처분 제약이지만 '살 수 있나'라는 같은 질문에 걸린다
  if (landPermitZone) {
    out.push({
      level: 'watch',
      label: '토지거래허가구역',
      why: '2년 실거주 의무가 붙어 세 끼고 매수(갭투자)가 불가합니다.',
      check: '기존 임차인이 있으면 허가가 나지 않습니다 — 잔금 전 퇴거 조건을 계약서에 명시.',
    });
  }

  // ⑥ 표본 부족 — 권리 신호는 아니지만 '시세를 믿을 수 있나'에 직결
  if (tradeCount != null && tradeCount <= 3) {
    out.push({
      level: 'watch',
      label: `실거래 ${tradeCount}건`,
      why: '시세 표본이 얇아 호가가 적정한지 판단하기 어렵습니다.',
      check: '인근 동일 연식·세대수 단지와 평단가 교차 확인.',
    });
  }

  // ⑦ 노후 단지 — 등기부보다 건축물대장 쪽
  if (elapsedYear != null && elapsedYear >= 30) {
    out.push({
      level: 'watch',
      label: `${elapsedYear}년차`,
      why: '재건축 기대가 호가에 선반영됐을 수 있고, 위반건축물·대수선 이력이 대출을 막기도 합니다.',
      check: '건축물대장 — 위반건축물 표기 여부. 표기가 있으면 주담대가 거절될 수 있습니다.',
    });
  }

  return out;
}

/** 신호가 없을 때도 기본 확인은 남긴다 — '이상 없음'이 '확인 불필요'는 아니다. */
export const BASE_RIGHTS_CHECK = [
  '갑구 — 등기부상 소유자와 계약 상대방이 같은 사람인지(대리 계약이면 위임장·인감)',
  '을구 — 근저당 채권최고액. 잔금일에 말소 조건을 특약으로 넣었는지',
  '건축물대장 — 위반건축물 표기 여부(대출 거절 사유)',
];
