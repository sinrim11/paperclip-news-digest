/**
 * Personalized notification prompt.
 * Reader profile: semiconductor (Hanmi/HBM), energy/nuclear (Doosan Enerbility),
 * DC pension, and metropolitan Seoul real-estate.
 *
 * Runtime: LM Studio (gemma4:26b MLX) — no @anthropic-ai/sdk.
 */

import type { CategoryKey } from '../types';

export interface PersonalizedAlert {
  category: CategoryKey;
  title: string;
  urgency: 'breaking' | 'watch' | 'note';
  relevance: string; // why this item matches the reader profile
  action: string;    // concrete step the reader should take today
  portfolioImpact?: string; // optional: direct portfolio / asset impact
}

export interface PersonalizedDigest {
  date: string;
  alerts: PersonalizedAlert[];
  summary: string; // 2–3 sentence personalised daily brief
}

// ─── Reader profile (kept here so the prompt is self-contained) ──────────────

const READER_PROFILE = `
독자 투자 포트폴리오 및 관심사:
1. 반도체 — 한미반도체(KOSPI:042700), HBM/CoWoS 장비 밸류체인
2. 에너지/원자력 — 두산에너빌리티(KOSPI:034020), SMR·APR1400 수주 파이프라인
3. DC연금(확정기여형) — 국내 ETF, TDF 운용 / 수익률에 민감
4. 수도권 아파트 — 서울·분당·판교 거주 또는 투자 관심, 금리·DSR 정책에 민감
`.trim();

// ─── Personalised alert prompt ───────────────────────────────────────────────

/**
 * Build a personalised notification prompt from the day's processed news items.
 * Pass the condensed top-50 list (title + urgency + fact) to save tokens.
 */
export function buildPersonalizedPrompt(
  date: string,
  newsItems: Array<{
    category: CategoryKey;
    title: string;
    urgency: string;
    fact: string;
    impact: string;
    action: string;
  }>,
): Array<{ role: 'system' | 'user'; content: string }> {
  const itemsText = newsItems
    .map(
      (item, i) =>
        `[${i + 1}] [${item.category}] ${item.urgency} | ${item.title}\n팩트: ${item.fact}\n임팩트: ${item.impact}`,
    )
    .join('\n\n');

  return [
    {
      role: 'system',
      content: `당신은 개인 자산관리 어드바이저입니다.
독자의 포트폴리오와 관심사를 기반으로 오늘의 뉴스 중 직접 관련 있는 항목만 선별하여 맞춤형 알림을 생성합니다.
반드시 순수 JSON만 출력하세요. 마크다운, 설명, 코드 블록 없이.`,
    },
    {
      role: 'user',
      content: `오늘 날짜: ${date}

## 독자 프로필

${READER_PROFILE}

## 오늘 전체 뉴스 목록 (${newsItems.length}건)

${itemsText}

## 작업 지시

위 뉴스 중 독자 포트폴리오·관심사에 직접 관련된 항목만 선별하세요.
관련 없는 뉴스는 포함하지 마세요.

선별 기준 (내림차순):
1. 한미반도체·HBM·반도체 장비 관련 뉴스
2. 두산에너빌리티·SMR·원전 관련 뉴스
3. DC연금 수익률에 영향 (금리, ETF, 운용사 정책)
4. 수도권 아파트·부동산 정책 (금리, DSR, 공급 정책)

context_tags가 포트폴리오 키워드(반도체, 원전, 연금, 부동산)와 겹치는 뉴스를 우선 선별하세요.

출력 형식 (순수 JSON):
{
  "date": "${date}",
  "alerts": [
    {
      "category": "GLOBAL|STOCKS|AI|POLICY|REALESTATE",
      "title": "뉴스 제목",
      "urgency": "breaking|watch|note",
      "relevance": "독자 포트폴리오와 연관되는 이유 1문장",
      "action": "오늘 독자가 취해야 할 구체적 행동 1문장",
      "portfolioImpact": "예상 주가/자산 영향 (해당 시)"
    }
  ],
  "summary": "오늘 독자 포트폴리오 관점 총평 2~3문장"
}`,
    },
  ];
}
