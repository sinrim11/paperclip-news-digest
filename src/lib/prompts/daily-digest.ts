/**
 * Daily digest prompt templates — 6-stage structure per news_digest_prompt_guide.md
 *
 * Stage 1: Market data collection         → buildMarketPrompt
 * Stage 2: Per-article structured summary → buildCategoryPrompt (stages 2-5 in one call)
 * Stage 3: Urgency classification         ↑ (embedded in buildCategoryPrompt)
 * Stage 4: Context tag linking            ↑ (embedded in buildCategoryPrompt)
 * Stage 5: Category briefing summary      ↑ (embedded in buildCategoryPrompt)
 * Stage 6: Cross-category TOP 3 selection → buildTop3Prompt
 *
 * Runtime: Ollama gemma4:26b (no web_search — articles pre-fetched via RSS collector)
 */

import type { Category, RawArticle, MarketSnapshot } from '../types';

// ─── Stage 1: Market data collection ─────────────────────────────────────────

export function buildMarketPrompt(date: string): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content:
        '당신은 금융 데이터 분석가입니다. 주어진 날짜의 주요 시장 지표를 JSON 형식으로 반환합니다. 학습 데이터 기준 합리적인 추정치를 제공하세요. 순수 JSON만 출력하세요. 마크다운, 설명, 코드블록 없이.',
    },
    {
      role: 'user',
      content: `오늘 날짜: ${date}

다음 시장 지표의 최근 수준을 JSON으로 반환하세요.
실시간 데이터가 없으므로 학습 데이터 기준 합리적인 추정치를 제공하세요.

출력 형식 (순수 JSON, 추가 설명 없음):
{
  "date": "${date}",
  "kospi": { "value": 0, "change": "+0.0%", "direction": "flat" },
  "kosdaq": { "value": 0, "change": "+0.0%", "direction": "flat" },
  "usdKrw": { "value": 0, "change": "+0.0", "direction": "flat" },
  "wti": { "value": 0, "change": "+0.0%", "direction": "flat" },
  "us10y": { "value": 0, "change": "+0.00", "direction": "flat" },
  "btcUsd": { "value": 0, "change": "+0.0%", "direction": "flat" }
}

direction은 반드시 "up", "down", "flat" 중 하나입니다.
change는 부호(+/-) 포함 문자열입니다.`,
    },
  ];
}

// ─── Stages 2-5: Per-category news structuring (one LLM call per category) ───
//
// Covers:
//   STEP 2: Structured 3-line summary (fact / impact / action)
//   STEP 3: Urgency classification (breaking / watch / note)
//   STEP 4: Context tag linking (cross-category keywords)
//   STEP 5: Category briefing summary (2-3 sentence overview)

export function buildCategoryPrompt(
  date: string,
  category: Category,
  articles: RawArticle[],
  marketSnapshot?: MarketSnapshot,
): Array<{ role: 'system' | 'user'; content: string }> {
  const marketContext = marketSnapshot
    ? `\n\n## 오늘의 시장 스냅샷 (맥락 연결에 활용)\n` +
      `KOSPI ${marketSnapshot.kospi.value} (${marketSnapshot.kospi.change}), ` +
      `KOSDAQ ${marketSnapshot.kosdaq.value} (${marketSnapshot.kosdaq.change}), ` +
      `USD/KRW ${marketSnapshot.usdKrw.value} (${marketSnapshot.usdKrw.change}), ` +
      `WTI ${marketSnapshot.wti.value} (${marketSnapshot.wti.change}), ` +
      `BTC ${marketSnapshot.btcUsd.value.toLocaleString()} USD (${marketSnapshot.btcUsd.change})`
    : '';

  const articlesText =
    articles.length > 0
      ? articles
          .map(
            (a, i) =>
              `[${i + 1}] 제목: ${a.title}\n출처: ${a.source}\nURL: ${a.url}\n내용: ${a.content?.slice(0, 800) || '(내용 없음)'}`,
          )
          .join('\n\n')
      : '(수집된 기사 없음 — 학습 데이터 기반으로 오늘 날짜의 주요 뉴스를 생성하세요)';

  return [
    {
      role: 'system',
      content: `당신은 시니어 뉴스 에디터 겸 투자 애널리스트입니다.
매일 아침 의사결정자를 위한 뉴스 브리핑을 작성합니다.
독자 프로파일: IT업계 시니어 개발자 + 적극적 투자자 + 정책/부동산 관심 높음.

핵심 원칙:
- 독자가 10초 안에 핵심을 파악할 수 있어야 합니다
- fact/impact/action은 각각 반드시 1문장으로 제한합니다
- 기사 원문을 그대로 복사하지 않습니다
- 반드시 순수 JSON만 출력합니다 (마크다운, 코드블록, 설명 없이)`,
    },
    {
      role: 'user',
      content: `오늘 날짜: ${date}
카테고리: ${category}${marketContext}

## 수집된 뉴스 기사 (${articles.length}건)

${articlesText}

---

## 작업 지시

위 기사들을 분석하여 아래 4단계를 순서대로 수행하고, 최종 JSON을 출력하세요.

### [STEP 2] 구조화 요약 — 각 뉴스를 3줄 구조로 변환

각 뉴스는 아래 3줄 구조를 반드시 따르세요:

| 구분 | 설명 |
|------|------|
| 📌 fact (What) | 무슨 일이 일어났는가. 수치/날짜/주체를 포함한 객관적 사실 1문장 |
| 💡 impact (Why) | 왜 중요한가. 시장/산업/사회에 미치는 영향 1문장 |
| 🎯 action (So What) | 독자에게 어떤 의미인가. 구체적 행동 지침 1문장 ("~검토", "~주시", "~대비" 형태) |

최대 10건 선정. 중복/무관 기사 제외.

### [STEP 3] 긴급도 분류 — 각 뉴스에 urgency 태그 부여

- "breaking": 오늘 당장 포트폴리오/의사결정에 영향. 즉시 대응 필요
  - 기준: 시장 급변, 전쟁/재난, 긴급 정책 발표, 금리/환율 급변동
- "watch": 1~2주 내 영향 예상. 모니터링 필요
  - 기준: 정책 예고, 실적 발표 예정, 기술 트렌드 변화, 시장 구조 변화
- "note": 알아두면 좋은 배경 지식. 중장기 관점
  - 기준: 산업 동향, 해외 사례, 연구 결과, 인물/기업 소식

긴급도 부여 원칙:
- "breaking"은 카테고리당 최대 2건으로 제한 (남발 금지)
- 투자/자산에 직접 영향을 주는 뉴스는 긴급도를 1단계 올림
- 글로벌 이슈가 국내 시장에 연쇄 영향이 있으면 긴급도를 1단계 올림

### [STEP 4] 맥락 연결 태깅 (context_tags) — 다른 카테고리 뉴스와 연결되는 키워드 부여

뉴스 간 인과관계나 연쇄 영향이 있는 경우 동일한 contextTag를 부여하세요.

예시:
- 이란 해상봉쇄(글로벌) ↔ 유가 급등(증권) ↔ 에너지 정책(정치)
  → contextTags: ["이란_에너지_위기"]
- AI 규제 법안(정치) ↔ 빅테크 주가(증권) ↔ AI 스타트업(AI)
  → contextTags: ["AI_규제_파급"]
- 미국 관세 인상(글로벌) ↔ 수출주 타격(증권) ↔ 무역정책(정치)
  → contextTags: ["미_관세_충격"]

하나의 뉴스에 여러 contextTag가 붙을 수 있습니다.
카테고리 내부 연관성이 없으면 빈 배열 []로 두세요.

### [STEP 5] 카테고리 브리핑 요약 — 카테고리 전체 2~3문장 총평

"오늘 이 카테고리에서 가장 중요한 흐름은 무엇인가"를 한눈에 전달하세요.
예시: "오늘 글로벌은 이란 해상봉쇄 이슈가 지배적. 미-이란 협상 결렬로 호르무즈 해협 긴장 최고조이며, 유가 4달러 이상 상승 전망."

---

## 출력 형식 (순수 JSON만, 마크다운/코드블록 없이)

{
  "category": "${category}",
  "summary": "카테고리 전체 흐름 2~3문장 총평",
  "items": [
    {
      "title": "뉴스 제목",
      "urgency": "breaking",
      "fact": "📌 무슨 일이 일어났는가 — 수치/날짜/주체 포함 1문장",
      "impact": "💡 왜 중요한가 — 시장/산업/사회 영향 1문장",
      "action": "🎯 독자에게 어떤 의미인가 — 구체적 행동 지침 1문장",
      "contextTags": ["태그1", "태그2"],
      "source": "출처 매체명",
      "sourceUrl": "https://..."
    }
  ]
}

urgency 값은 반드시 "breaking", "watch", "note" 중 하나 (소문자 영어).`,
    },
  ];
}

// ─── Stage 6: Cross-category TOP 3 selection ─────────────────────────────────

export function buildTop3Prompt(
  date: string,
  categorySummaries: Array<{
    category: Category;
    items: Array<{
      title: string;
      urgency: string;
      fact: string;
      impact: string;
      action: string;
      category?: Category;
    }>;
  }>,
): Array<{ role: 'system' | 'user'; content: string }> {
  const allItems = categorySummaries.flatMap((cs) =>
    cs.items.map((item) => ({ ...item, category: cs.category })),
  );

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
        '당신은 시니어 투자 애널리스트입니다. 전체 뉴스 중 오늘 가장 중요한 3건을 선정합니다. 반드시 순수 JSON만 출력하세요. 마크다운, 코드블록, 설명 없이.',
    },
    {
      role: 'user',
      content: `오늘 날짜: ${date}

## 전체 뉴스 목록 (${allItems.length}건)

${itemsText}

---

## [STEP 6] 크로스 카테고리 TOP 3 선정

전체 뉴스 중 오늘 반드시 알아야 할 TOP 3를 선정하세요.
카테고리에 관계없이 "오늘 반드시 알아야 할 뉴스" 기준으로 선정합니다.

선정 기준 (가중치 순):
1. 내 자산(주식/부동산/연금)에 직접 영향 → 최우선
2. 시장 전체 방향성에 영향 → 우선
3. 향후 1개월 내 중대한 변화 예고 → 높음
4. 산업/기술 패러다임 변화 → 보통

주의: 가급적 2개 이상 카테고리에서 선정하세요 (카테고리 편중 금지).

각 TOP 뉴스는 일반 3줄 요약에 추가로:
- relatedData: 핵심 데이터 포인트 2~3개 (예: "WTI +3.5%", "KOSPI -1.2%")
- contextLinks: 다른 카테고리 연관 뉴스 제목 (예: "이란_에너지_위기 → 증권 #3")
- upcomingEvents: 관련 후속 이벤트/발표 일정 (예: "4/16 OPEC 긴급회의")

## 출력 형식 (순수 JSON만)

{
  "top3": [
    {
      "rank": 1,
      "category": "카테고리명",
      "title": "뉴스 제목",
      "urgency": "breaking",
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

urgency 값은 반드시 "breaking", "watch", "note" 중 하나.`,
    },
  ];
}
