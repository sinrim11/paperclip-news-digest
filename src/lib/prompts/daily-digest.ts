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
 * CMP-126: gemma4:26b prompt tuning + multi-source consensus rules
 */

import type { Category, RawArticle, MarketSnapshot } from '../types';

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
// CMP-126 multi-source rules:
//   - sourceCount >= 2 → prepend "[N개 출처 공통 보도]" to fact
//   - consensusFacts: 3~5문장 공통 사실 상세 서술
//   - conflictingFacts: 출처 간 상충 수치/시간/주체 명시 (없으면 null)
//
// gemma4:26b optimizations:
//   - Korean-first system directive
//   - 3 few-shot examples (single / multi-no-conflict / multi-conflict)
//   - strict JSON fence + schema comment
//   - output length constraints
//   - forbidden filler phrases
//   - self-verification checklist

const FEW_SHOT = `
## 출력 예시 (Few-shot)

### 예시 1 — 단일 출처 (sourceCount=1)
입력: {"title":"연준, 기준금리 0.25%p 인상 결정","source_name":"Reuters","source_count":1,"summary":"미 연방준비제도가 5월 FOMC에서 기준금리를 5.25~5.50%로 0.25%p 인상했다."}
출력:
{"urgency":"breaking","fact":"미 연준이 2024년 5월 FOMC에서 기준금리를 0.25%p 인상해 5.25~5.50%로 결정했다.","consensusFacts":"미 연방준비제도가 5월 1일 FOMC 회의에서 기준금리를 5.25~5.50%로 결정했다. 파월 의장은 인플레이션이 여전히 목표치(2%)를 크게 웃돌고 있다고 밝혔다. 금리 동결 가능성이 제기됐으나 고용 지표 강세로 인상이 확정됐다.","conflictingFacts":null,"impact":"글로벌 달러 강세 지속으로 신흥국 통화 약세·자본 유출 압력이 높아진다.","action":"달러 자산 및 단기채 비중 확대를 검토하라.","contextTags":["미국_금리"],"source":"Reuters","sourceUrl":"https://reuters.com/example"}

### 예시 2 — 다중 출처, 상충 없음 (sourceCount=2)
입력: {"title":"삼성전자, 2분기 영업이익 14조원 달성","source_name":"한국경제,연합뉴스","source_count":2,"summary":"삼성전자가 2분기 잠정 영업이익 14조원을 발표했다. HBM 수요 급증이 주요 원인이다."}
출력:
{"urgency":"watch","fact":"[2개 출처 공통 보도] 삼성전자가 2024년 2분기 잠정 영업이익 14조원을 기록해 전년 동기 대비 약 15배 급증했다.","consensusFacts":"삼성전자가 2분기 잠정 영업이익 14조원을 발표했다. HBM(고대역폭메모리) 수요 급증이 핵심 성장 동인으로 꼽혔다. 두 출처 모두 DS부문(반도체)의 회복세를 강조했다. 연간 영업이익 60조원 회복 전망이 나오고 있다.","conflictingFacts":null,"impact":"국내 반도체 대장주 삼성전자의 실적 반등이 KOSPI 전체 심리를 끌어올릴 수 있다.","action":"삼성전자 보유자는 3분기 HBM 수주 동향을 주시하라.","contextTags":["삼성전자","반도체_회복"],"source":"한국경제,연합뉴스","sourceUrl":"https://example.com"}

### 예시 3 — 다중 출처, 상충 있음 (sourceCount=3)
입력: {"title":"이란 드론 공격, 이스라엘 피해 발생","source_name":"BBC,AP,Al Jazeera","source_count":3,"summary":"이란이 이스라엘을 향해 드론 300여 기를 발사했다. 피해 규모 집계 중."}
출력:
{"urgency":"breaking","fact":"[3개 출처 공통 보도] 이란이 2024년 4월 14일 이스라엘을 향해 드론 300여 기와 순항미사일을 발사했다.","consensusFacts":"이란 혁명수비대가 4월 14일 새벽 이스라엘 본토를 겨냥해 드론과 미사일을 대규모 발사했다. 이스라엘 아이언돔과 미·영 전투기가 대부분을 요격했다고 세 출처 모두 보도했다. 이스라엘 정부는 즉각 전시 내각을 소집했다. 글로벌 유가와 금값이 장중 급등했다.","conflictingFacts":"드론 발사 수: BBC는 300여 기, AP는 350기 이상, Al Jazeera는 '수백 기'로 보도해 정확한 수치 미확정.","impact":"중동 전면전 리스크 확대로 유가 5달러 이상 급등 및 글로벌 안전자산 선호가 강화된다.","action":"에너지·방산 섹터 노출 및 안전자산(금·달러) 헤지 비율 점검을 즉시 실시하라.","contextTags":["중동_분쟁","유가_급등"],"source":"BBC,AP,Al Jazeera","sourceUrl":"https://bbc.com/example"}
`;

export function buildCategoryPrompt(
  date: string,
  category: Category,
  articles: RawArticle[],
  marketSnapshot?: MarketSnapshot,
): Array<{ role: 'system' | 'user'; content: string }> {
  const marketContext = marketSnapshot
    ? `\n## 오늘의 시장 스냅샷\n` +
      `KOSPI ${marketSnapshot.kospi.value} (${marketSnapshot.kospi.change}), ` +
      `KOSDAQ ${marketSnapshot.kosdaq.value} (${marketSnapshot.kosdaq.change}), ` +
      `USD/KRW ${marketSnapshot.usdKrw.value} (${marketSnapshot.usdKrw.change}), ` +
      `WTI ${marketSnapshot.wti.value} (${marketSnapshot.wti.change}), ` +
      `BTC ${marketSnapshot.btcUsd.value.toLocaleString()} USD (${marketSnapshot.btcUsd.change})`
    : '';

  const articlesText =
    articles.length > 0
      ? articles
          .map((a, i) => {
            const sc = a.sourceCount ?? 1;
            const srcLabel = sc > 1
              ? `출처(${sc}개): ${a.sourceList?.join(', ') ?? a.source}`
              : `출처: ${a.source}`;
            const content = (a.content || '').slice(0, 600);
            return `[${i + 1}] 제목: ${a.title}\n${srcLabel} | source_count=${sc}\nURL: ${a.url}\n내용: ${content || '(내용 없음)'}`;
          })
          .join('\n\n')
      : '(수집된 기사 없음 — 학습 데이터 기반으로 오늘 날짜의 주요 뉴스를 생성하세요)';

  return [
    {
      role: 'system',
      content: `반드시 한국어로 JSON만 출력하세요. 마크다운·코드블록·설명 절대 금지.
당신은 시니어 뉴스 에디터 겸 투자 애널리스트입니다. 의사결정자를 위한 브리핑을 작성합니다.
독자 프로파일: IT업계 시니어 개발자 + 적극적 투자자 + 정책/부동산 관심 높음.

핵심 원칙:
- fact/impact/action 각각 반드시 1문장. 수치·날짜·주체 포함 필수.
- source_count >= 2이면 fact 앞에 "[N개 출처 공통 보도]" 접두사 추가.
- consensusFacts: 모든 출처에 공통된 사실만 3~5문장으로 상세 서술.
- conflictingFacts: 출처 간 수치·시간·주체가 다르면 명시. 없으면 null.
- action은 반드시 "~검토", "~주시", "~대비" 형태로 끝낼 것.
- 금지어: "다음과 같이", "위와 같이", "이상과 같이", "다음과 같은" 사용 절대 금지.`,
    },
    {
      role: 'user',
      content: `오늘 날짜: ${date}
카테고리: ${category}${marketContext}

## 수집된 뉴스 기사 (${articles.length}건)

${articlesText}
${FEW_SHOT}
---

## 작업 지시

위 기사들을 분석해 4단계를 수행하고 최종 JSON을 출력하세요.

### [STEP 2] 구조화 요약 (각 뉴스 → 3줄 + 공통사실)
- fact: 수치·날짜·주체 포함 1문장. source_count >= 2이면 "[N개 출처 공통 보도]" 접두사.
- consensusFacts: 모든 출처 공통 사실만 3~5문장. 한 출처만 언급한 정보 제외.
- conflictingFacts: 출처 간 상충 수치·시간·주체 명시. 없으면 null.
- impact: 시장/산업/사회 영향 1문장.
- action: 구체적 행동 지침 1문장 (~검토|~주시|~대비).
최대 10건 선정. 중복·무관 기사 제외.

### [STEP 3] 긴급도 분류
- "breaking": 즉시 의사결정 필요. 카테고리당 최대 2건.
- "watch": 1~2주 내 모니터링 필요.
- "note": 배경지식, 중장기 관점.

### [STEP 4] 맥락 태그 (context_tags)
카테고리 간 연결 키워드 2~4개. 연관성 없으면 [].

### [STEP 5] 카테고리 브리핑
오늘 이 카테고리의 핵심 흐름 2~3문장 총평.

---

## 출력 형식 (순수 JSON, 아래 스키마 정확히 준수)

{
  "category": "${category}",
  "summary": "카테고리 전체 흐름 2~3문장",
  "items": [
    {
      "title": "뉴스 제목",
      "urgency": "breaking|watch|note",
      "fact": "1문장 (source_count>=2이면 [N개 출처 공통 보도] 접두사)",
      "consensusFacts": "3~5문장 공통 사실 상세 서술",
      "conflictingFacts": "상충 사실 또는 null",
      "impact": "1문장",
      "action": "1문장 (~검토|~주시|~대비)",
      "contextTags": ["태그1", "태그2"],
      "source": "출처명",
      "sourceUrl": "https://..."
    }
  ]
}

urgency는 반드시 "breaking", "watch", "note" 중 하나 (소문자 영어).

## 자기 검증 (출력 전 확인)
- [ ] fact에 수치/날짜/주체 포함 ✓
- [ ] source_count>=2인 기사는 "[N개 출처 공통 보도]" 접두사 ✓
- [ ] consensusFacts가 3~5문장 ✓
- [ ] action이 ~검토/~주시/~대비 형식 ✓
- [ ] 순수 JSON만 출력 (코드블록 없음) ✓`,
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

urgency는 반드시 "breaking", "watch", "note" 중 하나.`,
    },
  ];
}
