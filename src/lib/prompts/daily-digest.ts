/**
 * Daily digest prompt templates.
 * All prompts target Ollama gemma4:26b (no web_search — articles are pre-fetched via RSS).
 */

import type { Category, RawArticle, MarketSnapshot } from '../types';

// ─── Market data collection prompt ───────────────────────────────────────────

export function buildMarketPrompt(date: string): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content:
        '당신은 금융 데이터 분석가입니다. 주어진 날짜의 주요 시장 지표를 JSON 형식으로 반환합니다. 순수 JSON만 출력하세요.',
    },
    {
      role: 'user',
      content: `오늘 날짜: ${date}

다음 시장 지표의 최근 수준을 JSON으로 반환하세요.
학습 데이터 기준으로 합리적인 추정치를 제공하세요 (실시간 데이터 없음).

출력 형식 (순수 JSON, 추가 설명 없음):
{
  "date": "${date}",
  "kospi": { "value": 0, "change": "0%", "direction": "flat" },
  "kosdaq": { "value": 0, "change": "0%", "direction": "flat" },
  "usdKrw": { "value": 0, "change": "0", "direction": "flat" },
  "wti": { "value": 0, "change": "0%", "direction": "flat" },
  "us10y": { "value": 0, "change": "0", "direction": "flat" },
  "btcUsd": { "value": 0, "change": "0%", "direction": "flat" }
}

direction은 "up", "down", "flat" 중 하나입니다.`,
    },
  ];
}

// ─── Per-category news structuring prompt ────────────────────────────────────

export function buildCategoryPrompt(
  date: string,
  category: Category,
  articles: RawArticle[],
  marketSnapshot?: MarketSnapshot,
): Array<{ role: 'system' | 'user'; content: string }> {
  const marketContext = marketSnapshot
    ? `\n마켓 스냅샷: KOSPI ${marketSnapshot.kospi.value} (${marketSnapshot.kospi.change}), USD/KRW ${marketSnapshot.usdKrw.value}`
    : '';

  const articlesText = articles
    .map(
      (a, i) =>
        `[${i + 1}] 제목: ${a.title}\n출처: ${a.source}\nURL: ${a.url}\n내용: ${a.content || '(내용 없음)'}`,
    )
    .join('\n\n');

  return [
    {
      role: 'system',
      content: `당신은 시니어 뉴스 에디터 겸 투자 애널리스트입니다.
독자는 IT업계 시니어 개발자이면서 적극적 투자자이며, 정책과 부동산에도 관심이 많습니다.
반드시 순수 JSON만 출력하세요. 마크다운, 설명, 코드 블록 없이.`,
    },
    {
      role: 'user',
      content: `오늘 날짜: ${date}${marketContext}
카테고리: ${category}

## 수집된 뉴스 기사 (${articles.length}건)

${articlesText}

## 작업 지시

위 기사들을 분석하여 아래 JSON 구조로 반환하세요.
최대 10건을 선정하되 중복/무관 기사는 제외하세요.

긴급도 기준:
- "breaking": 오늘 즉시 포트폴리오/의사결정 영향 (카테고리당 최대 2건)
- "watch": 1~2주 내 영향 예상
- "note": 알아두면 좋은 배경 지식

맥락 태그(contextTags): 다른 카테고리 뉴스와 연결되는 키워드 (예: "미_관세", "AI_규제")

출력 형식 (순수 JSON):
{
  "category": "${category}",
  "summary": "카테고리 전체 흐름 2~3문장 총평",
  "items": [
    {
      "title": "뉴스 제목",
      "urgency": "breaking|watch|note",
      "fact": "📌 무슨 일이 일어났는가 — 수치/날짜/주체 포함 1문장",
      "impact": "💡 왜 중요한가 — 시장/산업/사회 영향 1문장",
      "action": "🎯 독자에게 어떤 의미인가 — 구체적 행동 지침 1문장",
      "contextTags": ["tag1", "tag2"],
      "source": "출처명",
      "sourceUrl": "https://..."
    }
  ]
}`,
    },
  ];
}

// ─── TOP 3 selection prompt ───────────────────────────────────────────────────

export function buildTop3Prompt(
  date: string,
  categorySummaries: Array<{ category: Category; items: Array<{ title: string; urgency: string; fact: string; impact: string; action: string; category?: Category }> }>,
): Array<{ role: 'system' | 'user'; content: string }> {
  const allItems = categorySummaries.flatMap((cs) =>
    cs.items.map((item) => ({ ...item, category: cs.category })),
  );

  const itemsText = allItems
    .map((item, i) => `[${i + 1}] [${item.category}] ${item.urgency} "${item.title}"\n팩트: ${item.fact}`)
    .join('\n');

  return [
    {
      role: 'system',
      content:
        '당신은 시니어 투자 애널리스트입니다. 전체 뉴스 중 오늘 가장 중요한 3건을 선정합니다. 순수 JSON만 출력하세요.',
    },
    {
      role: 'user',
      content: `오늘 날짜: ${date}

## 전체 뉴스 목록

${itemsText}

## 작업 지시

전체 뉴스 중 오늘 반드시 알아야 할 TOP 3를 선정하세요.

선정 기준 (가중치 순):
1. 내 자산(주식/부동산/연금)에 직접 영향 → 최우선
2. 시장 전체 방향성에 영향 → 우선
3. 향후 1개월 내 중대한 변화 예고 → 높음
4. 산업/기술 패러다임 변화 → 보통

출력 형식 (순수 JSON):
{
  "top3": [
    {
      "rank": 1,
      "category": "카테고리명",
      "title": "뉴스 제목",
      "urgency": "breaking|watch|note",
      "fact": "팩트 1문장",
      "impact": "임팩트 1문장",
      "action": "액션 1문장",
      "contextTags": ["tag1"],
      "source": "출처",
      "sourceUrl": "https://...",
      "relatedData": ["핵심 수치 1", "핵심 수치 2"],
      "contextLinks": ["연관 카테고리 뉴스 제목"],
      "upcomingEvents": ["후속 이벤트 일정"]
    }
  ]
}`,
    },
  ];
}
