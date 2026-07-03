/**
 * Daily digest prompt templates (CMP-131 redesign).
 *
 * Stage 1: Market data collection         → buildMarketPrompt
 * Stage 2: Per-article structured summary → buildCategoryPrompt
 * Stage 6: Cross-category TOP 3 selection → buildTop3Prompt
 *
 * Runtime: LM Studio (gemma4:26b MLX)
 * CMP-131: new system+user prompt spec — fact accuracy first, no hallucination.
 */

import type { Category, RawCluster, MarketSnapshot } from '../types';

// ─── Stage 1: Market data collection ─────────────────────────────────────────

export function buildMarketPrompt(date: string): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content:
        '반드시 한국어로 JSON만 출력하세요. 금융 데이터 분석가로서 주어진 날짜의 시장 지표를 추정합니다. 순수 JSON만, 마크다운·코드블록 없이.',
    },
    {
      role: 'user',
      content: `오늘 날짜: ${date}

아래 형식으로 시장 지표를 반환하세요 (학습 데이터 기준 합리적 추정치).
direction은 반드시 "up", "down", "flat" 중 하나. change는 부호 포함 문자열.

{"date":"${date}","kospi":{"value":0,"change":"+0.0%","direction":"flat"},"kosdaq":{"value":0,"change":"+0.0%","direction":"flat"},"usdKrw":{"value":0,"change":"+0.0","direction":"flat"},"wti":{"value":0,"change":"+0.0%","direction":"flat"},"us10y":{"value":0,"change":"+0.00","direction":"flat"},"btcUsd":{"value":0,"change":"+0.0%","direction":"flat"}}`,
    },
  ];
}

// ─── Stages 2-5: Per-category news structuring ────────────────────────────────
//
// CMP-131 prompt spec:
//   System: fact-first Korean summarizer, strict no-hallucination rules
//   User: structured output with 한줄 요약 / 핵심 포인트 / 숫자로 보기 / 쉽게 설명하면 / 체크 포인트
//   Multi-source extension: 출처 정보 block prepended when sourceCount >= 2


// CMP-131 system prompt (exact spec from issue)
const SYSTEM_PROMPT = `너는 사실 중심의 한국어 뉴스 요약 분석가다.

목표:
- 기사 본문을 읽고 핵심 사실, 핵심 숫자, 기사 의미를 빠르게 이해하게 만든다.
- 정확성을 간결함보다 우선한다.

절대 규칙:
1. 기사 본문에 없는 정보는 추가하지 않는다.
2. 추론이 필요한 내용은 단정하지 않는다.
3. 사실과 해석을 분리한다.
4. 숫자, 날짜, 금액, 지역, 인물, 기관, 정책명은 원문 기준으로 유지한다.
5. 억/조, million/billion, %, 건수, 가구수 단위를 임의 변환하지 않는다.
6. 숫자 해석이 모호하면 "원문 해석이 모호함"이라고 표시한다.
7. 원문 문장을 길게 복사하지 않는다.
8. 같은 내용을 반복하지 않는다.
9. 과장하지 않는다.
10. 출력 형식을 반드시 지킨다.

작업 순서:
- 사실 추출
- 의미 분리
- 숫자/단위 검산
- 최종 출력

출력 스타일:
- 짧고 단정하게
- 쉬운 한국어
- 핵심 먼저
- 불확실하면 명시

반드시 JSON만 출력. 마크다운·코드블록·설명 절대 금지.`;

/** Render one cluster as the article block fed into the batch prompt. */
function renderCluster(cluster: RawCluster, index: number): string {
  const sc = cluster.sourceCount;
  const isMulti = sc >= 2;
  const srcLabel = isMulti
    ? `출처(${sc}개): ${cluster.sourceList.join(', ')}`
    : `출처: ${cluster.source}`;
  const multiHeader = isMulti
    ? `[다중 출처 기사 — 아래 각 출처별 본문을 비교하여 공통 사실과 이견을 추출하세요]\n`
    : '';

  return `[${index + 1}] ${multiHeader}제목: ${cluster.title}
${srcLabel} | source_count=${sc}
URL: ${cluster.url}
본문:
${cluster.mergedContent.slice(0, isMulti ? 800 : 400)}`;
}

export function buildCategoryPrompt(
  date: string,
  category: Category,
  clusters: RawCluster[],
  marketSnapshot?: MarketSnapshot,
): Array<{ role: 'system' | 'user'; content: string }> {
  const marketContext = marketSnapshot
    ? `\n오늘 시장: KOSPI ${marketSnapshot.kospi.value}(${marketSnapshot.kospi.change}), ` +
      `KOSDAQ ${marketSnapshot.kosdaq.value}(${marketSnapshot.kosdaq.change}), ` +
      `USD/KRW ${marketSnapshot.usdKrw.value}(${marketSnapshot.usdKrw.change}), ` +
      `BTC ${marketSnapshot.btcUsd.value.toLocaleString()}USD(${marketSnapshot.btcUsd.change})`
    : '';

  const regularClusters = clusters.filter((c) => !c.isGithubTrending);
  const trendingClusters = clusters.filter((c) => c.isGithubTrending);

  const articlesText = regularClusters.length > 0
    ? regularClusters.map(renderCluster).join('\n\n')
    : '(수집된 기사 없음)';

  const githubSection = trendingClusters.length > 0
    ? `\n\n## GitHub Trending AI 오픈소스 (${trendingClusters.length}개)\n` +
      trendingClusters.map((c, i) => `[G${i + 1}] ${c.title}\n${c.mergedContent}\nURL: ${c.url}`).join('\n\n')
    : '';

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `오늘 날짜: ${date}
카테고리: ${category}${marketContext}

## 수집된 뉴스 클러스터 (${regularClusters.length}건)

${articlesText}${githubSection}

---

위 기사들을 분석해 아래 JSON을 출력하세요.

중요:
- 다중 출처 기사는 각 출처 본문을 비교해 consensusFacts(공통 사실)와 conflictingFacts(이견)를 반드시 추출하세요.
- source_count >= 2이면 fact 앞에 "[N곳 공통 보도]" 접두사를 붙이세요.
- 단일 출처이면 consensusFacts는 null, conflictingFacts는 null.
- 최대 10건 출력. 반드시 위에 수집된 기사만 사용하세요. 기사가 10건 미만이면 있는 만큼만 출력하고, 절대 기사에 없는 뉴스를 지어내지 마세요.
- urgency "breaking"은 카테고리당 최대 2건.

출력 형식 (순수 JSON):
{
  "category": "${category}",
  "summary": "오늘 이 카테고리 핵심 흐름 2~3문장",
  "items": [
    {
      "title": "뉴스 제목",
      "urgency": "breaking|watch|note",
      "fact": "핵심 사실 1문장 (source_count>=2이면 [N곳 공통 보도] 접두사)",
      "consensusFacts": "공통 사실 3~5문장 또는 null",
      "conflictingFacts": "출처 간 이견 또는 null",
      "impact": "영향 1문장",
      "action": "행동 지침 1문장 (~검토|~주시|~대비)",
      "contextTags": ["태그1", "태그2"],
      "source": "출처명(들)",
      "sourceUrl": "https://..."
    }
  ]
}

urgency는 반드시 "breaking", "watch", "note" 중 하나. 순수 JSON만 출력.`,
    },
  ];
}

// ─── Structured-output JSON Schemas (LM Studio response_format) ──────────────
// Constrains decoding server-side so malformed-JSON retries disappear.

const NEWS_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    urgency: { type: 'string', enum: ['breaking', 'watch', 'note'] },
    fact: { type: 'string' },
    consensusFacts: { type: ['string', 'null'] },
    conflictingFacts: { type: ['string', 'null'] },
    impact: { type: 'string' },
    action: { type: 'string' },
    contextTags: { type: 'array', items: { type: 'string' } },
    source: { type: 'string' },
    sourceUrl: { type: 'string' },
  },
  required: ['title', 'urgency', 'fact', 'impact', 'action', 'contextTags', 'source', 'sourceUrl'],
} as const;

export const CATEGORY_RESULT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    category: { type: 'string' },
    summary: { type: 'string' },
    items: { type: 'array', items: NEWS_ITEM_SCHEMA },
  },
  required: ['category', 'summary', 'items'],
};

export const TOP3_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    top3: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rank: { type: 'integer' },
          category: { type: 'string' },
          title: { type: 'string' },
          urgency: { type: 'string', enum: ['breaking', 'watch', 'note'] },
          fact: { type: 'string' },
          impact: { type: 'string' },
          action: { type: 'string' },
          contextTags: { type: 'array', items: { type: 'string' } },
          source: { type: 'string' },
          sourceUrl: { type: 'string' },
          relatedData: { type: 'array', items: { type: 'string' } },
          contextLinks: { type: 'array', items: { type: 'string' } },
          upcomingEvents: { type: 'array', items: { type: 'string' } },
        },
        required: ['rank', 'category', 'title', 'urgency', 'fact', 'impact', 'action'],
      },
    },
  },
  required: ['top3'],
};

// ─── Stage 6: Cross-category TOP 3 selection ─────────────────────────────────

export function buildTop3Prompt(
  date: string,
  /** Flat, persisted item list — array position i ↔ prompt label [i+1] ↔ LLM "index" field */
  allItems: Array<{
    category: Category;
    title: string;
    urgency: string;
    fact: string;
    impact: string;
    action?: string;
  }>,
): Array<{ role: 'system' | 'user'; content: string }> {
  const itemsText = allItems
    .map(
      (item, i) =>
        `[${i + 1}] [${item.category}] urgency=${item.urgency}\n제목: ${item.title}\nfact: ${item.fact}\nimpact: ${item.impact}`,
    )
    .join('\n\n');

  return [
    {
      role: 'system',
      content:
        '반드시 한국어로 JSON만 출력하세요. 마크다운·코드블록 절대 금지. 당신은 시니어 투자 애널리스트입니다. 전체 뉴스 중 오늘 가장 중요한 3건을 선정합니다.',
    },
    {
      role: 'user',
      content: `오늘 날짜: ${date}

## 전체 뉴스 목록 (${allItems.length}건)

${itemsText}

---

## [STEP 6] 크로스 카테고리 TOP 3 선정

선정 기준 (가중치 순):
1. 내 자산(주식/부동산/연금)에 직접 영향 → 최우선
2. 시장 전체 방향성에 영향 → 우선
3. 향후 1개월 내 중대한 변화 예고 → 높음
4. 산업/기술 패러다임 변화 → 보통

주의: 가급적 2개 이상 카테고리에서 선정 (카테고리 편중 금지).

각 TOP 항목 추가 필드:
- relatedData: 핵심 데이터 포인트 2~3개 (예: "WTI +3.5%")
- contextLinks: 다른 카테고리 연관 뉴스 제목
- upcomingEvents: 관련 후속 이벤트 일정

## 출력 형식 (순수 JSON)

{
  "top3": [
    {
      "rank": 1,
      "index": 12,
      "category": "카테고리명",
      "title": "뉴스 제목",
      "urgency": "breaking|watch|note",
      "fact": "팩트 1문장",
      "impact": "임팩트 1문장",
      "action": "액션 1문장",
      "contextTags": ["태그1"],
      "source": "출처명",
      "sourceUrl": "https://...",
      "relatedData": ["핵심 수치 1", "핵심 수치 2"],
      "contextLinks": ["연관 카테고리 뉴스 제목"],
      "upcomingEvents": ["후속 이벤트 일정"]
    }
  ]
}

urgency는 반드시 "breaking", "watch", "note" 중 하나.
index는 반드시 위 목록의 [N] 번호를 그대로 사용 (선정 근거가 된 항목의 번호). title을 수정·번역하더라도 index는 원본 번호여야 함.`,
    },
  ];
}
